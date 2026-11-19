/**
 * The served model. `DataSource` reads the data directory and reports changes; `DataStore`
 * rebuilds on change (debounced), keeps the last good model when the files stop parsing, and
 * publishes snapshots through a `SubscriptionRef`.
 */
import { createHash } from 'node:crypto';
import {
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schedule,
  Semaphore,
  Stream,
  SubscriptionRef,
} from 'effect';
import type { Problem, SystemModel } from '../shared/model.js';
import { AppConfig } from './config.js';
import { errorMessage } from './logging.js';
import { buildModel, sortProblems } from './model/build.js';
import type { SourceFile } from './model/parse.js';

export interface Snapshot {
  readonly model: SystemModel;
  /** Serialized model, sent as-is by `/api/model`. */
  readonly body: string;
  readonly etag: string;
}

export const LIMITS = {
  maxFiles: 200,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
};
export type Limits = typeof LIMITS;

export interface ReadResult {
  files: SourceFile[];
  problems: Problem[];
}

/** Read `*.yaml` files (not dotfiles) in lexical order, within size limits. */
export const readDataFiles = Effect.fnUntraced(function* (dir: string, limits: Limits = LIMITS) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = (yield* fs.readDirectory(dir))
    .filter((n) => n.endsWith('.yaml') && !n.startsWith('.'))
    .sort();
  const files: SourceFile[] = [];
  const problems: Problem[] = [];
  let total = 0;
  for (const name of names) {
    const fail = (message: string) =>
      problems.push({ severity: 'error', code: 'file', message, file: name });
    if (files.length >= limits.maxFiles) {
      fail(`Skipped: more than ${limits.maxFiles} files`);
      continue;
    }
    const full = path.join(dir, name);
    const info = yield* Effect.result(fs.stat(full));
    if (info._tag === 'Failure') {
      fail(`Cannot read: ${errorMessage(info.failure)}`);
      continue;
    }
    if (info.success.type !== 'File') continue;
    const size = Number(info.success.size);
    if (size > limits.maxFileBytes) {
      fail(`Skipped: larger than ${limits.maxFileBytes} bytes`);
      continue;
    }
    if (total + size > limits.maxTotalBytes) {
      fail(`Skipped: data directory exceeds ${limits.maxTotalBytes} bytes`);
      continue;
    }
    const text = yield* Effect.result(fs.readFileString(full));
    if (text._tag === 'Failure') {
      fail(`Cannot read: ${errorMessage(text.failure)}`);
      continue;
    }
    total += Buffer.byteLength(text.success);
    files.push({ name, text: text.success });
  }
  return { files, problems } satisfies ReadResult;
});

/** Where the data comes from: one read of all files, and a stream of change signals. */
export class DataSource extends Context.Service<
  DataSource,
  {
    readonly read: Effect.Effect<ReadResult>;
    /** Emits whenever the files may have changed. Never fails. */
    readonly changes: Stream.Stream<void>;
  }
>()('system-map/DataSource') {
  /** The configured data directory, watched with `fs.watch` (re-armed every 5 s on failure). */
  static readonly layer = (limits: Limits = LIMITS) =>
    Layer.effect(
      DataSource,
      Effect.gen(function* () {
        const { dataDir } = yield* AppConfig;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const read = readDataFiles(dataDir, limits).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.catch((err) =>
            Effect.succeed<ReadResult>({
              files: [],
              problems: [
                {
                  severity: 'error',
                  code: 'file',
                  message: `Cannot read data directory: ${errorMessage(err)}`,
                },
              ],
            }),
          ),
        );
        let armed = false;
        // A re-armed watch may have missed events, so it starts with a change signal.
        const watch = Stream.suspend(() => {
          const events = fs.watch(dataDir).pipe(Stream.as(undefined));
          if (!armed) {
            armed = true;
            return events;
          }
          return Stream.concat(Stream.succeed(undefined), events);
        });
        const changes = watch.pipe(
          Stream.tapError((err) =>
            Effect.logWarning('data directory watch failed; retrying').pipe(
              Effect.annotateLogs({ error: errorMessage(err) }),
            ),
          ),
          Stream.retry(Schedule.spaced('5 seconds')),
          Stream.orDie,
        );
        return DataSource.of({ read, changes });
      }),
    );
}

