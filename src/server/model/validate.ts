/**
 * Validate merged items one at a time so a bad entity does not hide the rest:
 * schema errors drop the entity, unknown keys only warn, and duplicate ids keep the first.
 */
import { Result, Schema, SchemaIssue } from 'effect';
import type { Problem } from '../../shared/model.js';
import {
  SECTION_KEYS,
  looseSchemas,
  strictSchemas,
  type AnyEntity,
  type Meta,
  type SectionItem,
  type SectionKey,
} from '../../shared/schema.js';
import type { MergeResult, Origin } from './merge.js';
import { formatPath, lineOf, type PathSegment } from './parse.js';

export type Sections = { [K in SectionKey]: SectionItem<K>[] };

export interface ValidationResult {
  meta: Meta;
  sections: Sections;
  /** Where each accepted entity is defined. */
  origins: Map<string, Origin>;
  /** Ids of entities that were dropped because they failed validation. */
  invalidIds: Set<string>;
  problems: Problem[];
}

/** One schema finding: an unknown key, or an error at a path. */
export interface Finding {
  kind: 'unknown-key' | 'error';
  path: PathSegment[];
  message: string;
}

const UNKNOWN_KEY = '\u0000unknown-key';

const format = SchemaIssue.makeFormatterStandardSchemaV1({
  leafHook: (issue) => {
    if (issue._tag === 'UnexpectedKey') return UNKNOWN_KEY;
    if (issue._tag === 'MissingKey') return 'required';
    return SchemaIssue.defaultLeafHook(issue);
  },
});

/** Decode `value`; `strict` reports only keys the schema does not declare. */
export function check(
  schema: Schema.Decoder<unknown>,
  value: unknown,
  strict: boolean,
): { ok: true; value: unknown } | { ok: false; findings: Finding[] } {
  const result = Schema.decodeUnknownResult(schema)(value, {
    errors: 'all',
    ...(strict ? { onExcessProperty: 'error' as const } : {}),
  });
  if (Result.isSuccess(result)) return { ok: true, value: result.success };
  const findings: Finding[] = [];
  for (const issue of format(result.failure.issue).issues) {
    const path = (issue.path ?? []).map((p) =>
      typeof p === 'object' && p !== null ? (p as { key: PropertyKey }).key : p,
    ) as PropertyKey[];
    const clean = path.filter((p): p is string | number => typeof p !== 'symbol');
    if (issue.message === UNKNOWN_KEY)
      findings.push({ kind: 'unknown-key', path: clean, message: '' });
    else if (!strict) findings.push({ kind: 'error', path: clean, message: issue.message });
  }
  return { ok: false, findings };
}

export function validate(merged: MergeResult): ValidationResult {
  const problems: Problem[] = [];
  const origins = new Map<string, Origin>();
  const invalidIds = new Set<string>();
  const sections = Object.fromEntries(SECTION_KEYS.map((k) => [k, []])) as unknown as Sections;

  const meta = validateMeta(merged, problems);

  const accepted: { section: SectionKey; entity: AnyEntity; origin: Origin }[] = [];
  for (const section of SECTION_KEYS) {
    const loose = looseSchemas.sections[section] as unknown as Schema.Decoder<unknown>;
    const strict = strictSchemas.sections[section] as unknown as Schema.Decoder<unknown>;
    for (const { value, origin } of merged.sections[section]) {
      const rawId =
        typeof value === 'object' && value !== null && 'id' in value
          ? (value as { id: unknown }).id
          : undefined;
      const id = typeof rawId === 'string' ? rawId : undefined;

      const parsed = check(loose, value, false);
      if (!parsed.ok) {
        if (id) invalidIds.add(id);
        problems.push(
          ...findingProblems(parsed.findings, origin, id, {
            suffix: id ? ` (\`${id}\` skipped)` : ' (entry skipped)',
          }),
        );
        continue;
      }
      const strictResult = check(strict, value, true);
      if (!strictResult.ok) problems.push(...findingProblems(strictResult.findings, origin, id));
      accepted.push({ section, entity: parsed.value as AnyEntity, origin });
    }
  }

  // Ids are unique across kinds; the definition that comes first in merge order wins.
  for (const { entity, origin } of [...accepted].sort((a, b) => a.origin.order - b.origin.order)) {
    const previous = origins.get(entity.id);
    if (!previous) {
      origins.set(entity.id, origin);
      continue;
    }
    problems.push({
      severity: 'error',
      code: 'duplicate-id',
      message: `Duplicate id \`${entity.id}\`; first defined in ${previous.file.name}:${
        lineOf(previous.file, previous.path) ?? '?'
      }, this one is ignored`,
      file: origin.file.name,
      line: lineOf(origin.file, [...origin.path, 'id']),
      path: formatPath(origin.path),
      entity: entity.id,
    });
  }
  for (const { section, entity, origin } of accepted) {
    if (origins.get(entity.id) === origin) (sections[section] as AnyEntity[]).push(entity);
  }
  return { meta, sections, origins, invalidIds, problems };
}

function validateMeta(merged: MergeResult, problems: Problem[]): Meta {
  const parsed = check(looseSchemas.meta as unknown as Schema.Decoder<unknown>, merged.meta, false);
  const strict = check(strictSchemas.meta as unknown as Schema.Decoder<unknown>, merged.meta, true);
  const findings = [...(parsed.ok ? [] : parsed.findings), ...(strict.ok ? [] : strict.findings)];
  for (const finding of findings) {
    const path = ['meta', ...finding.path];
    // Attribute the problem to the last file that defines the path.
    const file =
      [...merged.metaFiles].reverse().find((f) => f.doc.hasIn(path)) ?? merged.metaFiles.at(-1);
    if (!file) continue;
    problems.push(
      ...findingProblems([finding], { file, path: ['meta'], order: -1 }, undefined, {}, true),
    );
  }
  return parsed.ok ? (parsed.value as Meta) : {};
}

function findingProblems(
  findings: readonly Finding[],
  origin: Origin,
  entity: string | undefined,
  { suffix = '' }: { suffix?: string } = {},
  pathIsFull = false,
): Problem[] {
  return findings.map((f) => {
    const path = pathIsFull ? ['meta', ...f.path] : [...origin.path, ...f.path];
    if (f.kind === 'unknown-key') {
      const key = String(path.at(-1));
      return {
        severity: 'warning',
        code: 'unknown-key',
        message: `Unknown key \`${key}\``,
        file: origin.file.name,
        line: lineOf(origin.file, path.slice(0, -1), key),
        path: formatPath(path),
        entity,
      } satisfies Problem;
    }
    const where = formatPath(path);
    return {
      severity: 'error',
      code: 'schema',
      message: `${where}: ${f.message}${suffix}`,
      file: origin.file.name,
      line: lineOf(origin.file, path),
      path: where,
      entity,
    } satisfies Problem;
  });
}
