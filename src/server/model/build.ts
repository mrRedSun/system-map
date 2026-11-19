import type { Problem, SourceRef, SystemModel } from '../../shared/model.js';
import { mergeFiles } from './merge.js';
import { lineOf, parseFile, rawText, type SourceFile } from './parse.js';
import { checkReferences, deriveEdges } from './references.js';
import { validate } from './validate.js';

export interface BuildResult {
  model: SystemModel;
  /** False when at least one file has YAML syntax errors; the model then lacks that file. */
  parsed: boolean;
}

/** Build the merged model from data files. Files are merged in the order given. */
export function buildModel(inputs: readonly SourceFile[], now = new Date()): BuildResult {
  const problems: Problem[] = [];
  const files = [];
  let parsed = true;
  for (const source of inputs) {
    const result = parseFile(source);
    problems.push(...result.problems);
    if (result.ok) files.push(result.file);
    else parsed = false;
  }

  const merged = mergeFiles(files);
  problems.push(...merged.problems);
  const valid = validate(merged);
  problems.push(...valid.problems);
  problems.push(...checkReferences(valid.sections, valid.origins, valid.invalidIds));

  const sources: Record<string, SourceRef> = {};
  for (const [id, origin] of valid.origins) {
    sources[id] = {
      file: origin.file.name,
      line: lineOf(origin.file, origin.path) ?? 1,
      raw: rawText(origin.file, origin.path),
    };
  }

  const model: SystemModel = {
    version: 1,
    meta: valid.meta,
    ...valid.sections,
    edges: deriveEdges(valid.sections),
    problems: sortProblems(problems),
    sources,
    files: inputs.map((s) => s.name),
    loadedAt: now.toISOString(),
    stale: false,
  };
  return { model, parsed };
}

/** Errors first, then by file and line, keeping discovery order otherwise. */
export function sortProblems(problems: Problem[]): Problem[] {
  return problems
    .map((p, i) => ({ p, i }))
    .sort(
      (a, b) =>
        Number(a.p.severity === 'warning') - Number(b.p.severity === 'warning') ||
        (a.p.file ?? '').localeCompare(b.p.file ?? '') ||
        (a.p.line ?? 0) - (b.p.line ?? 0) ||
        a.i - b.i,
    )
    .map(({ p }) => p);
}
