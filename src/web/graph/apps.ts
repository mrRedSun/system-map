/**
 * The Apps graph: one item per service, grouped by stack, with `calls` as edges. Calls through a
 * route land on the route's target service; calls to other entities become small device items;
 * free-text targets become external items. Pure, so it is unit-tested without a browser.
 */
import { STACK_COLORS, type SystemModel } from '../../shared/model';
import { displayName, hostChain, isDimmed, statusOf, type ModelIndex } from '../lib/model-index';

type Service = SystemModel['services'][number];
type Node = SystemModel['nodes'][number];
export type StackColor = (typeof STACK_COLORS)[number];

/** Group for apps without a (known) stack. Colons never occur in entity ids. */
export const OTHER_STACK = 'group:other';

export type AppItemKind = 'app' | 'stack' | 'device' | 'external' | 'ingress';

export interface AppItem {
  /** Service or entity id; `group:other`, `ext:<label>` and `ingress:<via>` are synthetic. */
  id: string;
  kind: AppItemKind;
  label: string;
  /**
   * Expanded group that holds this item: the app's stack; for a device or external, the stack
   * that calls it most (ties: the earlier stack).
   */
  parent?: string;
  /** Groups: number of apps inside. */
  childCount: number;
  /** Stacks: drawn as a group box with its apps inside. */
  expanded: boolean;
  dimmed: boolean;
  /** Entity behind the item (opens the detail panel), when there is one. */
  entity?: string;
  /** Apps: where it runs, e.g. `CT 120`. */
  host?: string;
  /** Apps: public hostnames of routes that target it. */
  public: string[];
  /** Stacks: tint. */
  color?: StackColor;
}

export type AppEdgeKind = 'use' | 'observe' | 'ingress';

export interface AppEdge {
  id: string;
  kind: AppEdgeKind;
  source: string;
  target: string;
  /** Number of calls merged into this edge. */
  count: number;
  /** Purpose, or protocol when there is no purpose, of each merged call. */
  labels: string[];
  /** Public hostnames the calls go through (calls that target a route). */
  via: string[];
}

export interface AppsGraph {
  items: AppItem[];
  edges: AppEdge[];
}

export interface AppsOptions {
  /** Stack group ids drawn as a single item. */
  collapsed: ReadonlySet<string>;
  showRetired: boolean;
  /** Draw free-text call targets. */
  externals: boolean;
  /** Draw ingress → app edges for public routes. */
  ingress: boolean;
}

export const DEFAULT_APPS_OPTIONS = { externals: true, ingress: false } as const;

