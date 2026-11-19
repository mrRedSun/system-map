import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DozzleProxy, lineText } from '../src/server/dozzle.js';
import { SseParser } from '../src/shared/sse.js';

/** A fake Dozzle hub (v11 API shape) with one agent host and two containers. */
class FakeDozzle {
  server!: Server;
  url!: URL;
  liveOpen = 0;
  liveClosed = 0;
  lastLiveQuery?: URLSearchParams;
  lastHistoryBody?: URLSearchParams;
  history: object[] = [];
  live: object[] = [];
  hostAvailable = true;

  async start() {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = new URL(`http://127.0.0.1:${(this.server.address() as AddressInfo).port}/`);
  }

  async stop() {
    this.server.closeAllConnections();
    await new Promise((r) => this.server.close(r));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, this.url);
    if (url.pathname === '/') {
      const config = {
        hosts: [{ name: 'docker', id: 'host-1', type: 'agent', available: this.hostAvailable }],
      };
      res.end(
        `<html><script type="application/json" id="config__json">${JSON.stringify(config)}</script></html>`,
      );
      return;
    }
    if (url.pathname === '/api/events/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('retry: 3000\n\n');
      const containers = [
        { id: 'aaa111', name: 'wiki', host: 'host-1', state: 'exited', created: '2026-01-01' },
        { id: 'bbb222', name: 'wiki', host: 'host-1', state: 'running', created: '2026-02-01' },
        { id: 'ccc333', name: 'other', host: 'host-1', state: 'running' },
      ];
      res.write(`event: containers-changed\ndata: ${JSON.stringify(containers)}\n\n`);
      return; // left open, like Dozzle
    }
    if (url.pathname === '/api/containers/logs' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      this.lastHistoryBody = new URLSearchParams(body);
      res.writeHead(200, { 'Content-Type': 'application/x-jsonl' });
      res.end(this.history.map((h) => JSON.stringify(h)).join('\n') + '\n');
      return;
    }
    if (url.pathname === '/api/containers/logs/stream') {
      this.lastLiveQuery = url.searchParams;
      this.liveOpen++;
      req.on('close', () => this.liveClosed++);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const ev of this.live) res.write(`data: ${JSON.stringify(ev)}\nid: 1\n\n`);
      res.write(`event: container-event\ndata: {"name":"container-started","host":"host-1"}\n\n`);
      return; // stays open
    }
    res.writeHead(404).end('not found');
  }
}

let dozzle: FakeDozzle;
beforeEach(async () => {
  dozzle = new FakeDozzle();
  await dozzle.start();
});
afterEach(() => dozzle.stop());

function app(opts: Partial<ConstructorParameters<typeof DozzleProxy>[0]> = {}) {
  const proxy = new DozzleProxy({
    url: dozzle.url,
    allowed: (h, c) => h === 'docker' && ['wiki', 'missing'].includes(c),
    ...opts,
  });
  const a = new Hono();
  a.get('/logs/:host/:container', (c) =>
    proxy.stream(
      c,
      c.req.param('host'),
      c.req.param('container'),
      Number(c.req.query('tail') ?? 200),
      c.req.raw.signal,
    ),
  );
  return { proxy, app: a };
}

/** Read SSE events from a response until `count` events of interest arrived. */
async function collect(
  res: Response,
  until: (events: { event?: string; data: string }[]) => boolean,
) {
  const reader = res.body!.getReader();
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const events: { event?: string; data: string }[] = [];
  const deadline = Date.now() + 3000;
  while (!until(events)) {
    if (Date.now() > deadline) throw new Error(`timed out; got ${JSON.stringify(events)}`);
    const { value, done } = await reader.read();
    if (done) break;
    events.push(...parser.push(decoder.decode(value, { stream: true })));
  }
  await reader.cancel();
  return events;
}

const ev = (id: number, ts: number, m: string, extra: object = {}) => ({
  t: 'single',
  m,
  rm: m,
  ts,
  id,
  l: 'info',
  s: 'stdout',
  c: 'bbb222',
  ...extra,
});

