/** Server-Sent Events on top of `effect/encoding/Sse`: decoding a text stream, encoding frames. */
import { Effect, Stream } from 'effect';
import { Sse } from 'effect/encoding';

export interface SseEvent {
  /** `message` when the frame names no event. */
  readonly event: string;
  readonly data: string;
}

/**
 * Text chunks → SSE events. `retry:` directives are ignored (callers decide about
 * reconnecting), and an event larger than `maxEventSize` fails the stream.
 */
export const decodeSse =
  (maxEventSize = 1024 * 1024) =>
  <E, R>(text: Stream.Stream<string, E, R>): Stream.Stream<SseEvent, E | Sse.SseError, R> =>
    Stream.suspend(() => {
      let out: SseEvent[] = [];
      const parser = Sse.makeParser(
        (e) => {
          if (e._tag === 'Event') out.push({ event: e.event, data: e.data });
        },
        { maxEventSize },
      );
      return text.pipe(
        Stream.mapEffect((chunk) => {
          const error = parser.feed(chunk);
          if (error) return Effect.fail(error);
          const batch = out;
          out = [];
          return Effect.succeed(batch);
        }),
        Stream.flattenIterable,
      );
    });

const encoder = new TextEncoder();

/** One SSE frame with JSON data. */
export const sseFrame = (event: string, data: unknown): Uint8Array =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/** An SSE comment, used as a keep-alive. */
export const sseComment = (text: string): Uint8Array => encoder.encode(`: ${text}\n\n`);
