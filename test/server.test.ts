import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeHttpServer, NodeServices } from '@effect/platform-node';
import { assert, describe, it } from '@effect/vitest';
import { Context, Deferred, Effect, Layer, Option, Stream } from 'effect';
import { FetchHttpClient, HttpRouter } from 'effect/http';
import { afterEach, beforeEach } from 'vitest';
import * as Config from '../src/server/config.js';
import { Logs } from '../src/server/dozzle.js';
import * as Http from '../src/server/http.js';
import { Health } from '../src/server/kuma.js';
import * as Logging from '../src/server/logging.js';
import { DataSource, DataStore, readDataFiles, type Limits } from '../src/server/store.js';
import type { SystemModel } from '../src/shared/model.js';

let dir: string;
const put = (name: string, text: string) => writeFileSync(join(dir, name), text);
const HOST = 'version: 1\nnodes:\n  - { id: pve, kind: host }\n';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'system-map-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const quiet = Logging.layer('error', { out: () => {}, err: () => {} });

const config = (over: Partial<Config.Config> = {}): Config.Config => ({
  dataDir: dir,
  port: 8080,
  kumaUrl: Option.none(),
  kumaApiKeyFile: Option.none(),
  dozzleUrl: Option.none(),
  publicDir: join(dir, 'no-public'),
  logLevel: 'error',
  ...over,
});

const storeLayer = (dataDir?: string, limits?: Limits) =>
  DataStore.layer('20 millis').pipe(
    Layer.provide(DataSource.layer(limits)),
    Layer.provide([Config.layer(config(dataDir ? { dataDir } : {})), NodeServices.layer, quiet]),
  );

/** The store, built in the test scope. */
const makeStore = (dataDir?: string) =>
  Effect.map(Layer.build(storeLayer(dataDir)), (ctx) => Context.get(ctx, DataStore));

const currentModel = (store: DataStore['Service']) =>
  Effect.map(store.current, (s) => Option.getOrThrow(s));

/** The full HTTP app as a fetch-like function, plus its store and shutdown signal. */
const setup = Effect.fnUntraced(function* (
  options: Http.HttpOptions = {},
  store: Layer.Layer<DataStore> = storeLayer(),
) {
  const shutdown = yield* Deferred.make<void>();
  const services = yield* Layer.build(
    Layer.mergeAll(Health.layer, Logs.layer).pipe(
      Layer.provideMerge(store),
      Layer.provideMerge(Layer.succeed(Http.Shutdown, shutdown)),
      Layer.provide([FetchHttpClient.layer, NodeServices.layer, Config.layer(config())]),
      Layer.provideMerge(quiet),
    ),
  );
  // Per-request services (compression and static files use the HTTP platform).
  const platform = yield* Layer.build(NodeHttpServer.layerHttpServices);
  const { handler, dispose } = HttpRouter.toWebHandler(
    Http.layer(options).pipe(
      Layer.provide(Layer.succeedContext(services)),
      Layer.provide(NodeHttpServer.layerHttpServices),
    ),
    { disableLogger: true },
  );
  yield* Effect.addFinalizer(() => Effect.promise(dispose));
  const request = (path: string, init?: RequestInit) =>
    Effect.promise(() => handler(new Request(`http://localhost${path}`, init), platform as never));
  return { request, shutdown, store: Context.get(services, DataStore) };
});

const text = (res: Response) => Effect.promise(() => res.text());
const json = <T>(res: Response) => Effect.promise(() => res.json() as Promise<T>);

describe('readDataFiles', () => {
  it.live('reads *.yaml in lexical order and skips dotfiles, other files and directories', () =>
    Effect.gen(function* () {
      put('b.yaml', 'version: 1\n');
      put('a.yaml', 'version: 1\n');
      put('.hidden.yaml', 'x');
      put('notes.txt', 'x');
      put('c.yml', 'x');
      mkdirSync(join(dir, 'd.yaml'));
      const { files, problems } = yield* readDataFiles(dir).pipe(
        Effect.provide(NodeServices.layer),
      );
      assert.deepStrictEqual(
        files.map((f) => f.name),
        ['a.yaml', 'b.yaml'],
      );
      assert.deepStrictEqual(problems, []);
    }),
  );

  it.live('enforces size and count limits', () =>
    Effect.gen(function* () {
      put('a.yaml', 'version: 1\n');
      put('b.yaml', `version: 1\n# ${'x'.repeat(100)}\n`);
      put('c.yaml', 'version: 1\n');
      put('d.yaml', 'version: 1\n');
      const { files, problems } = yield* readDataFiles(dir, {
        maxFiles: 3,
        maxFileBytes: 50,
        maxTotalBytes: 22,
      }).pipe(Effect.provide(NodeServices.layer));
      assert.deepStrictEqual(
        files.map((f) => f.name),
        ['a.yaml', 'c.yaml'],
      );
      assert.deepStrictEqual(
        problems.map((p) => p.file),
        ['b.yaml', 'd.yaml'],
      );
    }),
  );
});

