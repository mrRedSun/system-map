/**
 * Live log tail for one container: `/api/logs/...` read as an SSE `Stream`, folded into the
 * panel state. Updates are batched per frame-ish window so a burst renders once. The request
 * is aborted when nothing shows the atom any more (tab closed, paused, reconnected).
 */
import { Effect, Schema, Stream } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import { Atom } from 'effect/reactivity';
import { LogDropped, LogLine, LogMessage } from '../../shared/model';
import { decodeSse, type SseEvent } from '../../shared/sse';
import { errorText } from '@/lib/client';

export interface Line {
  key: number;
  ts: number;
  level: string;
  stream: string;
  text: string;
  note?: boolean;
}

export type StreamState = 'connecting' | 'live' | 'ended' | 'error';

export interface LogState {
  lines: Line[];
  state: StreamState;
  message?: string;
}

export const MAX_LINES = 2000;
export const INITIAL: LogState = { lines: [], state: 'connecting' };

type Update = { line: Omit<Line, 'key'> } | { state: StreamState; message?: string };

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(LogLine));
const decodeDropped = Schema.decodeUnknownOption(Schema.fromJsonString(LogDropped));
const decodeMessage = Schema.decodeUnknownOption(Schema.fromJsonString(LogMessage));

/** One SSE event of `/api/logs` → state updates. */
export function updatesOf(msg: SseEvent, now: () => number = Date.now): Update[] {
  switch (msg.event) {
    case 'line': {
      const l = decodeLine(msg.data);
      return l._tag === 'Some' ? [{ line: l.value }] : [];
    }
    case 'dropped': {
      const d = decodeDropped(msg.data);
      if (d._tag === 'None') return [];
      return [
        {
          line: {
            ts: now(),
            level: 'warn',
            stream: '',
            text: `… ${d.value.count} lines skipped (rate limit)`,
            note: true,
          },
        },
      ];
    }
    case 'status': {
      const m = decodeMessage(msg.data);
      if (m._tag === 'None' || m.value.message === 'live') return [];
      return [
        {
          line: {
            ts: now(),
            level: 'info',
            stream: '',
            text: `— ${m.value.message} —`,
            note: true,
          },
        },
      ];
    }
    case 'error':
    case 'end': {
      const m = decodeMessage(msg.data);
      return [
        {
          state: msg.event === 'error' ? 'error' : 'ended',
          message: m._tag === 'Some' ? m.value.message : '',
        },
      ];
    }
    default:
      return [];
  }
}

let nextKey = 0;

/** Apply a batch of updates; keeps the last `MAX_LINES` lines. */
export function applyUpdates(state: LogState, updates: readonly Update[]): LogState {
  let lines = state.lines;
  let next: LogState = state;
  const added: Line[] = [];
  for (const u of updates) {
    if ('line' in u) added.push({ ...u.line, key: nextKey++ });
    else
      next = {
        ...next,
        state: u.state,
        ...(u.message !== undefined ? { message: u.message } : {}),
      };
  }
  if (added.length > 0) lines = [...lines, ...added].slice(-MAX_LINES);
  return { ...next, lines };
}

const logState = (
  host: string,
  container: string,
): Stream.Stream<LogState, never, HttpClient.HttpClient> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const url = `/api/logs/${encodeURIComponent(host)}/${encodeURIComponent(container)}?tail=200`;
      const res = yield* http.execute(
        HttpClientRequest.get(new URL(url, location.origin).href).pipe(
          HttpClientRequest.accept('text/event-stream'),
        ),
      );
      if (res.status !== 200) {
        const body = yield* res.json.pipe(Effect.orElseSucceed(() => ({})));
        const message = (body as { error?: unknown }).error;
        return yield* Effect.fail(typeof message === 'string' ? message : `HTTP ${res.status}`);
      }
      let state: LogState = { ...INITIAL, state: 'live' };
      const updates = res.stream.pipe(
        Stream.decodeText(),
        decodeSse(),
        Stream.flatMap((msg) => Stream.fromIterable(updatesOf(msg))),
        Stream.concat(
          Stream.sync((): Update => ({ state: state.state === 'live' ? 'ended' : state.state })),
        ),
      );
      return Stream.concat(
        Stream.succeed(state),
        updates.pipe(
          Stream.groupedWithin(500, '50 millis'),
          Stream.map((batch) => (state = applyUpdates(state, batch))),
        ),
      );
    }),
  ).pipe(
    Stream.catch((err) =>
      Stream.succeed<LogState>({ lines: [], state: 'error', message: errorText(err) }),
    ),
  );

const runtime = Atom.runtime(FetchHttpClient.layer);

/** Keyed by `host`, `container` and a run counter, so a reconnect starts a fresh stream. */
export const logStreamAtom = Atom.family((key: string) => {
  const { host, container } = JSON.parse(key) as { host: string; container: string };
  return runtime.atom(logState(host, container), { initialValue: INITIAL });
});

export const logKey = (host: string, container: string, run: number) =>
  JSON.stringify({ host, container, run });
