/** Write (or with --check, verify) schema/system-map.schema.json from the Effect schema. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toJsonSchema } from '../src/shared/schema.js';

const target = fileURLToPath(new URL('../schema/system-map.schema.json', import.meta.url));
const expected = `${JSON.stringify(toJsonSchema(), null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // Missing file is reported below.
  }
  if (current !== expected) {
    console.error('schema/system-map.schema.json is out of date; run `npm run schema`.');
    process.exit(1);
  }
  console.log('schema/system-map.schema.json is up to date.');
} else {
  writeFileSync(target, expected);
  console.log(`Wrote ${target}`);
}
