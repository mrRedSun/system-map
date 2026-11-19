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
