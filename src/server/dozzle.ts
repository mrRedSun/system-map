/**
 * Read-only log proxy for a Dozzle hub (v11 HTTP API).
 *
 * Dozzle addresses containers as `<hostId>/<shortContainerId>`. The data names an agent and a
 * container, so both are resolved here: host ids from the hub page's embedded config, container
 * ids from the first `containers-changed` event. History comes from the JSONL logs endpoint and
 * live lines from the SSE stream, starting where history ended.
 */
import { Clock, Context, Duration, Effect, Layer, Option, Schema, Semaphore, Stream } from 'effect';
import { HttpClient, HttpClientRequest, type HttpClientResponse } from 'effect/http';
import type { LogLine } from '../shared/model.js';
import { decodeSse } from '../shared/sse.js';
import { AppConfig } from './config.js';
import { errorMessage } from './logging.js';
import { redact } from './redact.js';
import { DataStore } from './store.js';

/** Every level Dozzle knows; without them the stream sends nothing. */
const LEVELS = ['info', 'debug', 'warn', 'error', 'fatal', 'trace', 'unknown'];

export class DozzleError extends Schema.TaggedError<DozzleError>()('DozzleError', {
  status: Schema.Literals([404, 429, 502, 503]),
  message: Schema.String,
}) {}

export interface DozzleOptions {
  url: URL;
  maxStreams?: number;
  /** Dozzle's history endpoint returns at most 500 lines. */
  maxTail?: number;
  linesPerSecond?: number;
  burst?: number;
  maxLineLength?: number;
  idleTimeout?: Duration.Input;
  requestTimeout?: Duration.Input;
  cacheTtl?: Duration.Input;
}

/** One outgoing SSE event of `/api/logs`. */
export type LogEvent =
  | { event: 'line'; data: LogLine }
  | { event: 'dropped'; data: { count: number } }
  | { event: 'status' | 'error' | 'end'; data: { message: string } };

