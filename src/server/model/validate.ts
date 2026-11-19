/**
 * Validate merged items one at a time so a bad entity does not hide the rest:
 * schema errors drop the entity, unknown keys only warn, and duplicate ids keep the first.
 */
import type { z } from 'zod';
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

export function validate(merged: MergeResult): ValidationResult {
  const problems: Problem[] = [];
  const origins = new Map<string, Origin>();
  const invalidIds = new Set<string>();
  const sections = Object.fromEntries(SECTION_KEYS.map((k) => [k, []])) as unknown as Sections;

  const meta = validateMeta(merged, problems);

  const accepted: { section: SectionKey; entity: AnyEntity; origin: Origin }[] = [];
  for (const section of SECTION_KEYS) {
    const loose = looseSchemas.sections[section] as z.ZodType;
    const strict = strictSchemas.sections[section] as z.ZodType;
    for (const { value, origin } of merged.sections[section]) {
      const rawId =
        typeof value === 'object' && value !== null && 'id' in value
          ? (value as { id: unknown }).id
          : undefined;
      const id = typeof rawId === 'string' ? rawId : undefined;

      const parsed = loose.safeParse(value);
      if (!parsed.success) {
        if (id) invalidIds.add(id);
        problems.push(
          ...issueProblems(parsed.error.issues, origin, id, {
            suffix: id ? ` (\`${id}\` skipped)` : ' (entry skipped)',
          }),
        );
        continue;
      }
      const strictResult = strict.safeParse(value);
      if (!strictResult.success) {
        problems.push(...issueProblems(strictResult.error.issues, origin, id));
      }
      accepted.push({ section, entity: parsed.data as AnyEntity, origin });
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
  const parsed = looseSchemas.meta.safeParse(merged.meta);
  const strict = strictSchemas.meta.safeParse(merged.meta);
  const issues = [
    ...(parsed.success ? [] : parsed.error.issues),
    ...(strict.success ? [] : strict.error.issues.filter((i) => i.code === 'unrecognized_keys')),
  ];
  for (const issue of issues) {
    const path = ['meta', ...cleanPath(issue.path)];
    // Attribute the problem to the last file that defines the path.
    const file =
      [...merged.metaFiles].reverse().find((f) => f.doc.hasIn(path)) ?? merged.metaFiles.at(-1);
    if (!file) continue;
    problems.push(
      ...issueProblems([issue], { file, path: ['meta'], order: -1 }, undefined, {}, path),
    );
  }
  return parsed.success ? parsed.data : {};
}

function cleanPath(path: readonly PropertyKey[]): PathSegment[] {
  return path.filter((s): s is string | number => typeof s !== 'symbol');
}

function issueProblems(
  issues: readonly z.core.$ZodIssue[],
  origin: Origin,
  entity: string | undefined,
  { suffix = '' }: { suffix?: string } = {},
  fullPathOverride?: PathSegment[],
): Problem[] {
  const out: Problem[] = [];
  for (const issue of issues) {
    const path = fullPathOverride ?? [...origin.path, ...cleanPath(issue.path)];
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        out.push({
          severity: 'warning',
          code: 'unknown-key',
          message: `Unknown key \`${key}\``,
          file: origin.file.name,
          line: lineOf(origin.file, path, key),
          path: formatPath([...path, key]),
          entity,
        });
      }
      continue;
    }
    const where = formatPath(path);
    out.push({
      severity: 'error',
      code: 'schema',
      message: `${where}: ${describeIssue(issue)}${suffix}`,
      file: origin.file.name,
      line: lineOf(origin.file, path),
      path: where,
      entity,
    });
  }
  return out;
}

function describeIssue(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_type' && issue.message.endsWith('received undefined')) {
    return 'required';
  }
  return issue.message;
}
