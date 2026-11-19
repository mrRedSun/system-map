/**
 * Turns the model into what the graph shows for a given expand state: a tree of visible items
 * (host → guests → services, plus groups for routes, monitors and backups) and edges between
 * visible items. Edges whose endpoints are inside collapsed items attach to the nearest visible
 * ancestor and are merged. Pure, so it is unit-tested without a browser.
 */
import type { EdgeKind, SystemModel } from '../../shared/model';
import { isDimmed, statusOf, type ModelIndex } from '../lib/model-index';

export const DRAWN_EDGE_KINDS = ['calls', 'routes-to', 'mounts', 'monitors', 'backs-up'] as const;
export type DrawnEdgeKind = (typeof DRAWN_EDGE_KINDS)[number];

export const DEFAULT_EDGE_KINDS: Record<DrawnEdgeKind, boolean> = {
  calls: true,
  'routes-to': true,
  mounts: true,
  monitors: false,
  'backs-up': false,
};

/** Synthetic groups that hold entities without a place in the node tree. */
export const GROUPS = {
  'group:routes': { label: 'Public routes', section: 'routes', edge: 'routes-to' },
  'group:monitors': { label: 'Monitors', section: 'monitors', edge: 'monitors' },
  'group:backups': { label: 'Backups', section: 'backups', edge: 'backs-up' },
} as const;
export type GroupId = keyof typeof GROUPS;

export interface TopologyOptions {
  expanded: ReadonlySet<string>;
  edgeKinds: Record<DrawnEdgeKind, boolean>;
  showRetired: boolean;
}

export interface TopoItem {
  id: string;
  /** Visible parent item, if any. */
  parent?: string;
  /** Number of direct children (visible or not). */
  childCount: number;
  /** Has children and is expanded: rendered as a container. */
  expanded: boolean;
  dimmed: boolean;
  /** Depth in the tree, 0 for roots. */
  depth: number;
}

export interface TopoEdge {
  id: string;
  kind: DrawnEdgeKind;
  source: string;
  target: string;
  /** Number of model edges merged into this one. */
  count: number;
  labels: string[];
}

export interface Topology {
  items: TopoItem[];
  edges: TopoEdge[];
}

export interface Tree {
  parentOf: Map<string, string>;
  children: Map<string, string[]>;
  roots: string[];
}

/** The full containment tree, before collapsing. */
export function buildTree(model: SystemModel, index: ModelIndex, showRetired: boolean): Tree {
  const parentOf = new Map<string, string>();
  const children = new Map<string, string[]>();
  const order: string[] = [];
  const hidden = (id: string) => {
    const ref = index.byId.get(id);
    return !showRetired && ref !== undefined && statusOf(ref.entity) === 'retired';
  };

  for (const n of model.nodes) {
    if (hidden(n.id)) continue;
    order.push(n.id);
    if (n.parent && index.byId.get(n.parent)?.section === 'nodes') parentOf.set(n.id, n.parent);
  }
  for (const s of model.services) {
    if (hidden(s.id)) continue;
    order.push(s.id);
    if (index.byId.get(s.node)?.section === 'nodes') parentOf.set(s.id, s.node);
  }
  for (const [groupId, group] of Object.entries(GROUPS)) {
    const members = model[group.section];
    if (members.length === 0) continue;
    order.push(groupId);
    for (const m of members) {
      order.push(m.id);
      parentOf.set(m.id, groupId);
    }
  }

  // Break parent cycles (reported by the server). Descendants of hidden items are hidden too.
  const excluded = new Set<string>();
  for (const id of order) {
    const seen = new Set<string>([id]);
    let cur = parentOf.get(id);
    while (cur !== undefined) {
      if (hidden(cur)) {
        excluded.add(id);
        break;
      }
      if (seen.has(cur)) {
        // Only a node on the cycle loses its parent; nodes hanging below it keep theirs.
        if (cur === id) parentOf.delete(id);
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }
  for (const id of excluded) parentOf.delete(id);

  const roots: string[] = [];
  for (const id of order) {
    if (excluded.has(id)) continue;
    const parent = parentOf.get(id);
    if (parent === undefined) roots.push(id);
    else {
      const list = children.get(parent);
      if (list) list.push(id);
      else children.set(parent, [id]);
    }
  }
  return { parentOf, children, roots };
}

/** Ids that start expanded: hosts, so the map opens at guest level. */
export function defaultExpanded(model: SystemModel): Set<string> {
  return new Set(model.nodes.filter((n) => n.kind === 'host').map((n) => n.id));
}

export function ancestorsOf(tree: Tree, id: string): string[] {
  const out: string[] = [];
  let cur = tree.parentOf.get(id);
  while (cur !== undefined && !out.includes(cur)) {
    out.push(cur);
    cur = tree.parentOf.get(cur);
  }
  return out;
}

export function buildTopology(
  model: SystemModel,
  index: ModelIndex,
  options: TopologyOptions,
): Topology {
  const tree = buildTree(model, index, options.showRetired);
  const groupHidden = (id: string) =>
    id in GROUPS && !options.edgeKinds[GROUPS[id as GroupId].edge];

  const items: TopoItem[] = [];
  const visible = new Set<string>();
  const walk = (id: string, parent: string | undefined, depth: number) => {
    if (groupHidden(id)) return;
    const kids = tree.children.get(id) ?? [];
    const expanded = kids.length > 0 && options.expanded.has(id);
    const ref = index.byId.get(id);
    items.push({
      id,
      parent,
      childCount: kids.length,
      expanded,
      dimmed: ref ? isDimmed(ref.entity) : false,
      depth,
    });
    visible.add(id);
    if (expanded) for (const k of kids) walk(k, id, depth + 1);
  };
  for (const r of tree.roots) walk(r, undefined, 0);

  /** Nearest visible item for an entity, or undefined when it is not in the tree. */
  const representative = (id: string): string | undefined => {
    let cur: string | undefined = id;
    const path: string[] = [];
    while (cur !== undefined) {
      path.push(cur);
      cur = tree.parentOf.get(cur);
    }
    // The highest collapsed ancestor wins; walk from the root down.
    for (let i = path.length - 1; i >= 0; i--) {
      const p = path[i]!;
      if (!visible.has(p)) return undefined;
      const item = p === id || !options.expanded.has(p) || !tree.children.get(p)?.length;
      if (item) return p;
    }
    return undefined;
  };

  const merged = new Map<string, TopoEdge>();
  for (const e of model.edges) {
    const kind = e.kind as EdgeKind;
    if (!(DRAWN_EDGE_KINDS as readonly string[]).includes(kind)) continue;
    const drawn = kind as DrawnEdgeKind;
    if (!options.edgeKinds[drawn]) continue;
    const source = representative(e.source);
    const target = representative(e.target);
    if (!source || !target || source === target) continue;
    // An edge between an item and its own container has nowhere sensible to go.
    if (ancestorsOf(tree, source).includes(target) || ancestorsOf(tree, target).includes(source)) {
      continue;
    }
    const key = `${drawn}:${source}>${target}`;
    const existing = merged.get(key);
    if (existing) {
      existing.count++;
      if (e.label && !existing.labels.includes(e.label)) existing.labels.push(e.label);
    } else {
      merged.set(key, {
        id: key,
        kind: drawn,
        source,
        target,
        count: 1,
        labels: e.label ? [e.label] : [],
      });
    }
  }
  return { items, edges: [...merged.values()] };
}
