import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NodeHttpServer } from '@effect/platform-node';
import { assert, describe, it } from '@effect/vitest';
import { Context, Deferred, Effect, Layer, Stream } from 'effect';
import { Sse } from 'effect/encoding';
import { FetchHttpClient, HttpRouter, HttpServer } from 'effect/http';
import { TestClock } from 'effect/testing';
import { afterEach, beforeEach, expect } from 'vitest';
import {
  lineText,
  Logs,
  overlapFilter,
  tokenBucket,
  type DozzleOptions,
} from '../src/server/dozzle.js';
import * as Http from '../src/server/http.js';
import { Health } from '../src/server/kuma.js';
import * as Logging from '../src/server/logging.js';
import { DataStore } from '../src/server/store.js';

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

type Allowed = (host: string, container: string) => boolean;

/** The HTTP app with only the log proxy wired to the fake hub; returns a fetch-like function. */
const app = Effect.fnUntraced(function* (
  opts: Partial<DozzleOptions> & { allowed?: Allowed } = {},
) {
  const { allowed = (h, c) => h === 'docker' && ['wiki', 'missing'].includes(c), ...rest } = opts;
  const logs = yield* Logs.make({ url: dozzle.url, ...rest }, (h, c) =>
    Effect.succeed(allowed(h, c)),
  ).pipe(Effect.provide(FetchHttpClient.layer));
  const shutdown = yield* Deferred.make<void>();
  const services = Layer.mergeAll(
    Layer.succeed(Logs, logs),
    Layer.succeed(Health, { get: Effect.succeed({}) }),
    Layer.succeed(DataStore, {
      current: Effect.succeedNone,
      snapshots: Stream.never,
      reload: Effect.void,
    }),
    Layer.succeed(Http.Shutdown, shutdown),
    Logging.layer('error', { out: () => {}, err: () => {} }),
  );
  // A real HTTP server, so client disconnects behave as in production.
  const ctx = yield* Layer.build(
    HttpRouter.serve(Http.layer({}).pipe(Layer.provide(services)), {
      disableLogger: true,
      disableListenLog: true,
    }).pipe(Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0, host: '127.0.0.1' }))),
  );
  const address = Context.get(ctx, HttpServer.HttpServer).address as { port: number };
  return (path: string) =>
    Effect.promise(() => fetch(`http://127.0.0.1:${address.port}/api/logs${path}`));
});

interface Received {
  event: string;
  data: string;
}

/** Read SSE events from a response until `until` holds, then cancel the body. */
const collect = (res: Response, until: (events: Received[]) => boolean) =>
  Effect.promise(async () => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const events: Received[] = [];
    const parser = Sse.makeParser((e) => {
      if (e._tag === 'Event') events.push({ event: e.event, data: e.data });
    });
    const deadline = Date.now() + 3000;
    while (!until(events)) {
      if (Date.now() > deadline) throw new Error(`timed out; got ${JSON.stringify(events)}`);
      const { value, done } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
    await reader.cancel();
    return events;
  });