describe('Dozzle proxy', () => {
  it('refuses containers that are not declared in the data', async () => {
    const res = await app().app.request('/logs/docker/other');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain('not declared');
  });

  it('reports unknown hosts, unknown containers and an unreachable hub', async () => {
    const { app: a } = app({ allowed: () => true, requestTimeoutMs: 300 });
    expect((await a.request('/logs/nope/wiki')).status).toBe(404);
    expect((await a.request('/logs/docker/missing')).status).toBe(404);
    dozzle.hostAvailable = false;
    const { app: b } = app({ allowed: () => true });
    expect((await b.request('/logs/docker/wiki')).status).toBe(502);
    await dozzle.stop();
    const { app: c } = app({ allowed: () => true });
    const res = await c.request('/logs/docker/wiki');
    expect(res.status).toBe(502);
    await dozzle.start(); // for afterEach
  });

  it('sends history then live lines, without duplicates at the boundary', async () => {
    dozzle.history = [ev(1, 1000, 'one'), ev(2, 2000, 'two')];
    dozzle.live = [ev(2, 2000, 'two'), ev(3, 3000, 'three')];
    const res = await app().app.request('/logs/docker/wiki?tail=50');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = await collect(res, (e) => e.some((x) => x.data.includes('container started')));
    const lines = events.filter((e) => e.event === 'line').map((e) => JSON.parse(e.data).text);
    expect(lines).toEqual(['one', 'two', 'three']);
    // Resolved the running container by name, asked for all levels and both streams.
    expect(dozzle.lastHistoryBody?.get('container')).toBe('host-1/bbb222');
    expect(dozzle.lastHistoryBody?.get('min')).toBe('50');
    expect(dozzle.lastLiveQuery?.getAll('levels')).toHaveLength(7);
    expect(dozzle.lastLiveQuery?.get('since')).toBe(new Date(2000).toISOString());
  });

  it('caps tail, line length and line rate', async () => {
    dozzle.history = Array.from({ length: 30 }, (_, i) => ev(i, 1000 + i, `l${i}`));
    dozzle.live = [ev(100, 9000, 'x'.repeat(50))];
    const { app: a } = app({ maxTail: 20, burst: 10, linesPerSecond: 0.001, maxLineLength: 10 });
    const res = await a.request('/logs/docker/wiki?tail=999');
    const events = await collect(res, (e) => e.some((x) => x.event === 'dropped'));
    expect(dozzle.lastHistoryBody?.get('min')).toBe('20');
    expect(events.filter((e) => e.event === 'line')).toHaveLength(10);
    const dropped = JSON.parse(events.find((e) => e.event === 'dropped')!.data) as {
      count: number;
    };
    expect(dropped.count).toBe(11);
  });

  it('closes the upstream stream when the client disconnects', async () => {
    const res = await app().app.request('/logs/docker/wiki?tail=0');
    await collect(res, (e) => e.some((x) => x.event === 'status'));
    const start = Date.now();
    while (dozzle.liveClosed < 1 && Date.now() - start < 2000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(dozzle.liveOpen).toBe(1);
    expect(dozzle.liveClosed).toBe(1);
  });

  it('limits concurrent streams', async () => {
    const { app: a } = app({ maxStreams: 1 });
    const first = await a.request('/logs/docker/wiki?tail=0');
    const second = await a.request('/logs/docker/wiki?tail=0');
    expect(second.status).toBe(429);
    await first.body!.cancel();
  });
});

describe('lineText', () => {
  it('uses raw text, unescapes grouped HTML, and strips ANSI and control characters', () => {
    expect(lineText({ rm: '\u001b[31mred\u001b[0m\tok\u0007' })).toBe('red\tok');
    expect(
      lineText({
        t: 'group',
        m: [{ m: '&lt;b&gt; <a href="https://x.example">https://x.example</a>' }, { m: '\tat x' }],
      }),
    ).toBe('<b> https://x.example\n\tat x');
    expect(lineText({ t: 'complex', m: { level: 'info', n: 1 } })).toBe('{"level":"info","n":1}');
    expect(lineText({ rm: 'abcdef' }, 3)).toBe('abc…');
  });
});
