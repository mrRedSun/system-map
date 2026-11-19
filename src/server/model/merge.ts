/**
 * Merge parsed files in lexical order: top-level arrays concatenate, top-level objects
 * deep-merge (later files win, with a warning on conflicting values).
 */
import type { Problem } from '../../shared/model.js';
import { SECTION_KEYS, type SectionKey } from '../../shared/schema.js';
import { lineOf, type ParsedFile, type PathSegment } from './parse.js';

export interface Origin {
  file: ParsedFile;
  path: PathSegment[];
  /** Position across all files in merge order; lower means defined earlier. */
  order: number;
}

export interface MergedItem {
  value: unknown;
  origin: Origin;
}

export interface MergeResult {
  meta: Record<string, unknown>;
  /** Files that contributed to `meta`, in merge order. */
  metaFiles: ParsedFile[];
  sections: Record<SectionKey, MergedItem[]>;
  problems: Problem[];
}

const SECTIONS = new Set<string>(SECTION_KEYS);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeFiles(files: readonly ParsedFile[]): MergeResult {
  const result: MergeResult = {
    meta: {},
    metaFiles: [],
    sections: Object.fromEntries(SECTION_KEYS.map((k) => [k, []])) as unknown as Record<
      SectionKey,
      MergedItem[]
    >,
    problems: [],
  };
  const problem = (p: Omit<Problem, 'severity'> & Partial<Pick<Problem, 'severity'>>) =>
    result.problems.push({ severity: 'error', ...p });
  // Which file last set each meta path, for conflict messages.
  const metaOwners = new Map<string, string>();
  let order = 0;
  // `version: 1` must appear in at least one file; the others may omit it.
  let versioned = false;

  for (const file of files) {
    const data = file.data;
    if (data === null || data === undefined) {
      problem({ severity: 'warning', code: 'file', message: 'File is empty', file: file.name });
      continue;
    }
    if (!isPlainObject(data)) {
      problem({
        code: 'schema',
        message: 'Top level must be a mapping',
        file: file.name,
        line: lineOf(file, []),
      });
      continue;
    }
    if (data.version !== undefined) {
      if (data.version === 1) versioned = true;
      else {
        problem({
          code: 'schema',
          message: `Unsupported version ${JSON.stringify(data.version)}; expected 1`,
          file: file.name,
          line: lineOf(file, ['version']),
          path: 'version',
        });
      }
    }

    for (const [key, value] of Object.entries(data)) {
      if (key === 'version') continue;
      if (key === 'meta') {
        if (!isPlainObject(value)) {
          problem({
            code: 'schema',
            message: '`meta` must be a mapping',
            file: file.name,
            line: lineOf(file, ['meta']),
            path: 'meta',
          });
          continue;
        }
        result.metaFiles.push(file);
        deepMerge(result.meta, value, ['meta'], (path) => {
          const key = path.join('.');
          // A value replaces whatever was set at this path or below it.
          let previous = metaOwners.get(key);
          for (const [owned, owner] of metaOwners) {
            if (owned.startsWith(`${key}.`)) {
              previous ??= owner;
              metaOwners.delete(owned);
            }
          }
          if (previous !== undefined) {
            problem({
              severity: 'warning',
              code: 'merge-conflict',
              message: `\`${key}\` is also set in ${previous}; using the value from ${file.name}`,
              file: file.name,
              line: lineOf(file, path),
              path: key,
            });
          }
          metaOwners.set(key, file.name);
        });
        continue;
      }
      if (SECTIONS.has(key)) {
        const section = key as SectionKey;
        if (value === null) continue;
        if (!Array.isArray(value)) {
          problem({
            code: 'schema',
            message: `\`${key}\` must be a list`,
            file: file.name,
            line: lineOf(file, [key]),
            path: key,
          });
          continue;
        }
        value.forEach((item, index) =>
          result.sections[section].push({
            value: item,
            origin: { file, path: [key, index], order: order++ },
          }),
        );
        continue;
      }
      problem({
        severity: 'warning',
        code: 'unknown-key',
        message: `Unknown top-level key \`${key}\` is ignored`,
        file: file.name,
        line: lineOf(file, [], key),
        path: key,
      });
    }
  }
  if (!versioned && files.length > 0) {
    problem({
      code: 'schema',
      message: 'No file declares `version: 1`; add it to the file with `meta`',
      file: (result.metaFiles[0] ?? files[0])!.name,
      line: 1,
      path: 'version',
    });
  }
  return result;
}

/**
 * Deep-merge `source` into `target`. `onSet` is called for every leaf written, with its
 * path, so the caller can detect values set by more than one file.
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  path: string[],
  onSet: (path: string[]) => void,
): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    const childPath = [...path, key];
    if (isPlainObject(value)) {
      if (!isPlainObject(existing)) {
        if (existing !== undefined) onSet(childPath);
        target[key] = {};
      }
      deepMerge(target[key] as Record<string, unknown>, value, childPath, onSet);
    } else {
      onSet(childPath);
      target[key] = value;
    }
  }
}
