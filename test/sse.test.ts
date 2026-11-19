import { assert, describe, it } from '@effect/vitest';
import { Effect, Stream } from 'effect';
import { decodeSse, sseComment, sseFrame } from '../src/shared/sse.js';

const decode = (chunks: string[], maxEventSize?: number) =>
  Stream.fromIterable(chunks).pipe(decodeSse(maxEventSize), Stream.runCollect);

describe('decodeSse', () => {
  it.effect('parses events split across chunks, comments, multi-line data and CRLF', () =>
    Effect.gen(function* () {
      const events = yield* decode([
        'retry: 3000\n\n:ping\n\ndata: {"a"',
        ':1}\nid: 7\n\nevent: container-event\r\ndata: x\r\ndata: y\r\n\r\n',
      ]);
      assert.deepStrictEqual(events, [
        { event: 'message', data: '{"a":1}' },
        { event: 'container-event', data: 'x\ny' },
      ]);
    }),
  );

  it.effect('ignores retry directives instead of failing', () =>
    Effect.gen(function* () {
      const events = yield* decode(['retry: 1000\n', 'data: ok\n\n']);
      assert.deepStrictEqual(events, [{ event: 'message', data: 'ok' }]);
    }),
  );

  it.effect('rejects unbounded events', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(decode(['data: 0123456789abc'], 10));
      assert.strictEqual(error._tag, 'SseError');
    }),
  );
});

describe('sseFrame', () => {
  it('encodes an event with JSON data, and comments', () => {
    const text = new TextDecoder();
    assert.strictEqual(
      text.decode(sseFrame('model', { etag: '"x"' })),
      'event: model\ndata: {"etag":"\\"x\\""}\n\n',
    );
    assert.strictEqual(text.decode(sseComment('ping')), ': ping\n\n');
  });

  it.effect('round-trips through decodeSse', () =>
    Effect.gen(function* () {
      const frame = new TextDecoder().decode(sseFrame('line', { text: 'a\nb' }));
      const [event] = yield* decode([frame]);
      assert.deepStrictEqual(event, { event: 'line', data: '{"text":"a\\nb"}' });
    }),
  );
});
