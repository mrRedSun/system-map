import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { assert, describe, it } from '@effect/vitest';
import { Duration, Effect, Fiber, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { afterEach, expect, vi } from 'vitest';
import {
  errorBackoff,
  kumaHealth,
  makeKuma,
  parsePrometheus,
  type KumaOptions,
} from '../src/server/kuma.js';

// Shapes taken from Uptime Kuma 2.5 /metrics output.
const METRICS = `# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)
# TYPE monitor_status gauge
monitor_status{env="prod",monitor_id="1",monitor_name="Wiki",monitor_type="http",monitor_url="https://wiki.example.net/",monitor_hostname="null",monitor_port="null"} 1
monitor_status{monitor_id="2",monitor_name="Auth \\"portal\\", main",monitor_type="http",monitor_url="https://auth.example.net/",monitor_hostname="null",monitor_port="null"} 0
monitor_status{monitor_id="3",monitor_name="DNS",monitor_type="dns",monitor_url="null",monitor_hostname="10.10.0.53",monitor_port="53"} 2
monitor_status{monitor_id="4",monitor_name="Maint",monitor_type="http",monitor_url="null",monitor_hostname="null",monitor_port="null"} 3
monitor_response_time{monitor_id="1",monitor_name="Wiki",monitor_type="http",monitor_url="https://wiki.example.net/",monitor_hostname="null",monitor_port="null"} 123
monitor_response_time{monitor_id="3",monitor_name="DNS",monitor_type="dns",monitor_url="null",monitor_hostname="10.10.0.53",monitor_port="53"} -1
monitor_uptime_ratio{monitor_id="1",monitor_name="Wiki",monitor_type="http",monitor_url="https://wiki.example.net/",monitor_hostname="null",monitor_port="null",window="1d"} 0.998
monitor_uptime_ratio{monitor_id="1",monitor_name="Wiki",monitor_type="http",monitor_url="https://wiki.example.net/",monitor_hostname="null",monitor_port="null",window="30d"} 0.9991
monitor_status{monitor_name="Old 1.23 series",monitor_type="http",monitor_url="null",monitor_hostname="null",monitor_port="null"} 1
process_cpu_user_seconds_total 0.5
app_version{version="2.5.12",major="2",minor="5",patch="12"} 1
`;

describe('Kuma metrics', () => {
  it('parses labels including escaped quotes and commas', () => {
    const s = parsePrometheus(METRICS).find((x) => x.labels.monitor_id === '2');
    expect(s?.labels.monitor_name).toBe('Auth "portal", main');
    expect(s?.value).toBe(0);
  });

  it('maps statuses, pings and uptime per monitor id', () => {
    expect(kumaHealth(METRICS)).toEqual({
      '1': { status: 'up', name: 'Wiki', ping: 123, uptime: { '1d': 0.998, '30d': 0.9991 } },
      '2': { status: 'down', name: 'Auth "portal", main' },
      '3': { status: 'pending', name: 'DNS' },
      '4': { status: 'maintenance', name: 'Maint' },
    });
  });

  it('ignores garbage', () => {
    expect(kumaHealth('not metrics\n{}\nmonitor_status{monitor_id="x"} 1\n')).toEqual({});
  });
});

describe('Kuma client', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const ok = () => new Response(METRICS, { status: 200 });
  type FetchArgs = [string | URL | Request, RequestInit | undefined];
  const urlOf = (call: unknown) => String((call as FetchArgs)[0]);
  const authOf = (call: unknown) =>
    new Headers((call as FetchArgs)[1]?.headers).get('authorization') ?? undefined;

  /** A Kuma health source whose HTTP goes to `fetch`. */
  const kuma = (fetch: (...args: FetchArgs) => Promise<Response>, o: Partial<KumaOptions> = {}) =>
    makeKuma({ url: new URL('http://kuma:3001/'), ...o }).pipe(
      Effect.provide(
        FetchHttpClient.layer.pipe(
          Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch as typeof globalThis.fetch)),
        ),
      ),
      Effect.provide(NodeServices.layer),
    );

  it.effect('fetches /metrics without auth when no key file is set, and caches for 30 s', () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn(async () => ok());
      const health = yield* kuma(fetchMock);
      const [a, b] = yield* Effect.all([health.get, health.get], { concurrency: 'unbounded' });
      assert.strictEqual(a, b);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      assert.strictEqual(urlOf(fetchMock.mock.calls[0]), 'http://kuma:3001/metrics');
      assert.isUndefined(authOf(fetchMock.mock.calls[0]));
      assert.strictEqual((a['1'] as { status: string }).status, 'up');

      yield* TestClock.adjust('29 seconds');
      yield* health.get;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      yield* TestClock.adjust('2 seconds');
      yield* health.get;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }),
  );

  it.effect('sends the API key as the basic-auth password when a key file is set', () =>
    Effect.gen(function* () {
      dir = mkdtempSync(join(tmpdir(), 'kuma-'));
      const keyFile = join(dir, 'key');
      writeFileSync(keyFile, 'uk1_secret\n');
      const fetchMock = vi.fn(async () => ok());
      const health = yield* kuma(fetchMock, {
        url: new URL('http://kuma:3001/base/'),
        apiKeyFile: keyFile,
      });
      yield* health.get;
      assert.strictEqual(urlOf(fetchMock.mock.calls[0]), 'http://kuma:3001/base/metrics');
      assert.strictEqual(
        authOf(fetchMock.mock.calls[0]),
        `Basic ${Buffer.from(':uk1_secret').toString('base64')}`,
      );
    }),
  );

  it.effect('returns an error instead of failing when the key file is missing', () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn(async () => ok());
      const health = yield* kuma(fetchMock, { apiKeyFile: '/nonexistent/key' });
      const body = yield* health.get;
      assert.include(body.error, 'not readable');
      expect(fetchMock).not.toHaveBeenCalled();
    }),
  );

  it.effect('returns an error for HTTP failures, network errors and oversized bodies', () =>
    Effect.gen(function* () {
      const http = yield* kuma(async () => new Response('no', { status: 401 }));
      assert.deepStrictEqual(yield* http.get, { error: 'Uptime Kuma answered HTTP 401' });

      const down = yield* kuma(async () => {
        throw new TypeError('fetch failed');
      });
      assert.include((yield* down.get).error, 'fetch failed');

      const big = yield* kuma(async () => ok(), { maxBytes: 100 });
      assert.include((yield* big.get).error, 'exceed');
    }),
  );

  it.effect('retries sooner after an error than after success', () =>
    Effect.gen(function* () {
      let fail = true;
      const fetchMock = vi.fn(async () => (fail ? new Response('', { status: 500 }) : ok()));
      const health = yield* kuma(fetchMock);
      assert.isDefined((yield* health.get).error);
      fail = false;
      yield* TestClock.adjust('11 seconds');
      assert.isUndefined((yield* health.get).error);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }),
  );

  it.effect('backs off while Kuma keeps failing: 10 s, 20 s, then every 30 s', () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn(async () => new Response('', { status: 503 }));
      const health = yield* kuma(fetchMock);
      const callsAt = function* (step: Duration.Input) {
        yield* TestClock.adjust(step);
        yield* health.get;
        return fetchMock.mock.calls.length;
      };
      yield* health.get;
      assert.strictEqual(yield* callsAt('9 seconds'), 1);
      assert.strictEqual(yield* callsAt('1 second'), 2); // t = 10 s
      assert.strictEqual(yield* callsAt('19 seconds'), 2);
      assert.strictEqual(yield* callsAt('1 second'), 3); // t = 30 s
      assert.strictEqual(yield* callsAt('29 seconds'), 3);
      assert.strictEqual(yield* callsAt('1 second'), 4); // t = 60 s, capped at the 30 s TTL
      assert.strictEqual(yield* callsAt('30 seconds'), 5);
    }),
  );

  it('computes the error backoff', () => {
    const base = Duration.seconds(10);
    const ttl = Duration.seconds(30);
    assert.deepStrictEqual(
      [1, 2, 3, 4].map((n) => Duration.toSeconds(errorBackoff(n, base, ttl))),
      [10, 20, 30, 30],
    );
  });

  it.effect('times out a hanging Kuma', () =>
    Effect.gen(function* () {
      const hang = (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      const health = yield* kuma(hang as never, { timeout: '50 millis' });
      const fiber = yield* Effect.forkChild(health.get);
      yield* TestClock.adjust('100 millis');
      const body = yield* Fiber.join(fiber);
      assert.include(body.error, 'did not answer in time');
    }),
  );
});
