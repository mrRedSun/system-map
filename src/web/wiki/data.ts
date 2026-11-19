/** What the wiki shows, derived from the model. Pure; the pages render these. */
import type { HealthStatus, SystemModel } from '../../shared/model';
import { sortedStacks } from '@/graph/apps';
import { displayName, hostChain, statusOf, type ModelIndex } from '@/lib/model-index';

type Service = SystemModel['services'][number];
type Node = SystemModel['nodes'][number];
type Stack = SystemModel['stacks'][number];

/** Apps without a (known) stack are listed under this pseudo-stack. */
export const OTHER = 'other';

const active = (e: { status?: string }) => e.status !== 'retired';

export interface Glance {
  guests: number;
  apps: number;
  publicRoutes: number;
  monitors: number;
  jobs: number;
}

/** Counts for the home page; retired things are left out. */
export function glance(model: SystemModel): Glance {
  return {
    guests: model.nodes.filter((n) => (n.kind === 'vm' || n.kind === 'lxc') && active(n)).length,
    apps: model.services.filter(active).length,
    publicRoutes: model.routes.length,
    monitors: model.monitors.filter((m) => m.active !== false).length,
    jobs: model.jobs.length,
  };
}

export interface HealthSummary {
  up: number;
  down: string[];
  pending: string[];
  unknown: number;
}

/** Monitored, active apps by their health; ids of the ones that need attention. */
export function healthSummary(
  model: SystemModel,
  healthOf: (id: string) => HealthStatus | undefined,
): HealthSummary {
  const out: HealthSummary = { up: 0, down: [], pending: [], unknown: 0 };
  for (const s of model.services.filter(active)) {
    const h = healthOf(s.id);
    if (h === 'up' || h === 'maintenance') out.up++;
    else if (h === 'down') out.down.push(s.id);
    else if (h === 'pending') out.pending.push(s.id);
    else out.unknown++;
  }
  return out;
}

export interface StackGroup {
  /** Stack id, or `OTHER`. */
  id: string;
  stack?: Stack;
  apps: Service[];
}

/** Stacks in display order with their active apps; apps without a stack last, under "Other". */
export function stackGroups(model: SystemModel): StackGroup[] {
  const stacks = sortedStacks(model);
  const known = new Set(stacks.map((s) => s.id));
  const groups: StackGroup[] = stacks.map((stack) => ({
    id: stack.id,
    stack,
    apps: model.services.filter((s) => s.stack === stack.id && active(s)),
  }));
  const other = model.services.filter((s) => (!s.stack || !known.has(s.stack)) && active(s));
  if (other.length > 0) groups.push({ id: OTHER, apps: other });
  return groups;
}

/** Articles in display order: `order` first (missing last), then file order. */
export function sortedArticles(model: SystemModel): SystemModel['articles'] {
  return model.articles
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.order ?? Infinity) - (y.a.order ?? Infinity) || x.i - y.i)
    .map(({ a }) => a);
}

/** Nodes in tree order (parents before children), depth for indentation. */
export function nodeTree(model: SystemModel): { node: Node; depth: number }[] {
  const children = new Map<string | undefined, Node[]>();
  const ids = new Set(model.nodes.map((n) => n.id));
  for (const n of model.nodes) {
    const parent = n.parent && ids.has(n.parent) ? n.parent : undefined;
    children.set(parent, [...(children.get(parent) ?? []), n]);
  }
  const out: { node: Node; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | undefined, depth: number) => {
    for (const n of children.get(parent) ?? []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ node: n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(undefined, 0);
  // Nodes caught in a parent cycle (a validation error) are still listed.
  for (const n of model.nodes) if (!seen.has(n.id)) out.push({ node: n, depth: 0 });
  return out;
}

export interface CoverageGap {
  id: string;
  section: 'services' | 'nodes' | 'stacks';
  missing: string[];
}

/** Active entities without the plain-language text the wiki leads with. */
export function coverage(model: SystemModel): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const s of model.stacks) {
    const missing = [...(s.summary ? [] : ['summary']), ...(s.description ? [] : ['description'])];
    if (missing.length > 0) gaps.push({ id: s.id, section: 'stacks', missing });
  }
  for (const s of model.services.filter(active)) {
    if (!s.summary) gaps.push({ id: s.id, section: 'services', missing: ['summary'] });
  }
  for (const n of model.nodes.filter(active)) {
    if (!n.summary) gaps.push({ id: n.id, section: 'nodes', missing: ['summary'] });
  }
  return gaps;
}

/** Share of active services, nodes and stacks that have a summary. */
export function coverageRatio(model: SystemModel): { documented: number; total: number } {
  const all = [...model.stacks, ...model.services.filter(active), ...model.nodes.filter(active)];
  return { documented: all.filter((e) => Boolean(e.summary)).length, total: all.length };
}

/** Everything that mentions an id through a reference list (policies, procedures, articles…). */
export function mentions(model: SystemModel, id: string) {
  return {
    policies: model.policies.filter((p) => p.scope?.includes(id)),
    procedures: model.procedures.filter((p) => p.applies_to?.includes(id)),
    articles: model.articles.filter((a) => a.refs?.includes(id)),
    history: model.history.filter((h) => h.refs?.includes(id)),
    questions: model.open_questions.filter((q) => q.refs?.includes(id)),
    backups: model.backups.filter((b) => b.from?.includes(id)),
  };
}

/** Jobs on a node, or on the node a service runs on. */
export function jobsNear(model: SystemModel, index: ModelIndex, id: string) {
  const ref = index.byId.get(id);
  const node = ref?.section === 'services' ? (ref.entity as Service).node : id;
  return model.jobs.filter((j) => j.node === node);
}

/** A model with only one stack's apps, for the stack page's small graph. Calls to apps outside
 * the stack become external cards named after their target. */
export function stackModel(model: SystemModel, index: ModelIndex, stackId: string): SystemModel {
  const inStack = (s: Service) =>
    stackId === OTHER
      ? !s.stack || !model.stacks.some((x) => x.id === s.stack)
      : s.stack === stackId;
  const services = model.services.filter(inStack);
  const ids = new Set(services.map((s) => s.id));
  const routeTarget = new Map(model.routes.map((r) => [r.id, r.target]));
  return {
    ...model,
    stacks: model.stacks.filter((s) => s.id === stackId),
    routes: model.routes.filter((r) => ids.has(r.target)),
    services: services.map((s) => ({
      ...s,
      calls: s.calls?.map((c) => {
        const target = routeTarget.get(c.target) ?? c.target;
        if (ids.has(target) || !index.byId.has(target)) return c;
        // Devices and nodes keep their cards; other apps become named externals.
        if (index.byId.get(target)?.section === 'nodes') return c;
        return { ...c, target: displayName(index.byId.get(target)) };
      }),
    })),
  };
}

/** True when the entity is retired (or runs inside something retired). */
export function isRetired(index: ModelIndex, id: string): boolean {
  const ref = index.byId.get(id);
  if (!ref) return false;
  if (statusOf(ref.entity) === 'retired') return true;
  return hostChain(index, id).some((n) => {
    const e = index.byId.get(n)?.entity;
    return e ? statusOf(e) === 'retired' : false;
  });
}