describe('DataStore', () => {
  it.live('serves the last good model plus the error when YAML breaks, and recovers', () =>
    Effect.gen(function* () {
      put('a.yaml', HOST);
      const store = yield* makeStore();
      const good = yield* currentModel(store);
      assert.lengthOf(good.model.nodes, 1);
      assert.isFalse(good.model.stale);

      put('b.yaml', 'version: 1\nnodes: [\n');
      yield* store.reload;
      const stale = yield* currentModel(store);
      assert.isTrue(stale.model.stale);
      assert.lengthOf(stale.model.nodes, 1);
      assert.include(stale.model.problems[0], { code: 'yaml', file: 'b.yaml' });
      assert.notStrictEqual(stale.etag, good.etag);

      put('b.yaml', 'version: 1\nnodes:\n  - { id: ct-a, kind: lxc, parent: pve }\n');
      yield* store.reload;
      const recovered = yield* currentModel(store);
      assert.isFalse(recovered.model.stale);
      assert.lengthOf(recovered.model.nodes, 2);
    }),
  );

  it.live('serves a partial model when the first load has YAML errors', () =>
    Effect.gen(function* () {
      put('a.yaml', HOST);
      put('b.yaml', 'nodes: [\n');
      const { model } = yield* currentModel(yield* makeStore());
      assert.isFalse(model.stale);
      assert.lengthOf(model.nodes, 1);
      assert.strictEqual(model.problems[0]?.code, 'yaml');
    }),
  );

  it.live('notifies only when the content changes', () =>
    Effect.gen(function* () {
      put('a.yaml', HOST);
      const store = yield* makeStore();
      const seen: string[] = [];
      yield* store.snapshots.pipe(
        Stream.runForEach((s) => Effect.sync(() => seen.push(s.etag))),
        Effect.forkScoped,
      );
      yield* Effect.sleep('20 millis');
      yield* store.reload;
      yield* store.reload;
      yield* Effect.sleep('20 millis');
      assert.lengthOf(seen, 1);
    }),
  );

  it.live('rebuilds when files change on disk', () =>
    Effect.gen(function* () {
      put('a.yaml', HOST);
      const store = yield* makeStore();
      // The watch is armed by a background fiber right after the first load.
      yield* Effect.sleep('100 millis');
      put('b.yaml', 'version: 1\nnetworks: [{ id: lan }]\n');
      const next = yield* store.snapshots.pipe(
        Stream.filter((s) => s.model.networks.length === 1),
        Stream.runHead,
        Effect.timeout('3 seconds'),
      );
      assert.isTrue(Option.isSome(next));
    }),
  );

  it.live('reports an unreadable data directory without throwing', () =>
    Effect.gen(function* () {
      const store = yield* Layer.build(
        DataStore.layer().pipe(
          Layer.provide(
            Layer.succeed(DataSource, {
              read: readDataFiles(join(dir, 'missing')).pipe(
                Effect.provide(NodeServices.layer),
                Effect.catch((err) =>
                  Effect.succeed({
                    files: [],
                    problems: [
                      {
                        severity: 'error' as const,
                        code: 'file' as const,
                        message: `Cannot read data directory: ${String(err)}`,
                      },
                    ],
                  }),
                ),
              ),
              changes: Stream.never,
            }),
          ),
          Layer.provide(quiet),
        ),
      );
      const { model } = yield* currentModel(Context.get(store, DataStore));
      assert.include(model.problems[0], { code: 'file', severity: 'error' });
    }),
  );

  it.live('reports an unreadable data directory through the live source', () =>
    Effect.gen(function* () {
      // DataSource.layer watches the directory, so it must exist; remove it after the first load.
      const sub = join(dir, 'data');
      mkdirSync(sub);
      const store = yield* makeStore(sub);
      rmSync(sub, { recursive: true });
      yield* store.reload;
      const { model } = yield* currentModel(store);
      assert.include(model.problems[0], { code: 'file', severity: 'error' });
    }),
  );
});

