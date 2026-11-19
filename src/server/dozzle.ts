/**
 * Read-only log proxy for a Dozzle hub (v11 HTTP API).
 *
 * Dozzle addresses containers as `<hostId>/<shortContainerId>`. The data names an agent and a
 * container, so both are resolved here: host ids from the hub page's embedded config, container
 * ids from the first `containers-changed` event. History comes from the JSONL logs endpoint and
 * live lines from the SSE stream, starting where history ended.
 */
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { SseParser, type SseMessage } from '../shared/sse.js';
import type { LogSource } from './app.js';
import { errorMessage, log } from './log.js';

/** Every level Dozzle knows; without them the stream sends nothing. */
const LEVELS = ['info', 'debug', 'warn', 'error', 'fatal', 'trace', 'unknown'];

export interface DozzleOptions {
  url: URL;
  /** True when this host/container pair is declared in the data (`logs.dozzle`). */
  allowed: (host: string, container: string) => boolean;
  fetch?: typeof fetch;
  maxStreams?: number;
  /** Dozzle's history endpoint returns at most 500 lines. */
  maxTail?: number;
  linesPerSecond?: number;
  burst?: number;
  maxLineLength?: number;
  idleTimeoutMs?: number;
  requestTimeoutMs?: number;
  cacheMs?: number;
}

export interface LogLine {
  ts: number;
  level: string;
  stream: string;
  text: string;
}

interface DozzleEvent {
  t?: string;
  m?: unknown;
  rm?: unknown;
  ts?: number;
  id?: number;
  l?: string;
  s?: string;
}

interface DozzleHost {
  id: string;
  name: string;
  available?: boolean;
}

interface DozzleContainer {
  id: string;
  name: string;
  host: string;
  state?: string;
  created?: string | number;
}

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 429 | 502,
    message: string,
  ) {
    super(message);
  }
}

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&#34;': '"',
};