/** Key that merges free-text targets: case, surrounding and repeated spaces do not matter. */
export function externalKey(label: string): string {
  return `ext:${label.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

/** Short "where it runs" chip: `CT 120`, `VM 101`, or the node's hostname or name. */
export function hostLabel(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (node.vmid !== undefined && node.kind === 'lxc') return `CT ${node.vmid}`;
  if (node.vmid !== undefined && node.kind === 'vm') return `VM ${node.vmid}`;
  return node.hostname ?? node.name ?? node.id;
}

/** Stacks in display order: `order` first (missing last), then file order. */
export function sortedStacks(model: SystemModel): SystemModel['stacks'] {
  return model.stacks
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.order ?? Infinity) - (b.s.order ?? Infinity) || a.i - b.i)
    .map(({ s }) => s);
}

/** Stack group a service is drawn in, or undefined when apps are not grouped at all. */
export function stackGroupOf(model: SystemModel, serviceId: string): string | undefined {
  const known = new Set(model.stacks.map((s) => s.id));
  if (!model.services.some((s) => s.stack && known.has(s.stack))) return undefined;
  const service = model.services.find((s) => s.id === serviceId);
  if (!service) return undefined;
  return service.stack && known.has(service.stack) ? service.stack : OTHER_STACK;
}

/** Longest purpose shown on the canvas; the detail panel has the full text. */
const LABEL_MAX = 36;
const clip = (s: string) =>
  s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1).replace(/[\s,.;:-]+$/, '')}…` : s;

/** Edge label: purposes (or protocol, or port), call count, and the route hostname. */
export function edgeLabel(e: AppEdge): string {
  const shown = e.labels.slice(0, 2).map(clip).join(', ');
  const more = e.labels.length > 2 ? ` +${e.labels.length - 2}` : '';
  const count = e.count > 1 ? ` ×${e.count}` : '';
  const via = e.via.length > 0 ? `via ${e.via.join(', ')}` : '';
  return [`${shown}${more}${count}`.trim(), via].filter(Boolean).join(' · ');
}

export function buildApps(model: SystemModel, index: ModelIndex, options: AppsOptions): AppsGraph {
  const retired = (id: string) => {
    const ref = index.byId.get(id);
    return ref !== undefined && statusOf(ref.entity) === 'retired';
  };
  /** A service is hidden when it, or a node it runs inside, is retired. */
  const hidden = (id: string) =>
    !options.showRetired && (retired(id) || hostChain(index, id).some(retired));

  const services = model.services.filter((s) => !hidden(s.id));
  const serviceIds = new Set(services.map((s) => s.id));
  const stacks = sortedStacks(model);
  const stackIds = new Set(stacks.map((s) => s.id));
  const groupOf = (s: Service) => (s.stack && stackIds.has(s.stack) ? s.stack : OTHER_STACK);
  // Without any stacks, apps are not boxed at all.
  const grouped = services.some((s) => groupOf(s) !== OTHER_STACK);

  const publicOf = new Map<string, string[]>();
  for (const r of model.routes) {
    const hosts = publicOf.get(r.target) ?? [];
    const paths = r.paths?.length ? r.paths : [''];
    for (const p of paths) {
      const host = p && p.startsWith('/') ? `${r.host}${p}` : r.host;
      if (!hosts.includes(host)) hosts.push(host);
    }
    publicOf.set(r.target, hosts);
  }

  // Calls resolved to services or to extra items (devices, externals, ingress points).
  interface RawEdge {
    kind: AppEdgeKind;
    from: string;
    to: string;
    label?: string;
    via?: string;
  }
  const extras = new Map<string, AppItem>();
  const addExtra = (item: Pick<AppItem, 'id' | 'kind' | 'label' | 'dimmed' | 'entity'>) => {
    if (!extras.has(item.id)) {
      extras.set(item.id, { ...item, childCount: 0, expanded: false, public: [] });
    }
    return item.id;
  };
  const resolve = (target: string): { to: string; via?: string } | undefined => {
    const ref = index.byId.get(target);
    if (!ref) {
      if (!options.externals) return undefined;
      const label = target.trim().replace(/\s+/g, ' ');
      return { to: addExtra({ id: externalKey(target), kind: 'external', label, dimmed: false }) };
    }
    if (ref.section === 'services') return serviceIds.has(target) ? { to: target } : undefined;
    if (ref.section === 'routes') {
      const route = ref.entity as SystemModel['routes'][number];
      return serviceIds.has(route.target) ? { to: route.target, via: route.host } : undefined;
    }
    if (hidden(target)) return undefined;
    const id = addExtra({
      id: target,
      kind: 'device',
      label: displayName(ref),
      dimmed: isDimmed(ref.entity),
      entity: target,
    });
    return { to: id };
  };

  const calls: RawEdge[] = [];
  for (const s of services) {
    for (const c of s.calls ?? []) {
      const r = resolve(c.target);
      if (r)
        calls.push({
          kind: c.kind ?? 'use',
          from: s.id,
          to: r.to,
          label: c.purpose ?? c.via ?? (c.port !== undefined ? `:${c.port}` : undefined),
          via: r.via,
        });
    }
  }
  const ingressEdges: RawEdge[] = [];
  if (options.ingress) {
    for (const r of model.routes) {
      if (!serviceIds.has(r.target)) continue;
      const proxy = services.find((s) => s.id === r.via || s.name.toLowerCase() === r.via);
      const from = proxy
        ? proxy.id
        : addExtra({ id: `ingress:${r.via}`, kind: 'ingress', label: r.via, dimmed: false });
      ingressEdges.push({ kind: 'ingress', from, to: r.target, label: r.host });
    }
  }

  // Groups. An extra item called from one stack only sits in that stack; shared ones go Outside.
  const groupOfService = new Map(services.map((s) => [s.id, grouped ? groupOf(s) : '']));
  // A device or external sits in the stack that uses it most, so most of its edges stay short
  // (a separate box for shared ones costs a row and draws lines across the whole map).
  const groupRank = new Map([
    ...stacks.map((st, i) => [st.id, i] as const),
    [OTHER_STACK, stacks.length],
  ]);
  const uses = new Map<string, Map<string, number>>();
  const countUse = (extra: string, service: string) => {
    const counts = uses.get(extra) ?? new Map<string, number>();
    const g = groupOfService.get(service)!;
    counts.set(g, (counts.get(g) ?? 0) + 1);
    uses.set(extra, counts);
  };
  for (const c of calls) if (extras.has(c.to)) countUse(c.to, c.from);
  for (const c of ingressEdges) if (extras.has(c.from)) countUse(c.from, c.to);
  const groupOfExtra = (id: string) => {
    if (!grouped) return '';
    const counts = [...(uses.get(id) ?? new Map<string, number>())];
    counts.sort((a, b) => b[1] - a[1] || groupRank.get(a[0])! - groupRank.get(b[0])!);
    return counts[0]?.[0] ?? OTHER_STACK;
  };

  const apps = new Map<string, Service[]>();
  for (const s of services) push(apps, groupOfService.get(s.id)!, s);
  const extraMembers = new Map<string, AppItem[]>();
  const sortedExtras = [...extras.values()].sort((a, b) => rank(a.kind) - rank(b.kind));
  for (const e of sortedExtras) push(extraMembers, groupOfExtra(e.id), e);

  const items: AppItem[] = [];
  /** Visible item each app or extra is drawn as: itself, or its collapsed group. */
  const shownAs = new Map<string, string>();
  const appItem = (s: Service, parent: string | undefined): AppItem => ({
    id: s.id,
    kind: 'app',
    label: s.name,
    parent,
    childCount: 0,
    expanded: false,
    dimmed: isDimmed(s),
    entity: s.id,
    host: hostLabel(model.nodes.find((n) => n.id === s.node)),
    public: publicOf.get(s.id) ?? [],
  });
  const place = (groupId: string, expanded: boolean, parent: string | undefined) => {
    for (const s of apps.get(groupId) ?? []) {
      if (expanded) items.push(appItem(s, parent));
      shownAs.set(s.id, expanded ? s.id : groupId);
    }
    for (const e of extraMembers.get(groupId) ?? []) {
      if (expanded) items.push({ ...e, parent });
      shownAs.set(e.id, expanded ? e.id : groupId);
    }
  };

  if (!grouped) {
    place('', true, undefined);
  } else {
    const groups: { id: string; label: string; color?: StackColor; entity?: string }[] = [
      ...stacks.map((s) => ({ id: s.id, label: s.name ?? s.id, color: s.color, entity: s.id })),
      { id: OTHER_STACK, label: 'Other', color: 'gray' },
    ];
    let palette = 0;
    for (const g of groups) {
      const list = apps.get(g.id) ?? [];
      if (list.length === 0 && !extraMembers.has(g.id)) continue;
      const expanded = !options.collapsed.has(g.id);
      items.push({
        id: g.id,
        kind: 'stack',
        label: g.label,
        childCount: list.length,
        expanded,
        dimmed: list.length > 0 && list.every((s) => isDimmed(s)),
        entity: g.entity,
        public: [],
        color: g.color ?? autoColor(palette++),
      });
      place(g.id, expanded, g.id);
    }
  }

  const merged = new Map<string, AppEdge>();
  const addEdge = (raw: RawEdge) => {
    const source = shownAs.get(raw.from);
    const target = shownAs.get(raw.to);
    if (!source || !target || source === target) return;
    const callKey = `calls:${source}>${target}`;
    // A call already connects them; a second line on the same path adds nothing.
    if (raw.kind === 'ingress' && merged.has(callKey)) return;
    const key = raw.kind === 'ingress' ? `ingress:${source}>${target}` : callKey;
    let e = merged.get(key);
    if (!e) {
      e = { id: key, kind: raw.kind, source, target, count: 0, labels: [], via: [] };
      merged.set(key, e);
    } else if (raw.kind === 'use') {
      // Any real use outweighs observation of the same pair.
      e.kind = 'use';
    }
    e.count++;
    if (raw.label && !e.labels.includes(raw.label)) e.labels.push(raw.label);
    if (raw.via && !e.via.includes(raw.via)) e.via.push(raw.via);
  };
  for (const c of calls) addEdge(c);
  for (const c of ingressEdges) addEdge(c);

  return { items, edges: [...merged.values()] };
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

const rank = (kind: AppItemKind) => ({ device: 0, ingress: 1, external: 2 })[kind as string] ?? 0;

const autoColor = (i: number): StackColor => {
  const cycle = STACK_COLORS.filter((c) => c !== 'gray');
  return cycle[i % cycle.length]!;
};

/** Neighbours of an item along drawn edges, both directions, including itself. */
export function neighbours(graph: AppsGraph, id: string): Set<string> {
  const out = new Set<string>([id]);
  for (const e of graph.edges) {
    if (e.source === id) out.add(e.target);
    if (e.target === id) out.add(e.source);
  }
  return out;
}

/**
 * Focus: keep the item, its neighbours, their stacks, and the edges touching the item.
 * An item without edges (or not in the graph) leaves the graph as it is.
 */
export function focusGraph(graph: AppsGraph, id: string): AppsGraph {
  const keep = neighbours(graph, id);
  if (keep.size === 1) return graph;
  for (const item of graph.items) if (keep.has(item.id) && item.parent) keep.add(item.parent);
  return {
    items: graph.items.filter((i) => keep.has(i.id)),
    edges: graph.edges.filter((e) => e.source === id || e.target === id),
  };
}
