import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SourceFile } from '../src/server/model/parse.js';

export const EXAMPLES_DIR = fileURLToPath(new URL('../examples', import.meta.url));

export function exampleFiles(): SourceFile[] {
  return readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((name) => ({ name, text: readFileSync(`${EXAMPLES_DIR}/${name}`, 'utf8') }));
}

/** Strip the common indentation of a template literal, so fixtures can be indented. */
export function yaml(strings: TemplateStringsArray, ...values: unknown[]): string {
  const text = strings.reduce(
    (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ''),
    '',
  );
  const lines = text.replace(/^\n/, '').split('\n');
  const indent = Math.min(
    ...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length),
  );
  return lines.map((l) => l.slice(indent)).join('\n');
}
