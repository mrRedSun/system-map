/**
 * ELK layered layout for a topology. Each container is laid out on its own; edges are given to
 * ELK only as hints between siblings (the drawn edges are routed by React Flow).
 */
import type { ElkNode, LayoutOptions } from 'elkjs/lib/elk-api';
import type { SystemModel } from '../../shared/model';
import type { ModelIndex } from '../lib/model-index';
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
