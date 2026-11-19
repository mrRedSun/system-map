import { assert, describe, it } from '@effect/vitest';
import { Effect, Stream } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { afterAll, beforeAll } from 'vitest';
import { Logs, type LogEvent } from '../src/server/dozzle.js';
import { kumaHealth } from '../src/server/kuma.js';
import { mockInputs } from '../scripts/demo.js';
import { FAKE_KEY, startDozzleMock } from '../scripts/mocks/dozzle.js';
import { kumaMetrics } from '../scripts/mocks/kuma.js';
import { EXAMPLES_DIR } from './helpers.js';

describe('demo mocks', () => {
  it('derive monitors (mostly up, one down, one pending) and containers from the data', () => {
    const { monitors, containers } = mockInputs(EXAMPLES_DIR);
    assert.isTrue(monitors.length > 3);
    assert.strictEqual(monitors.filter((m) => m.status === 'down').length, 1);
    assert.strictEqual(monitors.filter((m) => m.status === 'pending').length, 1);
    assert.isTrue(containers.some((c) => c.host === 'docker' && c.name === 'wiki'));
  });

  it('Kuma metrics parse with the app’s parser', () => {
    const health = kumaHealth(
      kumaMetrics([
        { kumaId: 1, name: 'Wiki "main"', status: 'up' },
        { kumaId: 2, name: 'DNS', status: 'down' },
      ]),
    );
    assert.strictEqual(health['1']?.status, 'up');
    assert.strictEqual(health['1']?.name, 'Wiki "main"');
    assert.isNumber(health['1']?.ping);
    assert.strictEqual(health['2']?.status, 'down');
    assert.strictEqual(health['2']?.uptime?.['1d'], 0.912);
  });

  describe('Dozzle mock with the app’s log client', () => {
    let mock: Awaited<ReturnType<typeof startDozzleMock>>;
    beforeAll(async () => {
      mock = await startDozzleMock([{ host: 'docker', name: 'sonarr' }], {
        live: false,
        now: () => Date.UTC(2026, 0, 1),
      });
    });
    afterAll(() => mock.close());

    it.live('streams history with the fake key redacted', () =>
      Effect.gen(function* () {
        const logs = yield* Logs.make({ url: new URL(mock.url) }, () => Effect.succeed(true));
        const stream = yield* logs.open('docker', 'sonarr', 20);
        const events = yield* stream.pipe(
          Stream.takeUntil((e: LogEvent) => e.event === 'status'),
          Stream.runCollect,
        );
        const lines = events.flatMap((e) => (e.event === 'line' ? [e.data.text] : []));
        assert.strictEqual(lines.length, 20);
        assert.isTrue(lines.some((l) => l.includes('apikey=[redacted]')));
        assert.isFalse(lines.some((l) => l.includes(FAKE_KEY)));
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    );
  });
});