describe('app', () => {
  it.live('serves the model with an ETag and answers 304 when unchanged', () =>
    Effect.gen(function* () {
      put('a.yaml', HOST);
      const { request } = yield* setup();
      const res = yield* request('/api/model');
      assert.strictEqual(res.status, 200);
      const etag = res.headers.get('etag')!;
      const body = yield* json<SystemModel>(res);
      assert.strictEqual(body.nodes[0]?.id, 'pve');
      assert.strictEqual(res.headers.get('content-security-policy'), Http.CSP);
      assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');

      const again = yield* request('/api/model', { headers: { 'If-None-Match': etag } });
      assert.strictEqual(again.status, 304);
    }),
  );

  it.live('reports health of the server', () =>
    Effect.gen(function* () {
      put('a.yaml', HOST);
      const { request } = yield* setup();
      assert.strictEqual((yield* request('/healthz')).status, 200);
      const empty = yield* setup(
        {},
        Layer.succeed(DataStore, {
          current: Effect.succeedNone,
          snapshots: Stream.never,
          reload: Effect.void,
        }),
      );
      assert.strictEqual((yield* empty.request('/healthz')).status, 503);
      assert.strictEqual((yield* empty.request('/api/model')).status, 503);
    }),
  );

  it.live('is read-only', () =>
    Effect.gen(function* () {
      put('a.yaml', HOST);
      const { request } = yield* setup();
      const res = yield* request('/api/model', { method: 'POST' });
      assert.strictEqual(res.status, 405);
      assert.strictEqual(res.headers.get('allow'), 'GET, HEAD');
    }),
  );

  it.live('returns 404 JSON for unknown API paths', () =>
    Effect.gen(function* () {
      put('a.yaml', HOST);
      const { request } = yield* setup();
      const res = yield* request('/api/nope');
      assert.strictEqual(res.status, 404);
      assert.deepStrictEqual(yield* json(res), { error: 'not found' });
    }),
  );

  it.live('serves the JSON Schema', () =>
    Effect.gen(function* () {
      put('a.yaml', HOST);
      const { request } = yield* setup();
      const res = yield* request('/schema/system-map.schema.json');
      assert.strictEqual(res.status, 200);
      assert.include((yield* json<{ title: string }>(res)).title, 'System Map');
    }),
  );

  it.live('reports a missing Kuma or Dozzle configuration without failing', () =>
    Effect.gen(function* () {
      put('a.yaml', HOST);
      const { request } = yield* setup();
      const health = yield* request('/api/health');
      assert.strictEqual(health.status, 200);
      assert.deepStrictEqual(yield* json(health), { error: 'Uptime Kuma is not configured' });
      assert.strictEqual((yield* request('/api/logs/docker/wiki')).status, 503);
    }),
  );

  it.live('streams a model event on connect and on change, and ends on shutdown', () =>
    Effect.gen(function* () {
      put('a.yaml', HOST);
      const { request, store, shutdown } = yield* setup();
      const res = yield* request('/api/events');
      assert.include(res.headers.get('content-type'), 'text/event-stream');
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let body = '';
      const readUntil = (needle: RegExp) =>
        Effect.promise(async () => {
          while (!needle.test(body)) {
            const { value, done } = await reader.read();
            if (done) return true;
            body += decoder.decode(value);
          }
          return false;
        });
      yield* readUntil(/event: model/);
      const { etag } = yield* currentModel(store);
      assert.include(body, etag.replace(/"/g, '\\"'));

      put('b.yaml', 'version: 1\nnetworks: [{ id: lan }]\n');
      yield* store.reload;
      yield* readUntil(/event: model[\s\S]*event: model/);

      yield* Deferred.succeed(shutdown, undefined);
      const ended = yield* readUntil(/$^/).pipe(Effect.timeout('3 seconds'));
      assert.isTrue(ended);
    }),
  );

  it.live('limits concurrent event streams', () =>
    Effect.gen(function* () {
      put('a.yaml', HOST);
      const { request } = yield* setup({ maxEventClients: 0 });
      assert.strictEqual((yield* request('/api/events')).status, 503);
    }),
  );

  it.live('serves the SPA with long-lived caching only for hashed assets', () =>
    Effect.gen(function* () {
      put('a.yaml', HOST);
      const pub = join(dir, 'public');
      mkdirSync(join(pub, 'assets'), { recursive: true });
      writeFileSync(
        join(pub, 'index.html'),
        '<!doctype html><meta name="csp-nonce" content="__CSP_NONCE__"><title>x</title>',
      );
      writeFileSync(join(pub, 'assets', 'app-abc.js'), 'console.log(1)');
      const { request } = yield* setup({ publicDir: pub });

      const index = yield* request('/');
      assert.strictEqual(index.status, 200);
      assert.strictEqual(index.headers.get('cache-control'), 'no-cache');
      // Each page load gets its own style nonce, in both the CSP and the page.
      const nonce = /'nonce-([^']+)'/.exec(index.headers.get('content-security-policy')!)?.[1];
      assert.match(nonce ?? '', /^[A-Za-z0-9+/=]{24}$/);
      assert.include(yield* text(index), `content="${nonce}"`);
      const again = yield* request('/');
      assert.notInclude(again.headers.get('content-security-policy') ?? '', nonce ?? '');
      // Other responses keep the nonce-free policy.
      assert.strictEqual(
        (yield* request('/api/model')).headers.get('content-security-policy'),
        Http.CSP,
      );
      const asset = yield* request('/assets/app-abc.js');
      assert.include(asset.headers.get('cache-control'), 'immutable');
      const deep = yield* request('/some/client/path');
      assert.include(yield* text(deep), '<title>x</title>');
      const traversal = yield* request('/../a.yaml');
      assert.notInclude(yield* text(traversal), 'version');
    }),
  );
});

