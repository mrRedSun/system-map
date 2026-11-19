/**
 * Live model state: loads the model, then refetches it whenever `/api/events` reports a new
 * ETag. One stream drives it, so the EventSource and any request in flight end together.
 */
import { Effect, Queue, Stream } from 'effect';
import { AsyncResult, Atom } from 'effect/reactivity';
import type { SystemModel, WhoAmI } from '../../shared/model';
import { ApiClient, errorText } from './client';

export type Connection = 'connecting' | 'live' | 'reconnecting';

export interface ModelState {
  model?: SystemModel;
  error?: string;
  connection: Connection;
}

type Signal = { _tag: 'open' } | { _tag: 'error' } | { _tag: 'model'; etag: string | undefined };

/** `/api/events` as a stream of signals; the EventSource closes with the stream. */
export const eventSignals = (url = '/api/events'): Stream.Stream<Signal> =>
  Stream.callback<Signal>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const events = new EventSource(url);
        events.addEventListener('open', () => Queue.offerUnsafe(queue, { _tag: 'open' }));
        events.addEventListener('error', () => Queue.offerUnsafe(queue, { _tag: 'error' }));
        events.addEventListener('model', (e) => {
          let etag: string | undefined;
          try {
            etag = (JSON.parse((e as MessageEvent<string>).data) as { etag?: string }).etag;
          } catch {
            etag = undefined;
          }
          Queue.offerUnsafe(queue, { _tag: 'model', etag });
        });
        return events;
      }),
      (events) => Effect.sync(() => events.close()),
    ),
  );

const INITIAL: ModelState = { connection: 'connecting' };

export const modelAtom = ApiClient.runtime
  .atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* ApiClient;
        let state = INITIAL;
        let etag: string | undefined;
        const load = client.model({ responseMode: 'decoded-and-response' }).pipe(
          Effect.map(([model, response]) => {
            // Compression marks the tag weak (W/"..."); events carry the strong one.
            etag = response.headers.etag?.replace(/^W\//, '');
            return { ...state, model, error: undefined };
          }),
          Effect.catch((err) => Effect.succeed({ ...state, error: errorText(err) })),
        );
        const step = (signal: Signal | { _tag: 'load' }): Effect.Effect<ModelState> => {
          switch (signal._tag) {
            case 'load':
              return load;
            case 'open':
              return Effect.succeed({ ...state, connection: 'live' as const });
            case 'error':
              return Effect.succeed({ ...state, connection: 'reconnecting' as const });
            case 'model':
              return signal.etag !== undefined && signal.etag === etag
                ? Effect.succeed(state)
                : load;
          }
        };
        return Stream.concat(Stream.succeed({ _tag: 'load' as const }), eventSignals()).pipe(
          Stream.mapEffect((signal) =>
            Effect.map(step(signal), (next) => {
              state = next;
              return next;
            }),
          ),
          Stream.changes,
        );
      }),
    ),
    { initialValue: INITIAL },
  )
  .pipe(Atom.keepAlive);

export const modelStateOf = (result: AsyncResult.AsyncResult<ModelState, unknown>): ModelState =>
  AsyncResult.getOrElse(result, () => INITIAL);

/** Identity from the auth proxy; empty when unavailable. */
export const whoAmIAtom = ApiClient.runtime
  .atom(
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.me();
    }).pipe(Effect.orElseSucceed((): WhoAmI => ({}))),
    { initialValue: {} },
  )
  .pipe(Atom.keepAlive);
