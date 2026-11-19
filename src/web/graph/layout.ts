/**
 * ELK layered layout for a topology. Each container is laid out on its own; edges are given to
 * ELK only as hints between siblings (the drawn edges are routed by React Flow).
 */
import type { ElkNode, LayoutOptions } from 'elkjs/lib/elk-api';
import type { SystemModel } from '../../shared/model';
import type { ModelIndex } from '../lib/model-index';
import type { AppsGraph } from './apps';
import type { Topology } from './topology';

export const NODE_WIDTH = 236;
export const NODE_HEIGHT = 64;
export const HEADER_HEIGHT = 44;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const BASE: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': '20',
  'elk.layered.spacing.nodeNodeBetweenLayers': '56',
  'elk.spacing.componentComponent': '28',
  'elk.aspectRatio': '1.8',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
};

const CONTAINER: LayoutOptions = {
  ...BASE,
  'elk.padding': `[top=${HEADER_HEIGHT + 8},left=16,bottom=16,right=16]`,
};

/** Left-to-right order of top-level items: outside world, entry points, host, everything else. */
function partition(id: string, model: SystemModel, index: ModelIndex): number {
  if (id === 'group:routes') return 1;
  if (id === 'group:monitors' || id === 'group:backups') return 5;
  const ref = index.byId.get(id);
  if (ref?.section !== 'nodes') return 4;
  const kind = (ref.entity as SystemModel['nodes'][number]).kind;
  return (
    { internet: 0, cdn: 1, router: 2, vpn: 2, external: 2, device: 2, host: 3 }[kind as string] ?? 4
  );
}

export type Direction = 'RIGHT' | 'DOWN';

export function toElkGraph(
  topology: Topology,
  model: SystemModel,
  index: ModelIndex,
  direction: Direction = 'RIGHT',
): ElkNode {
  const base = { ...BASE, 'elk.direction': direction };
  const container = { ...CONTAINER, 'elk.direction': direction };
  const root: ElkNode = {
    id: '__root',
    layoutOptions: {
      ...base,
      'elk.partitioning.activate': 'true',
      // Partitions only order nodes within one component; keep top-level items together.
      'elk.separateConnectedComponents': 'false',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
    },
    children: [],
    edges: [],
  };
  const elkById = new Map<string, ElkNode>([['__root', root]]);
  const parentOf = new Map<string, string>();

  for (const item of topology.items) {
    const node: ElkNode = item.expanded
      ? { id: item.id, layoutOptions: container, children: [], edges: [] }
      : { id: item.id, width: NODE_WIDTH, height: NODE_HEIGHT };
    const parentId = item.parent ?? '__root';
    if (!item.parent) {
      node.layoutOptions = {
        ...node.layoutOptions,
        'elk.partitioning.partition': String(partition(item.id, model, index)),
      };
    }
    parentOf.set(item.id, parentId);
    elkById.set(item.id, node);
    elkById.get(parentId)?.children?.push(node);
  }

  const chain = (id: string) => {
    const out = [id];
    let cur = parentOf.get(id);
    while (cur) {
      out.push(cur);
      cur = parentOf.get(cur);
    }
    return out; // id, parent, ..., '__root'
  };

  const seen = new Set<string>();
  for (const e of topology.edges) {
    const a = chain(e.source);
    const b = chain(e.target);
    const common = a.find((x) => b.includes(x));
    if (!common) continue;
    // Children of the common container that hold each endpoint.
    const sa = a[a.indexOf(common) - 1];
    const sb = b[b.indexOf(common) - 1];
    if (!sa || !sb || sa === sb) continue;
    const key = `${sa}>${sb}`;
    if (seen.has(key)) continue;
    seen.add(key);
    elkById.get(common)?.edges?.push({ id: `hint:${key}`, sources: [sa], targets: [sb] });
  }
  return root;
}

let elkPromise: Promise<{ layout(graph: ElkNode): Promise<ElkNode> }> | undefined;

function elk() {
  // Tests run in Node without Workers; the build drops this branch (MODE is static there).
  elkPromise ??=
    import.meta.env.MODE === 'test'
      ? import('elkjs/lib/elk.bundled.js').then((m) => new m.default())
      : import('./elk-worker').then((m) => m.createWorkerElk());
  return elkPromise;
}

/** Positions relative to the parent item, keyed by item id. */
export async function layoutTopology(
  topology: Topology,
  model: SystemModel,
  index: ModelIndex,
  direction: Direction = 'RIGHT',
): Promise<Map<string, Box>> {
  const result = await (await elk()).layout(toElkGraph(topology, model, index, direction));
  const boxes = new Map<string, Box>();
  const visit = (node: ElkNode) => {
    for (const child of node.children ?? []) {
      boxes.set(child.id, {
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? NODE_WIDTH,
        height: child.height ?? NODE_HEIGHT,
      });
      visit(child);
    }
  };
  visit(result);
  return boxes;
}

export const APP_SIZE = {
  app: { width: 192, height: 46 },
  stack: { width: 192, height: 46 },
  device: { width: 168, height: 32 },
  external: { width: 168, height: 30 },
  ingress: { width: 168, height: 30 },
} as const;
export const STACK_HEADER = 32;

/**
 * Each stack is laid out on its own, layered in the reading direction, so callers sit before
 * the apps they call; `layoutApps` then packs the stacks in order to fit the screen's shape (a
 * single layered layout over everything comes out tall and sparse). Observer edges are left out: a
 * dashboard calling ten apps must not pull them all into one column. Without stacks, everything
 * is one layered layout.
 */
