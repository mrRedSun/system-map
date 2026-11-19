/**
 * Validate a data directory and print its problems.
 * Usage: validate [dir] [--strict]   (exit 1 on errors, or on warnings with --strict)
 */
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { buildModel, sortProblems } from './model/build.js';
import { readDataFiles } from './store.js';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const dir = args.find((a) => !a.startsWith('--')) ?? process.env.DATA_DIR ?? '/data';

const program = Effect.gen(function* () {
  const read = yield* readDataFiles(dir);
  const { model } = buildModel(read.files);
  const problems = sortProblems([...read.problems, ...model.problems]);
  const out: string[] = [];
  for (const p of problems) {
    const where = p.file ? `${p.file}${p.line ? `:${p.line}` : ''}` : dir;
    out.push(`${p.severity.padEnd(7)} ${where}  ${p.message}\n`);
  }
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.length - errors;
  out.push(
    `${read.files.length} files, ${Object.keys(model.sources).length} entities, ${model.edges.length} edges: ${errors} errors, ${warnings} warnings\n`,
  );
  process.stdout.write(out.join(''));
  return errors > 0 || (strict && warnings > 0) ? 1 : 0;
}).pipe(Effect.provide(NodeServices.layer));

process.exitCode = await Effect.runPromise(program);