/** Dozzle HTML-escapes `m` and wraps URLs in <a> tags; undo both. */
function fromHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:lt|gt|amp|quot|#39|#34);/g, (e) => ENTITIES[e] ?? e);
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export function lineText(ev: DozzleEvent, maxLength = 8192): string {
  let text: string;
  if (typeof ev.rm === 'string') text = ev.rm;
  else if (Array.isArray(ev.m)) {
    text = ev.m
      .map((part: unknown) => {
        const m = (part as { m?: unknown } | null)?.m;
        return typeof m === 'string' ? fromHtml(m) : JSON.stringify(m ?? '');
      })
      .join('\n');
  } else if (typeof ev.m === 'string') text = fromHtml(ev.m);
  else text = JSON.stringify(ev.m ?? '');
  text = text.replace(ANSI, '').replace(CONTROL, '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private readonly rate: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export class DozzleProxy implements LogSource {
  private active = 0;
  private hostCache: { at: number; hosts: DozzleHost[] } | undefined;
  private readonly containerCache = new Map<string, { at: number; id: string }>();
  private readonly fetch: typeof fetch;

  constructor(private readonly o: DozzleOptions) {
    this.fetch = o.fetch ?? fetch;
  }

  private url(path: string, params?: URLSearchParams): URL {
    const u = new URL(path, this.o.url);
    if (params) u.search = params.toString();
    return u;
  }

  private async hosts(): Promise<DozzleHost[]> {
    const cacheMs = this.o.cacheMs ?? 30_000;
    if (this.hostCache && Date.now() - this.hostCache.at < cacheMs) return this.hostCache.hosts;
    const res = await this.request(this.url('./'), {});
    const html = await res.text();
    const m = /<script[^>]*id="config__json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    if (!m) throw new HttpError(502, 'Dozzle page has no config; is DOZZLE_URL the hub root?');
    let hosts: DozzleHost[];
    try {
      hosts = ((JSON.parse(m[1]!) as { hosts?: DozzleHost[] }).hosts ?? []).filter(
        (h) => typeof h?.id === 'string' && typeof h?.name === 'string',
      );
    } catch {
      throw new HttpError(502, 'Dozzle config is not valid JSON');
    }
    this.hostCache = { at: Date.now(), hosts };
    return hosts;
  }

  async resolveHost(name: string): Promise<string> {
    const host = (await this.hosts()).find((h) => h.name === name || h.id === name);
    if (!host) throw new HttpError(404, `Dozzle has no host named "${name}"`);
    if (host.available === false) throw new HttpError(502, `Dozzle host "${name}" is unavailable`);
    return host.id;
  }

  /** Container id for a name on a host, from Dozzle's container event stream. */
  async resolveContainer(hostId: string, name: string): Promise<string> {
    const key = `${hostId}/${name}`;
    const cached = this.containerCache.get(key);
    if (cached && Date.now() - cached.at < (this.o.cacheMs ?? 30_000)) return cached.id;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.requestTimeoutMs ?? 5_000);
    const seen = new Map<string, DozzleContainer>();
    try {
      const res = await this.request(this.url('api/events/stream'), { signal: ctrl.signal });
      for await (const msg of readSse(res.body, ctrl.signal)) {
        if (msg.event !== 'containers-changed' && msg.event !== 'container-updated') continue;
        const parsed = JSON.parse(msg.data) as DozzleContainer | DozzleContainer[];
        for (const c of Array.isArray(parsed) ? parsed : [parsed]) {
          if (c?.host === hostId && c.name === name) seen.set(c.id, c);
        }
        const match = pick([...seen.values()]);
        if (match) {
          this.containerCache.set(key, { at: Date.now(), id: match.id });
          return match.id;
        }
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (!ctrl.signal.aborted) throw new HttpError(502, `Dozzle: ${errorMessage(err)}`);
    } finally {
      clearTimeout(timer);
      ctrl.abort();
    }
    throw new HttpError(404, `Dozzle host has no container named "${name}"`);
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetch(url, {
        redirect: 'error',
        ...init,
        signal: init.signal ?? AbortSignal.timeout(this.o.requestTimeoutMs ?? 5_000),
      });
    } catch (err) {
      throw new HttpError(502, `Dozzle unreachable: ${errorMessage(err)}`);
    }
    if (res.status === 404) {
      await res.body?.cancel();
      throw new HttpError(404, 'Dozzle: not found');
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new HttpError(502, `Dozzle answered HTTP ${res.status}`);
    }
    return res;
  }

  async stream(
    c: Context,
    host: string,
    container: string,
    tail: number,
    signal: AbortSignal,
  ): Promise<Response> {
    if (!this.o.allowed(host, container)) {
      return c.json({ error: 'This container is not declared in the data (logs.dozzle)' }, 404);
    }
    const maxStreams = this.o.maxStreams ?? 8;
    if (this.active >= maxStreams) {
      return c.json({ error: `Too many log streams (limit ${maxStreams})` }, 429);
    }
    this.active++;
    let streaming = false;
    try {
      const hostId = await this.resolveHost(host);
      const containerId = await this.resolveContainer(hostId, container);
      streaming = true;
      c.header('Cache-Control', 'no-store');
      c.header('X-Accel-Buffering', 'no');
      return streamSSE(c, async (sse) => {
        try {
          await this.pump(
            sse,
            `${hostId}/${containerId}`,
            Math.min(tail, this.o.maxTail ?? 500),
            signal,
          );
        } finally {
          this.active--;
        }
      });
    } catch (err) {
      if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
      throw err;
    } finally {
      if (!streaming) this.active--;
    }
  }

  private async pump(
    sse: {
      writeSSE(m: { event?: string; data: string }): Promise<void>;
      onAbort(fn: () => void): void;
    },
    target: string,
    tail: number,
    clientSignal: AbortSignal,
  ) {
    const upstream = new AbortController();
    const stop = () => upstream.abort();
    clientSignal.addEventListener('abort', stop, { once: true });
    sse.onAbort(stop);

    const limiter = new TokenBucket(this.o.linesPerSecond ?? 50, this.o.burst ?? 500);
    const maxLen = this.o.maxLineLength ?? 8192;
    let dropped = 0;
    let lastTs = 0;
    let idsAtLastTs = new Set<number>();
    const send = (event: string, data: unknown) =>
      sse.writeSSE({ event, data: JSON.stringify(data) }).catch(stop);
    const emit = async (ev: DozzleEvent) => {
      const ts = typeof ev.ts === 'number' ? ev.ts : Date.now();
      // History and live overlap at the boundary; skip what was already sent.
      if (ts < lastTs || (ts === lastTs && ev.id !== undefined && idsAtLastTs.has(ev.id))) return;
      if (ts > lastTs) {
        lastTs = ts;
        idsAtLastTs = new Set();
      }
      if (ev.id !== undefined) idsAtLastTs.add(ev.id);
      if (!limiter.take()) {
        dropped++;
        return;
      }
      const line: LogLine = {
        ts,
        level: ev.l ?? 'unknown',
        stream: ev.s ?? 'stdout',
        text: lineText(ev, maxLen),
      };
      await send('line', line);
    };
    const report = setInterval(() => {
      if (dropped > 0) {
        void send('dropped', { count: dropped });
        dropped = 0;
      }
    }, 1000);

    const params = () => {
      const p = new URLSearchParams({ container: target, stdout: '1', stderr: '1' });
      for (const l of LEVELS) p.append('levels', l);
      return p;
    };

    try {
      if (tail > 0) {
        const body = params();
        body.set('format', 'jsonl');
        body.set('min', String(tail));
        const res = await this.request(this.url('api/containers/logs'), {
          method: 'POST',
          body,
          signal: AbortSignal.any([
            upstream.signal,
            AbortSignal.timeout(this.o.requestTimeoutMs ?? 5_000),
          ]),
        });
        const lines = (await res.text()).split('\n').filter(Boolean).slice(-tail);
        for (const l of lines) {
          if (upstream.signal.aborted) return;
          try {
            await emit(JSON.parse(l) as DozzleEvent);
          } catch {
            // Skip a malformed history line.
          }
        }
      }
      const live = params();
      live.set('since', new Date(lastTs || Date.now()).toISOString());
      const res = await this.request(this.url('api/containers/logs/stream', live), {
        headers: { Accept: 'text/event-stream' },
        signal: upstream.signal,
      });
      await send('status', { message: 'live' });
      for await (const msg of readSse(res.body, upstream.signal, this.o.idleTimeoutMs ?? 30_000)) {
        if (msg.event === undefined || msg.event === 'message') {
          try {
            await emit(JSON.parse(msg.data) as DozzleEvent);
          } catch {
            // Skip a malformed live line.
          }
        } else if (msg.event === 'container-event') {
          const name = (JSON.parse(msg.data) as { name?: string }).name ?? 'container event';
          await send('status', { message: name.replace(/^container-/, 'container ') });
        }
      }
      if (!upstream.signal.aborted) await send('end', { message: 'Dozzle closed the stream' });
    } catch (err) {
      if (!upstream.signal.aborted && !clientSignal.aborted) {
        const message =
          err instanceof HttpError ? err.message : `Log stream failed: ${errorMessage(err)}`;
        log.warn('log stream failed', { target, error: message });
        await send('error', { message });
      }
    } finally {
      clearInterval(report);
      clientSignal.removeEventListener('abort', stop);
      upstream.abort();
    }
  }
}

function pick(cs: DozzleContainer[]): DozzleContainer | undefined {
  return [...cs].sort(
    (a, b) =>
      Number(b.state === 'running') - Number(a.state === 'running') ||
      String(b.created ?? '').localeCompare(String(a.created ?? '')),
  )[0];
}

/** SSE messages from a response body; ends when the body ends or stays silent for `idleMs`. */
async function* readSse(
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal,
  idleMs?: number,
): AsyncGenerator<SseMessage> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    while (!signal.aborted) {
      let timer: NodeJS.Timeout | undefined;
      const idle = idleMs
        ? new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Dozzle went quiet')), idleMs);
          })
        : undefined;
      const { value, done } = await (idle ? Promise.race([reader.read(), idle]) : reader.read());
      clearTimeout(timer);
      if (done) return;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
