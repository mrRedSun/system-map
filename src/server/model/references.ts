/** Reference checks (dangling or wrong-kind ids, parent cycles) and derived edges. */
import { SECTION_KIND, type Edge, type EdgeKind, type Problem } from '../../shared/model.js';
import { ID_PATTERN, SECTION_KEYS, type SectionKey } from '../../shared/schema.js';
import type { Origin } from './merge.js';
import { formatPath, lineOf, type PathSegment } from './parse.js';
import type { Sections } from './validate.js';

const ID_RE = new RegExp(ID_PATTERN);

interface RefSite {
  owner: string;
  section: SectionKey;
  /** Path relative to the owning entity. */
  path: PathSegment[];
  target: string;
  /** Required section of the target, if restricted. */
  expect?: SectionKey;
  /** Calls may name things outside the model; unknown targets only warn. */
  soft?: boolean;
}

/** Every reference in the model, in a stable order. */
export function collectRefs(s: Sections): RefSite[] {
  const out: RefSite[] = [];
  const add = (
    owner: string,
    section: SectionKey,
    path: PathSegment[],
    target: unknown,
    expect?: SectionKey,
    soft?: boolean,
  ) => {
    if (typeof target === 'string') out.push({ owner, section, path, target, expect, soft });
  };
  const addAll = (
    owner: string,
    section: SectionKey,
    key: string,
    list: unknown[] | undefined,
    expect?: SectionKey,
  ) => list?.forEach((t, i) => add(owner, section, [key, i], t, expect));

  for (const p of s.policies) addAll(p.id, 'policies', 'scope', p.scope);
  for (const p of s.procedures) addAll(p.id, 'procedures', 'applies_to', p.applies_to);
  for (const n of s.nodes) {
    add(n.id, 'nodes', ['parent'], n.parent, 'nodes');
    add(n.id, 'nodes', ['network'], n.network, 'networks');
    n.mounts?.forEach((m, i) => add(n.id, 'nodes', ['mounts', i, 'storage'], m.storage, 'nodes'));
  }
  for (const v of s.services) {
    add(v.id, 'services', ['node'], v.node, 'nodes');
    v.calls?.forEach((c, i) =>
      add(v.id, 'services', ['calls', i, 'target'], c.target, undefined, true),
    );
    v.health?.kuma?.forEach((m, i) => add(v.id, 'services', ['health', 'kuma', i], m, 'monitors'));
  }
  for (const r of s.routes) add(r.id, 'routes', ['target'], r.target, 'services');
  for (const m of s.monitors) {
    add(m.id, 'monitors', ['service'], m.service, 'services');
    add(m.id, 'monitors', ['node'], m.node, 'nodes');
  }
  for (const j of s.jobs) add(j.id, 'jobs', ['node'], j.node, 'nodes');
  for (const b of s.backups) addAll(b.id, 'backups', 'from', b.from);
  for (const h of s.history) addAll(h.id, 'history', 'refs', h.refs);
  for (const q of s.open_questions) addAll(q.id, 'open_questions', 'refs', q.refs);
  return out;
}

export function indexIds(s: Sections): Map<string, SectionKey> {
  const index = new Map<string, SectionKey>();
  for (const section of SECTION_KEYS) for (const e of s[section]) index.set(e.id, section);
  return index;
}

export function checkReferences(
  s: Sections,
  origins: Map<string, Origin>,
  invalidIds: Set<string>,
): Problem[] {
  const index = indexIds(s);
  const problems: Problem[] = [];
  const at = (owner: string, path: PathSegment[]) => {
    const origin = origins.get(owner);
    if (!origin) return {};
    const full = [...origin.path, ...path];
    return { file: origin.file.name, line: lineOf(origin.file, full), path: formatPath(full) };
  };

  for (const ref of collectRefs(s)) {
    const found = index.get(ref.target);
    if (found === undefined) {
      // Already reported as a schema error.
      if (invalidIds.has(ref.target)) continue;
      if (ref.soft) {
        if (ID_RE.test(ref.target)) {
          problems.push({
            severity: 'warning',
            code: 'dangling-ref',
            message: `\`${ref.owner}\` calls \`${ref.target}\`, which is not a known id; shown as an external label`,
            entity: ref.owner,
            ...at(ref.owner, ref.path),
          });
        }
        continue;
      }
      problems.push({
        severity: 'error',
        code: 'dangling-ref',
        message: `\`${ref.owner}\` references unknown id \`${ref.target}\``,
        entity: ref.owner,
        ...at(ref.owner, ref.path),
      });
    } else if (ref.expect && found !== ref.expect) {
      problems.push({
        severity: 'error',
        code: 'dangling-ref',
        message: `\`${ref.owner}\`.${formatPath(ref.path)} must reference a ${SECTION_KIND[ref.expect]}, but \`${ref.target}\` is a ${SECTION_KIND[found]}`,
        entity: ref.owner,
        ...at(ref.owner, ref.path),
      });
    }
  }

  // Parent cycles would make the topology infinite.
  const parentOf = new Map(s.nodes.map((n) => [n.id, n.parent]));
  const reported = new Set<string>();
  for (const n of s.nodes) {
    const seen = new Set<string>();
    let cur: string | undefined = n.id;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur);
    }
    if (cur !== undefined && cur === n.id && !reported.has(n.id)) {
      for (const id of seen) reported.add(id);
      problems.push({
        severity: 'error',
        code: 'dangling-ref',
        message: `Parent cycle: ${[...seen, n.id].map((x) => `\`${x}\``).join(' → ')}`,
        entity: n.id,
        ...at(n.id, ['parent']),
      });
    }
  }
  return problems;
}

/** Relationships derived from references; edges to unknown ids are left out. */
export function deriveEdges(s: Sections): Edge[] {
  const index = indexIds(s);
  const edges: Edge[] = [];
  const counts = new Map<string, number>();
  const add = (kind: EdgeKind, source: string, target: string | undefined, label?: string) => {
    if (target === undefined || !index.has(source) || !index.has(target)) return;
    const base = `${kind}:${source}>${target}`;
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    edges.push({
      id: n === 0 ? base : `${base}#${n}`,
      kind,
      source,
      target,
      ...(label ? { label } : {}),
    });
  };

  for (const n of s.nodes) {
    add('contains', n.parent ?? '', n.id);
    for (const m of n.mounts ?? []) add('mounts', n.id, m.storage, m.target ?? m.purpose);
  }
  for (const v of s.services) {
    add('runs-on', v.id, v.node);
    for (const c of v.calls ?? []) add('calls', v.id, c.target, c.purpose ?? c.via);
  }
  for (const r of s.routes) add('routes-to', r.id, r.target, r.host);
  for (const m of s.monitors) add('monitors', m.id, m.service ?? m.node, m.name);
  for (const b of s.backups) for (const f of b.from ?? []) add('backs-up', b.id, f, b.what);
  return edges;
}
