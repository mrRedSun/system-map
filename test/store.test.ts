/** DataStore behaviour against a fake DataSource, on the test clock. */
import { assert, describe, it } from '@effect/vitest';
import { Context, Effect, Fiber, Layer, Option, Queue, Ref, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import * as Logging from '../src/server/logging.js';
import { DataSource, DataStore, type ReadResult } from '../src/server/store.js';

const HOST = 'version: 1\nnodes:\n  - { id: pve, kind: host }\n';
const TWO = `${HOST}  - { id: ct-a, kind: lxc, parent: pve }\n`;

/** A store over files held in a Ref, with change signals pushed through a queue. */
const setup = Effect.gen(function* () {
  const files = yield* Ref.make<ReadResult>({
    files: [{ name: 'a.yaml', text: HOST }],
    problems: [],
  });
  const reads = yield* Ref.make(0);
  const signals = yield* Queue.unbounded<void>();
  const source = Layer.succeed(DataSource, {
    read: Ref.update(reads, (n) => n + 1).pipe(Effect.andThen(Ref.get(files))),
    changes: Stream.fromQueue(signals),
  });
  const ctx = yield* Layer.build(
    DataStore.layer('200 millis').pipe(
      Layer.provide(source),
      Layer.provide(Logging.layer('error', { out: () => {}, err: () => {} })),
    ),
  );
  const store = Context.get(ctx, DataStore);
  const current = Effect.map(store.current, Option.getOrThrow);
  const write = (text: string) =>
    Ref.set(files, { files: [{ name: 'a.yaml', text }], problems: [] });
  const signal = Queue.offer(signals, undefined);
  return { store, current, write, signal, reads: Ref.get(reads) };
});

describe('DataStore (fake source)', () => {
  it.effect('coalesces a burst of changes into one rebuild after the debounce', () =>
    Effect.gen(function* () {
      const { current, write, signal, reads } = yield* setup;
      assert.strictEqual(yield* reads, 1);
      yield* write(TWO);
      for (let i = 0; i < 5; i++) {
        yield* signal;
        yield* TestClock.adjust('50 millis');
      }
      assert.strictEqual(yield* reads, 1);
      assert.lengthOf((yield* current).model.nodes, 1);
      yield* TestClock.adjust('200 millis');
      assert.strictEqual(yield* reads, 2);
      assert.lengthOf((yield* current).model.nodes, 2);
    }),
  );

  it.effect('keeps the last good model, marked stale, while the files do not parse', () =>
    Effect.gen(function* () {
      const { current, write, signal } = yield* setup;
      const good = yield* current;
      yield* write('version: 1\nnodes: [\n');
      yield* signal;
      yield* TestClock.adjust('250 millis');
      const stale = yield* current;
      assert.isTrue(stale.model.stale);
      assert.lengthOf(stale.model.nodes, 1);
      assert.include(stale.model.problems[0], { code: 'yaml', file: 'a.yaml' });
      assert.notStrictEqual(stale.etag, good.etag);

      yield* write(TWO);
      yield* signal;
      yield* TestClock.adjust('250 millis');
      const recovered = yield* current;
      assert.isFalse(recovered.model.stale);
      assert.lengthOf(recovered.model.nodes, 2);
    }),
  );

  it.effect('publishes a snapshot only when the content changes', () =>
    Effect.gen(function* () {
      const { store, write, signal } = yield* setup;
      const seen = yield* Ref.make<string[]>([]);
      const fiber = yield* store.snapshots.pipe(
        Stream.runForEach((s) => Ref.update(seen, (xs) => [...xs, s.etag])),
        Effect.forkChild,
      );
      yield* TestClock.adjust('1 millis');
      yield* store.reload; // same content
      yield* signal;
      yield* TestClock.adjust('250 millis'); // same content again
      assert.lengthOf(yield* Ref.get(seen), 1);
      yield* write(TWO);
      yield* signal;
      yield* TestClock.adjust('250 millis');
      assert.lengthOf(yield* Ref.get(seen), 2);
      yield* Fiber.interrupt(fiber);
    }),
  );
});