const errorOf = (res: Response) =>
  Effect.promise(() => res.json() as Promise<{ error: string }>).pipe(Effect.map((b) => b.error));

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
  it.live('refuses containers that are not declared in the data', () =>
    Effect.gen(function* () {
      const res = yield* (yield* app())('/docker/other');
      assert.strictEqual(res.status, 404);
      assert.include(yield* errorOf(res), 'not declared');
    }),
  );

  it.live('reports unknown hosts, unknown containers and an unreachable hub', () =>
    Effect.gen(function* () {
      const a = yield* app({ allowed: () => true, requestTimeout: '300 millis' });
      assert.strictEqual((yield* a('/nope/wiki')).status, 404);
      assert.strictEqual((yield* a('/docker/missing')).status, 404);
      dozzle.hostAvailable = false;
      const b = yield* app({ allowed: () => true });
      assert.strictEqual((yield* b('/docker/wiki')).status, 502);
      yield* Effect.promise(() => dozzle.stop());
      const c = yield* app({ allowed: () => true });
      const res = yield* c('/docker/wiki');
      assert.strictEqual(res.status, 502);
      assert.include(yield* errorOf(res), 'Dozzle unreachable');
      yield* Effect.promise(() => dozzle.start()); // for afterEach
    }),
  );

  it.live('sends history then live lines, without duplicates at the boundary', () =>
    Effect.gen(function* () {
      dozzle.history = [ev(1, 1000, 'one'), ev(2, 2000, 'two')];
      dozzle.live = [ev(2, 2000, 'two'), ev(3, 3000, 'three')];
      const res = yield* (yield* app())('/docker/wiki?tail=50');
      assert.include(res.headers.get('content-type'), 'text/event-stream');
      const events = yield* collect(res, (e) =>
        e.some((x) => x.data.includes('container started')),
      );
      const lines = events
        .filter((e) => e.event === 'line')
        .map((e) => (JSON.parse(e.data) as { text: string }).text);
      assert.deepStrictEqual(lines, ['one', 'two', 'three']);
      // Resolved the running container by name, asked for all levels and both streams.
      assert.strictEqual(dozzle.lastHistoryBody?.get('container'), 'host-1/bbb222');
      assert.strictEqual(dozzle.lastHistoryBody?.get('min'), '50');
      assert.lengthOf(dozzle.lastLiveQuery?.getAll('levels') ?? [], 7);
      assert.strictEqual(dozzle.lastLiveQuery?.get('since'), new Date(2000).toISOString());
    }),
  );

  it.live('caps tail, line length and line rate', () =>
    Effect.gen(function* () {
      dozzle.history = Array.from({ length: 30 }, (_, i) => ev(i, 1000 + i, `l${i}`));
      dozzle.live = [ev(100, 9000, 'x'.repeat(50))];
      const a = yield* app({ maxTail: 20, burst: 10, linesPerSecond: 0.001, maxLineLength: 10 });
      const res = yield* a('/docker/wiki?tail=999');
      const events = yield* collect(res, (e) => e.some((x) => x.event === 'dropped'));
      assert.strictEqual(dozzle.lastHistoryBody?.get('min'), '20');
      assert.lengthOf(
        events.filter((e) => e.event === 'line'),
        10,
      );
      const dropped = JSON.parse(events.find((e) => e.event === 'dropped')!.data) as {
        count: number;
      };
      assert.strictEqual(dropped.count, 11);
    }),
  );

  it.live('rejects a bad tail', () =>
    Effect.gen(function* () {
      const res = yield* (yield* app())('/docker/wiki?tail=-1');
      assert.strictEqual(res.status, 400);
    }),
  );

  it.live('closes the upstream stream when the client disconnects', () =>
    Effect.gen(function* () {
      const res = yield* (yield* app())('/docker/wiki?tail=0');
      yield* collect(res, (e) => e.some((x) => x.event === 'status'));
      const start = Date.now();
      while (dozzle.liveClosed < 1 && Date.now() - start < 2000) yield* Effect.sleep('20 millis');
      assert.strictEqual(dozzle.liveOpen, 1);
      assert.strictEqual(dozzle.liveClosed, 1);
    }),
  );

  it.live('limits concurrent streams and frees the slot when a stream ends', () =>
    Effect.gen(function* () {
      const a = yield* app({ maxStreams: 1 });
      const first = yield* a('/docker/wiki?tail=0');
      assert.strictEqual(first.status, 200);
      const second = yield* a('/docker/wiki?tail=0');
      assert.strictEqual(second.status, 429);
      yield* collect(first, (e) => e.some((x) => x.event === 'status'));
      let third = yield* a('/docker/wiki?tail=0');
      for (let i = 0; i < 50 && third.status === 429; i++) {
        yield* Effect.sleep('20 millis');
        third = yield* a('/docker/wiki?tail=0');
      }
      assert.strictEqual(third.status, 200);
      yield* Effect.promise(() => third.body!.cancel());
    }),
  );
});

describe('rate limit and overlap', () => {
  it.effect('tokenBucket allows a burst, then refills at the rate', () =>
    Effect.gen(function* () {
      const take = tokenBucket(2, 3);
      const takes = (n: number) => Effect.all(Array.from({ length: n }, () => take));
      assert.deepStrictEqual(yield* takes(4), [true, true, true, false]);
      yield* TestClock.adjust('500 millis');
      assert.deepStrictEqual(yield* takes(2), [true, false]);
      yield* TestClock.adjust('10 seconds');
      assert.deepStrictEqual(yield* takes(4), [true, true, true, false]);
    }),
  );

  it('overlapFilter drops older lines and repeated ids at the newest timestamp', () => {
    const f = overlapFilter();
    expect([
      f.accept(1000, 1),
      f.accept(2000, 2),
      f.accept(2000, 2),
      f.accept(2000, 3),
      f.accept(1500, 9),
      f.accept(2000, undefined),
      f.accept(3000, 2),
    ]).toEqual([true, true, false, true, false, true, true]);
    assert.strictEqual(f.lastTs, 3000);
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
