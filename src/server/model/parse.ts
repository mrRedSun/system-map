import { LineCounter, parseDocument, type Document } from 'yaml';
import type { Problem } from '../../shared/model.js';

export interface SourceFile {
  name: string;
  text: string;
}

export interface ParsedFile {
  name: string;
  text: string;
  doc: Document.Parsed;
  lines: LineCounter;
  /** Plain JS value of the document, or undefined when the file failed to parse. */
  data: unknown;
}

export type { PathSegment } from '../../shared/paths.js';
import type { PathSegment } from '../../shared/paths.js';

export interface ParseResult {
  file: ParsedFile;
  problems: Problem[];
  ok: boolean;
}

const MAX_ALIAS_COUNT = 100;

export function parseFile(source: SourceFile): ParseResult {
  const lines = new LineCounter();
  const doc = parseDocument(source.text, {
    lineCounter: lines,
    prettyErrors: true,
    uniqueKeys: true,
    merge: true,
  });
  const file: ParsedFile = { ...source, doc, lines, data: undefined };
  const problems: Problem[] = [];

  for (const err of doc.errors) {
    problems.push({
      severity: 'error',
      code: 'yaml',
      message: firstLine(err.message),
      file: source.name,
      line: err.linePos?.[0].line,
    });
  }
  for (const warn of doc.warnings) {
    problems.push({
      severity: 'warning',
      code: 'yaml',
      message: firstLine(warn.message),
      file: source.name,
      line: warn.linePos?.[0].line,
    });
  }
  if (doc.errors.length > 0) return { file, problems, ok: false };

  try {
    file.data = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
    // An anchor that contains its own alias yields a cyclic value the model cannot hold.
    JSON.stringify(file.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    problems.push({
      severity: 'error',
      code: 'yaml',
      message: /circular/i.test(message)
        ? 'An alias refers to its own anchor (recursive structure)'
        : message,
      file: source.name,
    });
    return { file, problems, ok: false };
  }
  for (const path of stripUnsafeKeys(file.data)) {
    const key = String(path.at(-1));
    problems.push({
      severity: 'warning',
      code: 'unknown-key',
      message: `Key \`${key}\` is not allowed and was ignored`,
      file: source.name,
      line: lineOf(file, path.slice(0, -1), key),
      path: formatPath(path),
    });
  }
  return { file, problems, ok: true };
}

/** Keys that would reach object prototypes when copied or merged. */
const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];

/** Remove prototype-affecting keys in place; returns the paths removed. */
function stripUnsafeKeys(value: unknown, path: PathSegment[] = []): PathSegment[][] {
  if (typeof value !== 'object' || value === null) return [];
  const removed: PathSegment[][] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => removed.push(...stripUnsafeKeys(v, [...path, i])));
    return removed;
  }
  const obj = value as Record<string, unknown>;
  for (const key of UNSAFE_KEYS) {
    if (Object.hasOwn(obj, key)) {
      delete obj[key];
      removed.push([...path, key]);
    }
  }
  for (const [k, v] of Object.entries(obj)) removed.push(...stripUnsafeKeys(v, [...path, k]));
  return removed;
}

function firstLine(message: string): string {
  return message.split('\n', 1)[0] ?? message;
}

interface RangedNode {
  range?: [number, number, number] | null;
}

function nodeAt(file: ParsedFile, path: readonly PathSegment[]): RangedNode | undefined {
  if (path.length === 0) return (file.doc.contents as RangedNode | null) ?? undefined;
  const node = file.doc.getIn(path, true) as RangedNode | undefined;
  return node && typeof node === 'object' ? node : undefined;
}

/** 1-based line of the deepest existing node along `path`, or of `key` inside it. */
export function lineOf(
  file: ParsedFile,
  path: readonly PathSegment[],
  key?: string,
): number | undefined {
  for (let len = path.length; len >= 0; len--) {
    const node = nodeAt(file, path.slice(0, len));
    if (!node?.range) continue;
    let offset = node.range[0];
    if (key !== undefined && len === path.length) {
      const items = (node as { items?: { key?: RangedNode & { value?: unknown } }[] }).items;
      const pair = items?.find((p) => p.key?.value === key);
      if (pair?.key?.range) offset = pair.key.range[0];
    }
    return file.lines.linePos(offset).line;
  }
  return undefined;
}

/** The YAML text of the node at `path`, re-indented to column zero. */
export function rawText(file: ParsedFile, path: readonly PathSegment[]): string {
  const node = nodeAt(file, path);
  if (!node?.range) return '';
  const [start, end] = node.range;
  const lineStart = file.text.lastIndexOf('\n', start - 1) + 1;
  const column = start - lineStart;
  const indent = new RegExp(`^ {0,${column}}`);
  return file.text
    .slice(start, end)
    .split('\n')
    .map((line, i) => (i === 0 ? line : line.replace(indent, '')))
    .join('\n')
    .trimEnd();
}

export function formatPath(path: readonly PathSegment[]): string {
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else out += out ? `.${seg}` : seg;
  }
  return out;
}