export function toElkAppsGraph(
  graph: AppsGraph,
  direction: Direction = 'RIGHT',
  aspectRatio = 1.6,
  /** Room between layers for edge labels (focus mode, where few apps are shown). */
  spacious = false,
): ElkNode {
  const layered: LayoutOptions = {
    ...BASE,
    'elk.direction': direction,
    'elk.spacing.nodeNode': '10',
    'elk.layered.spacing.nodeNodeBetweenLayers': spacious ? '150' : '44',
    'elk.spacing.componentComponent': '16',
    'elk.aspectRatio': String(aspectRatio),
  };
  const grouped = graph.items.some((i) => i.kind === 'stack');
  const root: ElkNode = {
    id: '__root',
    // With stacks, the root only sizes the boxes; `layoutApps` packs them.
    layoutOptions: grouped
      ? { 'elk.algorithm': 'fixed' }
      : { ...layered, 'elk.padding': '[top=24,left=24,bottom=24,right=24]' },
    children: [],
    edges: [],
  };
  const byId = new Map<string, ElkNode>([['__root', root]]);
  const parentOf = new Map<string, string>();
  for (const item of graph.items) {
    const node: ElkNode = item.expanded
      ? {
          id: item.id,
          layoutOptions: {
            ...layered,
            'elk.padding': `[top=${STACK_HEADER + 4},left=10,bottom=10,right=10]`,
          },
          children: [],
          edges: [],
        }
      : { id: item.id, ...APP_SIZE[item.kind] };
    const parent = item.parent ?? '__root';
    parentOf.set(item.id, parent);
    byId.set(item.id, node);
    (byId.get(parent) ?? root).children!.push(node);
  }
  for (const e of graph.edges) {
    if (e.kind === 'observe') continue;
    const parent = parentOf.get(e.source);
    // Only edges within one level are laid out; edges between stacks are drawn, not ranked.
    if (parent === undefined || parent !== parentOf.get(e.target)) continue;
    if (parent === '__root' && grouped) continue;
    byId.get(parent)!.edges!.push({ id: e.id, sources: [e.source], targets: [e.target] });
  }
  return root;
}

export interface Size {
  id: string;
  width: number;
  height: number;
}

/**
 * Packs boxes in order into rows, left to right; a box that fits under the previous one in the
 * current row goes there. Tries every row width and keeps the packing that can be shown largest
 * in a viewport of the given aspect ratio (width / height); `oneColumn` stacks them instead.
 */
export function packBoxes(
  sizes: readonly Size[],
  aspectRatio: number,
  gap = 28,
  oneColumn = false,
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  const pack = (limit: number) => {
    const positions = new Map<string, { x: number; y: number }>();
    let rowY = 0;
    let rowHeight = 0;
    let colX = 0;
    let colWidth = 0;
    let colBottom = 0;
    let width = 0;
    for (const b of sizes) {
      const below = colBottom + gap + b.height;
      if (colWidth > 0 && b.width <= colWidth && below <= rowHeight) {
        // Under the previous box, within the row's height.
        positions.set(b.id, { x: colX, y: rowY + colBottom + gap });
        colBottom = below;
        continue;
      }
      let x = colWidth > 0 ? colX + colWidth + gap : 0;
      if (x > 0 && x + b.width > limit) {
        rowY += rowHeight + gap;
        rowHeight = 0;
        x = 0;
      }
      positions.set(b.id, { x, y: rowY });
      colX = x;
      colWidth = b.width;
      colBottom = b.height;
      rowHeight = Math.max(rowHeight, b.height);
      width = Math.max(width, x + b.width);
    }
    return { positions, width, height: rowY + rowHeight };
  };
  const total = sizes.reduce((sum, b) => sum + b.width + gap, 0);
  const widest = Math.max(0, ...sizes.map((b) => b.width));
  if (oneColumn) return pack(0);
  let best = pack(total);
  let bestScale = 0;
  // Each distinct row break is reached by some limit between the widest box and everything.
  for (let limit = widest; limit <= total; limit += Math.max(gap, (total - widest) / 200)) {
    const p = pack(limit);
    const scale = Math.min(aspectRatio / p.width, 1 / p.height);
    if (scale > bestScale) {
      best = p;
      bestScale = scale;
    }
  }
  return best;
}

const MARGIN = 24;

export async function layoutApps(
  graph: AppsGraph,
  direction: Direction = 'RIGHT',
  aspectRatio = 1.6,
  spacious = false,
): Promise<Map<string, Box>> {
  const result = await (
    await elk()
  ).layout(toElkAppsGraph(graph, direction, aspectRatio, spacious));
  // Stacks: ELK lays out the inside of each box; the boxes themselves are packed here.
  if (graph.items.some((i) => i.kind === 'stack')) {
    const top = result.children ?? [];
    // Top to bottom (phones): one column to scroll through; fitting everything is unreadable.
    const packed = packBoxes(
      top.map((c) => ({ id: c.id, width: c.width ?? 0, height: c.height ?? 0 })),
      aspectRatio,
      28,
      direction === 'DOWN',
    );
    for (const c of top) {
      const p = packed.positions.get(c.id)!;
      c.x = p.x + MARGIN;
      c.y = p.y + MARGIN;
    }
  }
  const boxes = new Map<string, Box>();
  const visit = (node: ElkNode) => {
    for (const child of node.children ?? []) {
      boxes.set(child.id, {
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? APP_SIZE.app.width,
        height: child.height ?? APP_SIZE.app.height,
      });
      visit(child);
    }
  };
  visit(result);
  return boxes;
}
