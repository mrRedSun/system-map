import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { toJsonSchema } from '../src/shared/schema.js';
import { exampleFiles } from './helpers.js';

const published = JSON.parse(
  readFileSync(new URL('../schema/system-map.schema.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

describe('published JSON Schema', () => {
  it('matches the zod schema', () => {
    expect(published).toEqual(JSON.parse(JSON.stringify(toJsonSchema())));
  });

  it('accepts every example file', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats.default(ajv);
    const check = ajv.compile(published);
    for (const f of exampleFiles()) {
      const ok = check(parse(f.text));
      expect(ok ? [] : check.errors, f.name).toEqual([]);
    }
  });

  it('rejects an invalid entity', () => {
    const ajv = new Ajv2020({ strict: false });
    addFormats.default(ajv);
    const check = ajv.compile(published);
    expect(check({ version: 1, nodes: [{ id: 'x', kind: 'spaceship' }] })).toBe(false);
    expect(check({ nodes: [] })).toBe(false);
  });
});