describe('whoAmI', () => {
  it('reads the proxy identity headers and strips control characters', () => {
    const headers = new Headers({ 'Remote-User': 'alice', 'Remote-Name': 'Alice\u0007 A.' });
    assert.deepStrictEqual(
      Http.whoAmI((n) => headers.get(n) ?? undefined),
      { user: 'alice', name: 'Alice A.' },
    );
    assert.deepStrictEqual(
      Http.whoAmI(() => undefined),
      {},
    );
  });
});

describe('config', () => {
  it('applies defaults', () => {
    assert.deepStrictEqual(Effect.runSync(Config.parseEnv({}, '/pub')), {
      dataDir: '/data',
      port: 8080,
      kumaUrl: Option.none(),
      kumaApiKeyFile: Option.none(),
      dozzleUrl: Option.none(),
      publicDir: '/pub',
      logLevel: 'info',
    });
  });

  it('parses URLs and treats empty values as unset', () => {
    const c = Effect.runSync(
      Config.parseEnv({ KUMA_URL: 'http://kuma:3001', DOZZLE_URL: '', PORT: '9000' }, '/p'),
    );
    assert.strictEqual(Option.getOrThrow(c.kumaUrl).href, 'http://kuma:3001/');
    assert.isTrue(Option.isNone(c.dozzleUrl));
    assert.strictEqual(c.port, 9000);
  });

  it('fails clearly on invalid values', () => {
    const fail = (env: Record<string, string>) =>
      Effect.runSync(Effect.flip(Config.parseEnv(env, '/p')));
    const a = fail({ PORT: 'eighty', KUMA_URL: 'ftp://x' });
    assert.strictEqual(a._tag, 'ConfigError');
    assert.match(fail({ PORT: '70000', DOZZLE_URL: 'not a url' }).message, /PORT[\s\S]*DOZZLE_URL/);
    assert.include(fail({ LOG_LEVEL: 'debug' }).message, 'LOG_LEVEL');
    assert.strictEqual(Config.logLevelFromEnv({ LOG_LEVEL: 'warn' }), 'warn');
    assert.strictEqual(Config.logLevelFromEnv({ LOG_LEVEL: 'debug' }), 'info');
  });
});

describe('review regressions', () => {
  it.live('does not leak event-stream slots on HEAD requests', () =>
    Effect.gen(function* () {
      put('a.yaml', HOST);
      const { request } = yield* setup({ maxEventClients: 2 });
      for (let i = 0; i < 3; i++) {
        assert.strictEqual((yield* request('/api/events', { method: 'HEAD' })).status, 405);
      }
      const res = yield* request('/api/events');
      assert.strictEqual(res.status, 200);
      yield* Effect.promise(() => res.body!.cancel());
      assert.strictEqual((yield* request('/api/logs/docker/wiki', { method: 'HEAD' })).status, 405);
    }),
  );

  it.live('keeps the last good model when an alias refers to itself', () =>
    Effect.gen(function* () {
      put('a.yaml', HOST);
      const store = yield* makeStore();
      put('a.yaml', 'version: 1\nnodes:\n  - { id: pve, kind: host, x: &l { s: *l } }\n');
      yield* store.reload;
      const { model } = yield* currentModel(store);
      assert.isTrue(model.stale);
      assert.include(model.problems[0], { code: 'yaml', file: 'a.yaml' });
    }),
  );

  it.live('ignores __proto__ keys instead of polluting prototypes', () =>
    Effect.gen(function* () {
      put(
        'a.yaml',
        'version: 1\nmeta: { __proto__: { polluted: yes } }\nnodes:\n  - { id: pve, kind: host, __proto__: { logs: x } }\n',
      );
      const { model } = yield* currentModel(yield* makeStore());
      assert.isUndefined(({} as Record<string, unknown>).polluted);
      assert.strictEqual(Object.getPrototypeOf(model.nodes[0]), Object.prototype);
      assert.include(
        model.problems.map((p) => p.code),
        'unknown-key',
      );
    }),
  );
});