export interface DozzleEvent {
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
  // Redact before truncating, so a cut never leaves part of a secret unmasked.
  text = redact(text.replace(ANSI, '').replace(CONTROL, ''));
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** Token bucket on the Effect clock (so tests can drive it with `TestClock`). */
export function tokenBucket(rate: number, burst: number) {
  let tokens = burst;
  let last: number | undefined;
  return Effect.map(Clock.currentTimeMillis, (now) => {
    if (last !== undefined) tokens = Math.min(burst, tokens + ((now - last) / 1000) * rate);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  });
}

/**
 * History and live overlap at the boundary; this drops what was already sent: anything older
 * than the newest timestamp, and repeated ids at that timestamp.
 */
export function overlapFilter() {
  let lastTs = 0;
  let idsAtLastTs = new Set<number>();
  return {
    get lastTs() {
      return lastTs;
    },
    accept(ts: number, id: number | undefined): boolean {
      if (ts < lastTs || (ts === lastTs && id !== undefined && idsAtLastTs.has(id))) return false;
      if (ts > lastTs) {
        lastTs = ts;
        idsAtLastTs = new Set();
      }
      if (id !== undefined) idsAtLastTs.add(id);
      return true;
    },
  };
}

function pick(cs: DozzleContainer[]): DozzleContainer | undefined {
  return [...cs].sort(
    (a, b) =>
      Number(b.state === 'running') - Number(a.state === 'running') ||
      String(b.created ?? '').localeCompare(String(a.created ?? '')),
  )[0];
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Text body as a stream of SSE events. */
const sseOf = (res: HttpClientResponse.HttpClientResponse) =>
  res.stream.pipe(Stream.decodeText(), decodeSse());

export const makeDozzleClient = Effect.fnUntraced(function* (o: DozzleOptions) {
  const http = (yield* HttpClient.HttpClient).pipe(
    HttpClient.filterStatus((s) => s !== 404),
    HttpClient.filterStatusOk,
  );
  const requestTimeout = o.requestTimeout ?? '5 seconds';
  const cacheMs = Duration.toMillis(Duration.fromInputUnsafe(o.cacheTtl ?? '30 seconds'));
  const maxLen = o.maxLineLength ?? 8192;
  const url = (path: string, params?: URLSearchParams) => {
    const u = new URL(path, o.url);
    if (params) u.search = params.toString();
    return u.href;
  };

  const upstreamError = (err: unknown): DozzleError => {
    const e = err as { _tag?: string; reason?: { _tag?: string; response?: { status: number } } };
    const status = e.reason?.response?.status;
    if (status === 404) return new DozzleError({ status: 404, message: 'Dozzle: not found' });
    if (status !== undefined) {
      return new DozzleError({ status: 502, message: `Dozzle answered HTTP ${status}` });
    }
    const cause = (e.reason as { cause?: unknown } | undefined)?.cause;
    return new DozzleError({
      status: 502,
      message: `Dozzle unreachable: ${errorMessage(cause ?? err)}`,
    });
  };

  /** One request; the response body belongs to the caller's scope. */
  const request = (req: HttpClientRequest.HttpClientRequest) =>
    http.execute(req).pipe(Effect.mapError(upstreamError));

  let hostCache: { at: number; hosts: DozzleHost[] } | undefined;
  const hosts = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (hostCache && now - hostCache.at < cacheMs) return hostCache.hosts;
    const html = yield* request(HttpClientRequest.get(url('./'))).pipe(
      Effect.flatMap((res) => res.text),
      Effect.mapError((err) => (err instanceof DozzleError ? err : upstreamError(err))),
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: requestTimeout,
        orElse: () =>
          Effect.fail(new DozzleError({ status: 502, message: 'Dozzle did not answer in time' })),
      }),
    );
    const m = /<script[^>]*id="config__json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    if (!m) {
      return yield* new DozzleError({
        status: 502,
        message: 'Dozzle page has no config; is DOZZLE_URL the hub root?',
      });
    }
    const config = parseJson(m[1]!) as { hosts?: DozzleHost[] } | undefined;
    if (config === undefined) {
      return yield* new DozzleError({ status: 502, message: 'Dozzle config is not valid JSON' });
    }
    const list = (config.hosts ?? []).filter(
      (h) => typeof h?.id === 'string' && typeof h?.name === 'string',
    );
    hostCache = { at: now, hosts: list };
    return list;
  });

  const resolveHost = Effect.fn('Dozzle.resolveHost')(function* (name: string) {
    const host = (yield* hosts).find((h) => h.name === name || h.id === name);
    if (!host)
      return yield* new DozzleError({ status: 404, message: `Dozzle has no host named "${name}"` });
    if (host.available === false) {
      return yield* new DozzleError({
        status: 502,
        message: `Dozzle host "${name}" is unavailable`,
      });
    }
    return host.id;
  });

  const containerCache = new Map<string, { at: number; id: string }>();
  /** Container id for a name on a host, from Dozzle's container event stream. */
  const resolveContainer = Effect.fn('Dozzle.resolveContainer')(function* (
    hostId: string,
    name: string,
  ) {
    const key = `${hostId}/${name}`;
    const now = yield* Clock.currentTimeMillis;
    const cached = containerCache.get(key);
    if (cached && now - cached.at < cacheMs) return cached.id;
    const seen = new Map<string, DozzleContainer>();
    const found = yield* request(HttpClientRequest.get(url('api/events/stream'))).pipe(
      Effect.flatMap((res) =>
        sseOf(res).pipe(
          Stream.filter((m) => m.event === 'containers-changed' || m.event === 'container-updated'),
          Stream.map((m) => {
            const parsed = parseJson(m.data) as DozzleContainer | DozzleContainer[] | undefined;
            for (const c of Array.isArray(parsed) ? parsed : parsed ? [parsed] : []) {
              if (c?.host === hostId && c.name === name) seen.set(c.id, c);
            }
            return pick([...seen.values()]);
          }),
          Stream.filter((c): c is DozzleContainer => c !== undefined),
          Stream.runHead,
          Effect.mapError((err) => (err instanceof DozzleError ? err : upstreamError(err))),
        ),
      ),
      Effect.scoped,
      // Dozzle keeps the stream open; a container it never mentions is not there.
      Effect.timeoutOrElse({ duration: requestTimeout, orElse: () => Effect.succeedNone }),
    );
    if (Option.isNone(found)) {
      return yield* new DozzleError({
        status: 404,
        message: `Dozzle host has no container named "${name}"`,
      });
    }
    containerCache.set(key, { at: now, id: found.value.id });
    return found.value.id;
  });

  /** History (up to `tail` lines) then live lines, rate limited, as outgoing SSE events. */
  const logEvents = (target: string, tail: number): Stream.Stream<LogEvent> =>
    Stream.unwrap(
      Effect.sync(() => {
        const take = tokenBucket(o.linesPerSecond ?? 50, o.burst ?? 500);
        const overlap = overlapFilter();
        let dropped = 0;

        const toLine = (ev: DozzleEvent) =>
          Effect.gen(function* () {
            const ts = typeof ev.ts === 'number' ? ev.ts : yield* Clock.currentTimeMillis;
            if (!overlap.accept(ts, ev.id)) return Option.none<LogEvent>();
            if (!(yield* take)) {
              dropped++;
              return Option.none<LogEvent>();
            }
            return Option.some<LogEvent>({
              event: 'line',
              data: {
                ts,
                level: ev.l ?? 'unknown',
                stream: ev.s ?? 'stdout',
                text: lineText(ev, maxLen),
              },
            });
          });

        const params = () => {
          const p = new URLSearchParams({ container: target, stdout: '1', stderr: '1' });
          for (const l of LEVELS) p.append('levels', l);
          return p;
        };

        const history =
          tail > 0
            ? Stream.unwrap(
                Effect.gen(function* () {
                  const body = params();
                  body.set('format', 'jsonl');
                  body.set('min', String(tail));
                  const text = yield* request(
                    HttpClientRequest.post(url('api/containers/logs')).pipe(
                      HttpClientRequest.bodyUrlParams(body),
                    ),
                  ).pipe(
                    Effect.flatMap((res) => res.text),
                    Effect.mapError((err) =>
                      err instanceof DozzleError ? err : upstreamError(err),
                    ),
                    Effect.scoped,
                    Effect.timeoutOrElse({
                      duration: requestTimeout,
                      orElse: () =>
                        Effect.fail(
                          new DozzleError({
                            status: 502,
                            message: 'Dozzle did not answer in time',
                          }),
                        ),
                    }),
                  );
                  const lines = text.split('\n').filter(Boolean).slice(-tail);
                  return Stream.fromIterable(lines).pipe(
                    Stream.map(parseJson),
                    // Skip malformed history lines.
                    Stream.filter((ev): ev is DozzleEvent => typeof ev === 'object' && ev !== null),
                  );
                }),
              )
            : Stream.empty;

        const live = Stream.unwrap(
          Effect.gen(function* () {
            const query = params();
            query.set(
              'since',
              new Date(overlap.lastTs || (yield* Clock.currentTimeMillis)).toISOString(),
            );
            const res = yield* request(
              HttpClientRequest.get(url('api/containers/logs/stream', query)).pipe(
                HttpClientRequest.accept('text/event-stream'),
              ),
            );
            const events = sseOf(res).pipe(
              Stream.mapError((err) => upstreamError(err)),
              Stream.timeoutOrElse({
                duration: o.idleTimeout ?? '30 seconds',
                orElse: () =>
                  Stream.fail(
                    new DozzleError({
                      status: 502,
                      message: 'Log stream failed: Dozzle went quiet',
                    }),
                  ),
              }),
            );
            return Stream.concat(
              Stream.succeed<LogEvent | DozzleEvent>({
                event: 'status',
                data: { message: 'live' },
              }),
              events.pipe(
                Stream.flatMap((msg): Stream.Stream<LogEvent | DozzleEvent> => {
                  if (msg.event === 'message') {
                    const ev = parseJson(msg.data);
                    // Skip malformed live lines.
                    return typeof ev === 'object' && ev !== null
                      ? Stream.succeed(ev as DozzleEvent)
                      : Stream.empty;
                  }
                  if (msg.event === 'container-event') {
                    const name =
                      (parseJson(msg.data) as { name?: string } | undefined)?.name ??
                      'container event';
                    return Stream.succeed({
                      event: 'status',
                      data: { message: name.replace(/^container-/, 'container ') },
                    });
                  }
                  return Stream.empty;
                }),
              ),
            );
          }),
        );

        const lines = Stream.concat(
          history as Stream.Stream<LogEvent | DozzleEvent, DozzleError>,
          live,
        ).pipe(
          Stream.mapEffect((item) =>
            'event' in item && typeof item.event === 'string'
              ? Effect.succeed(Option.some(item as LogEvent))
              : toLine(item as DozzleEvent),
          ),
          Stream.filter(Option.isSome),
          Stream.map((o) => o.value),
          Stream.concat(
            Stream.succeed<LogEvent>({
              event: 'end',
              data: { message: 'Dozzle closed the stream' },
            }),
          ),
          Stream.catch((err: DozzleError) =>
            Stream.fromEffect(
              Effect.logWarning('log stream failed').pipe(
                Effect.annotateLogs({ target, error: err.message }),
                Effect.as<LogEvent>({ event: 'error', data: { message: err.message } }),
              ),
            ),
          ),
        );

        // Lines skipped by the rate limit are reported once a second.
        const report: Stream.Stream<LogEvent> = Stream.tick('1 second').pipe(
          Stream.drop(1),
          Stream.filter(() => dropped > 0),
          Stream.map(() => {
            const count = dropped;
            dropped = 0;
            return { event: 'dropped', data: { count } } as const;
          }),
        );

        return lines.pipe(Stream.merge(report, { haltStrategy: 'left' }));
      }),
    );

  return { resolveHost, resolveContainer, logEvents };
});

