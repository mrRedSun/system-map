/** Lookups over the model that every view needs. Pure; build once per model. */
import {
  SECTION_KIND,
  SECTIONS,
  type Edge,
  type EntityKind,
  type SystemModel,
} from '../../shared/model';
import type { AnyEntity, SectionKey } from '../../shared/schema';

export interface EntityRef {
  id: string;
  section: SectionKey;
  kind: EntityKind;
  entity: AnyEntity;
}

export interface ModelIndex {
  byId: Map<string, EntityRef>;
  /** Edges keyed by entity id, split by direction. */
  outgoing: Map<string, Edge[]>;
  incoming: Map<string, Edge[]>;
  /** Monitor ids per service (from `monitors[].service` and `services[].health.kuma`). */
  monitorsOf: Map<string, string[]>;
}

export function indexModel(model: SystemModel): ModelIndex {
  const byId = new Map<string, EntityRef>();
  for (const section of SECTIONS) {
    for (const entity of model[section] as AnyEntity[]) {
      byId.set(entity.id, { id: entity.id, section, kind: SECTION_KIND[section], entity });
    }
  }
  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  for (const e of model.edges) {
    push(outgoing, e.source, e);
    push(incoming, e.target, e);
  }
  const monitorsOf = new Map<string, string[]>();
  for (const m of model.monitors) if (m.service) pushUnique(monitorsOf, m.service, m.id);
  for (const s of model.services)
    for (const m of s.health?.kuma ?? []) pushUnique(monitorsOf, s.id, m);
  return { byId, outgoing, incoming, monitorsOf };
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function pushUnique(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);
  if (!list) map.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
}

export function displayName(ref: EntityRef | undefined): string {
  if (!ref) return '';
  const e = ref.entity as { name?: unknown; title?: unknown; host?: unknown; question?: unknown };
  for (const v of [e.name, e.title, e.host, e.question]) {
    if (typeof v === 'string' && v) return v;
  }
  return ref.id;
}

export type Status = 'running' | 'stopped' | 'deliberately-stopped' | 'retired';

export function statusOf(entity: AnyEntity): Status | undefined {
  const s = (entity as { status?: unknown }).status;
  return typeof s === 'string' ? (s as Status) : undefined;
}

/** Deliberately stopped and retired entities render dimmed. */
export function isDimmed(entity: AnyEntity): boolean {
  const s = statusOf(entity);
  return s === 'deliberately-stopped' || s === 'retired';
}

export const EXPOSURE_RANK = { internal: 0, lan: 1, restricted: 2, public: 3 } as const;
export type Exposure = keyof typeof EXPOSURE_RANK;

/** Widest exposure of a service: its ports, or public when a route targets it. */
export function exposureOf(index: ModelIndex, id: string): Exposure | undefined {
  const ref = index.byId.get(id);
  if (ref?.section !== 'services') return undefined;
  let best: Exposure | undefined;
  const consider = (e: Exposure | undefined) => {
    if (e && (best === undefined || EXPOSURE_RANK[e] > EXPOSURE_RANK[best])) best = e;
  };
  const service = ref.entity as SystemModel['services'][number];
  for (const p of service.ports ?? []) consider(p.exposure);
  if ((index.incoming.get(id) ?? []).some((e) => e.kind === 'routes-to')) consider('public');
  return best;
}

export interface BackRef {
  /** Entity that mentions this one. */
  from: string;
  /** Field that holds the reference, e.g. `scope` or `refs`. */
  field: string;
}

/** Non-edge references: policy scope, procedure applies_to, history and question refs. */
export function backRefs(model: SystemModel): Map<string, BackRef[]> {
  const out = new Map<string, BackRef[]>();
  const add = (from: string, field: string, ids: string[] | undefined) => {
    for (const id of ids ?? []) push(out, id, { from, field });
  };
  for (const p of model.policies) add(p.id, 'scope', p.scope);
  for (const p of model.procedures) add(p.id, 'applies_to', p.applies_to);
  for (const h of model.history) add(h.id, 'refs', h.refs);
  for (const q of model.open_questions) add(q.id, 'refs', q.refs);
  return out;
}

/** The node an entity lives on, then that node's ancestors (closest first). */
export function hostChain(index: ModelIndex, id: string): string[] {
  const ref = index.byId.get(id);
  let cur: string | undefined;
  if (ref?.section === 'nodes') cur = id;
  else if (ref?.section === 'services') cur = (ref.entity as SystemModel['services'][number]).node;
  else if (ref?.section === 'jobs') cur = (ref.entity as SystemModel['jobs'][number]).node;
  const chain: string[] = [];
  while (cur && !chain.includes(cur) && index.byId.get(cur)?.section === 'nodes') {
    chain.push(cur);
    cur = (index.byId.get(cur)!.entity as SystemModel['nodes'][number]).parent;
  }
  return chain;
}

/** DNS records for a hostname: exact matches, else a matching `*.` wildcard (DNS semantics). */
export function dnsRecordsFor(model: SystemModel, host: string) {
  type Rec = NonNullable<SystemModel['zones'][number]['records']>[number];
  const exact: { zone: string; record: Rec }[] = [];
  const wildcard: { zone: string; record: Rec }[] = [];
  const h = host.toLowerCase();
  for (const z of model.zones) {
    for (const r of z.records ?? []) {
      const name = r.name.toLowerCase();
      if (name === h) exact.push({ zone: z.id, record: r });
      else if (name.startsWith('*.') && h.endsWith(name.slice(1))) {
        wildcard.push({ zone: z.id, record: r });
      }
    }
  }
  return exact.length > 0 ? exact : wildcard;
}
