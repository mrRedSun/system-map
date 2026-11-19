/**
 * Holds the served model: reads the data directory, rebuilds on change, and keeps the
 * last good model when the files stop parsing.
 */
import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Problem, SystemModel } from '../shared/model.js';
import { errorMessage, log } from './log.js';
import { buildModel, sortProblems } from './model/build.js';
import type { SourceFile } from './model/parse.js';

export interface Snapshot {
  model: SystemModel;
  /** Serialized model, sent as-is by `/api/model`. */
  body: string;
  etag: string;
}

export const LIMITS = {
  maxFiles: 200,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
};

export interface ReadResult {
  files: SourceFile[];
  problems: Problem[];
}

/** Read `*.yaml` files (not dotfiles) in lexical order, within size limits. */
export async function readDataFiles(dir: string, limits = LIMITS): Promise<ReadResult> {
  const names = (await readdir(dir))
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
    const path = join(dir, name);
    let info;
    try {
      info = await stat(path);
    } catch (err) {
      fail(`Cannot read: ${errorMessage(err)}`);
      continue;
    }
    if (!info.isFile()) continue;
    if (info.size > limits.maxFileBytes) {
      fail(`Skipped: larger than ${limits.maxFileBytes} bytes`);
      continue;
    }
    if (total + info.size > limits.maxTotalBytes) {
      fail(`Skipped: data directory exceeds ${limits.maxTotalBytes} bytes`);
      continue;
    }
    try {
      const text = await readFile(path, 'utf8');
      total += Buffer.byteLength(text);
      files.push({ name, text });
    } catch (err) {
      fail(`Cannot read: ${errorMessage(err)}`);
    }
  }
  return { files, problems };
}

type Listener = (snapshot: Snapshot) => void;

export class ModelStore {
  private snapshot: Snapshot | undefined;
  private lastGood: SystemModel | undefined;
  private readonly listeners = new Set<Listener>();
  private watcher: FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private retry: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private pending = false;
  private closed = false;

  constructor(
    private readonly dir: string,
    private readonly options: { debounceMs?: number; limits?: typeof LIMITS } = {},
  ) {}

  current(): Snapshot | undefined {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Rebuild now. Concurrent calls coalesce into one extra rebuild. */
  reload(): Promise<void> {
    if (this.running) {
      this.pending = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.pending = false;
          await this.rebuild();
        } while (this.pending && !this.closed);
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }

  /** Watch the data directory and rebuild on changes. */
  watch(): void {
    if (this.closed || this.watcher) return;
    try {
      this.watcher = watch(this.dir, { persistent: false }, () => this.schedule());
      this.watcher.on('error', (err) => {
        log.warn('data directory watch failed; retrying', { error: errorMessage(err) });
        this.unwatch();
        this.retry = setTimeout(() => {
          this.watch();
          this.schedule();
        }, 5_000);
      });
    } catch (err) {
      log.warn('cannot watch data directory; retrying', { error: errorMessage(err) });
      this.retry = setTimeout(() => this.watch(), 5_000);
    }
  }

  close(): void {
    this.closed = true;
    this.unwatch();
    clearTimeout(this.debounce);
    clearTimeout(this.retry);
    this.listeners.clear();
  }

  private unwatch() {
    this.watcher?.close();
    this.watcher = undefined;
  }

  private schedule() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.reload(), this.options.debounceMs ?? 200);
  }

  private async rebuild(): Promise<void> {
    let read: ReadResult;
    try {
      read = await readDataFiles(this.dir, this.options.limits);
    } catch (err) {
      read = {
        files: [],
        problems: [
          {
            severity: 'error',
            code: 'file',
            message: `Cannot read data directory: ${errorMessage(err)}`,
          },
        ],
      };
    }
    const unreadable = read.problems.length > 0;
    const { model, parsed } = buildModel(read.files);
    model.problems = sortProblems([...read.problems, ...model.problems]);

    let served: SystemModel;
    if ((parsed && !unreadable) || !this.lastGood) {
      served = model;
      if (parsed && !unreadable) this.lastGood = model;
    } else {
      // Keep serving the last good model, with the reason it is stale.
      const reasons = model.problems.filter((p) => p.code === 'yaml' || p.code === 'file');
      served = {
        ...this.lastGood,
        problems: sortProblems([...reasons, ...this.lastGood.problems]),
        stale: true,
      };
    }

    const etag = etagOf(served);
    if (etag === this.snapshot?.etag) return;
    this.snapshot = { model: served, body: JSON.stringify(served), etag };
    const errors = served.problems.filter((p) => p.severity === 'error').length;
    log.info('model loaded', {
      files: read.files.length,
      problems: served.problems.length,
      errors,
      stale: served.stale,
    });
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

/** Content hash that ignores the load time, so touching a file does not notify clients. */
function etagOf(model: SystemModel): string {
  const hash = createHash('sha256')
    .update(JSON.stringify({ ...model, loadedAt: '' }))
    .digest('base64url');
  return `"${hash.slice(0, 32)}"`;
}