/** `/api/logs`: only containers declared in the data, at most `maxStreams` at a time. */
export class Logs extends Context.Service<
  Logs,
  {
    /** Fails with the HTTP status and message to answer; the stream holds a slot until it ends. */
    readonly open: (
      host: string,
      container: string,
      tail: number,
    ) => Effect.Effect<Stream.Stream<LogEvent>, DozzleError>;
  }
>()('system-map/Logs') {
  static readonly make = Effect.fnUntraced(function* (
    o: DozzleOptions,
    allowed: (host: string, container: string) => Effect.Effect<boolean>,
  ) {
    const client = yield* makeDozzleClient(o);
    const maxStreams = o.maxStreams ?? 8;
    const slots = yield* Semaphore.make(maxStreams);
    const open = Effect.fn('Logs.open')(function* (host: string, container: string, tail: number) {
      if (!(yield* allowed(host, container))) {
        return yield* new DozzleError({
          status: 404,
          message: 'This container is not declared in the data (logs.dozzle)',
        });
      }
      if (!(yield* slots.takeIfAvailable(1))) {
        return yield* new DozzleError({
          status: 429,
          message: `Too many log streams (limit ${maxStreams})`,
        });
      }
      const release = slots.release(1);
      const target = yield* Effect.gen(function* () {
        const hostId = yield* client.resolveHost(host);
        const containerId = yield* client.resolveContainer(hostId, container);
        return `${hostId}/${containerId}`;
      }).pipe(Effect.onError(() => release));
      return client
        .logEvents(target, Math.min(tail, o.maxTail ?? 500))
        .pipe(Stream.ensuring(release));
    });
    return Logs.of({ open });
  });

  /** Dozzle when `DOZZLE_URL` is set; otherwise every request answers 503. */
  static readonly layer = Layer.effect(
    Logs,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      if (Option.isNone(config.dozzleUrl)) {
        return Logs.of({
          open: () =>
            Effect.fail(new DozzleError({ status: 503, message: 'Dozzle is not configured' })),
        });
      }
      const store = yield* DataStore;
      // Only containers declared in the current data may be streamed.
      const allowed = (host: string, container: string) =>
        Effect.map(store.current, (snap) =>
          Option.match(snap, {
            onNone: () => false,
            onSome: (s) =>
              s.model.services.some(
                (v) => v.logs?.dozzle?.host === host && v.logs.dozzle.container === container,
              ),
          }),
        );
      return yield* Logs.make({ url: config.dozzleUrl.value }, allowed);
    }),
  );
}