/** Content hash that ignores the load time, so touching a file does not notify clients. */
export function etagOf(model: SystemModel): string {
  const hash = createHash('sha256')
    .update(JSON.stringify({ ...model, loadedAt: '' }))
    .digest('base64url');
  return `"${hash.slice(0, 32)}"`;
}

/**
 * The model to serve after a read. A read that fails to parse (or has unreadable files) keeps
 * the last good model, marked stale, with the reasons added to its problems.
 */
export function nextModel(
  read: ReadResult,
  lastGood: SystemModel | undefined,
  now = new Date(),
): { served: SystemModel; good: SystemModel | undefined } {
  const unreadable = read.problems.length > 0;
  const { model: built, parsed } = buildModel(read.files, now);
  const model: SystemModel = {
    ...built,
    problems: sortProblems([...read.problems, ...built.problems]),
  };
  if ((parsed && !unreadable) || !lastGood) {
    return { served: model, good: parsed && !unreadable ? model : lastGood };
  }
  const reasons = model.problems.filter((p) => p.code === 'yaml' || p.code === 'file');
  return {
    served: {
      ...lastGood,
      problems: sortProblems([...reasons, ...lastGood.problems]),
      stale: true,
    },
    good: lastGood,
  };
}

export class DataStore extends Context.Service<
  DataStore,
  {
    readonly current: Effect.Effect<Option.Option<Snapshot>>;
    /** The current snapshot (once loaded), then every new one. */
    readonly snapshots: Stream.Stream<Snapshot>;
    /** Rebuild now. */
    readonly reload: Effect.Effect<void>;
  }
>()('system-map/DataStore') {
  /** Loads once before the layer is ready, then follows `DataSource.changes`. */
  static readonly layer = (debounce: Duration.Input = '200 millis') =>
    Layer.effect(
      DataStore,
      Effect.gen(function* () {
        const source = yield* DataSource;
        const ref = yield* SubscriptionRef.make<Option.Option<Snapshot>>(Option.none());
        let lastGood: SystemModel | undefined;
        const lock = yield* Semaphore.make(1);

        const reload = Effect.gen(function* () {
          const read = yield* source.read;
          const next = nextModel(
            read,
            lastGood,
            new Date(yield* Effect.clockWith((c) => c.currentTimeMillis)),
          );
          lastGood = next.good;
          const etag = etagOf(next.served);
          const current = yield* SubscriptionRef.get(ref);
          if (Option.isSome(current) && current.value.etag === etag) return;
          yield* SubscriptionRef.set(
            ref,
            Option.some({ model: next.served, body: JSON.stringify(next.served), etag }),
          );
          const errors = next.served.problems.filter((p) => p.severity === 'error').length;
          yield* Effect.logInfo('model loaded').pipe(
            Effect.annotateLogs({
              files: read.files.length,
              problems: next.served.problems.length,
              errors,
              stale: next.served.stale,
            }),
          );
        }).pipe(lock.withPermits(1));

        yield* reload;
        // Rebuilds run one at a time; changes during a rebuild trigger one more afterwards.
        yield* source.changes.pipe(
          Stream.debounce(debounce),
          Stream.runForEach(() =>
            reload.pipe(
              Effect.catchCause((cause) =>
                Effect.logError('reload failed; keeping the current model', cause),
              ),
            ),
          ),
          Effect.forkScoped,
        );

        return DataStore.of({
          current: SubscriptionRef.get(ref),
          snapshots: SubscriptionRef.changes(ref).pipe(
            Stream.filter(Option.isSome),
            Stream.map((o) => o.value),
          ),
          reload,
        });
      }),
    );
}
