import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/server/model/build.js';
import { DEFAULT_APPS_OPTIONS, buildApps } from '../src/web/graph/apps.js';
import { layoutApps, layoutTopology, packBoxes, toElkAppsGraph } from '../src/web/graph/layout.js';
import { DEFAULT_EDGE_KINDS, buildTopology } from '../src/web/graph/topology.js';
import { indexModel } from '../src/web/lib/model-index.js';
import { exampleFiles } from './helpers.js';

const model = buildModel(exampleFiles()).model;
const index = indexModel(model);

describe('layout', () => {
  it('places every item, with children inside their container', async () => {
    const expanded = new Set(['pve', 'vm-docker', 'group:routes']);
    const topo = buildTopology(model, index, {
      expanded,
      edgeKinds: { ...DEFAULT_EDGE_KINDS, monitors: true, 'backs-up': true },
      showRetired: false,
    });
    const boxes = await layoutTopology(topo, model, index);
    for (const item of topo.items) {
      const box = boxes.get(item.id);
      expect(box, item.id).toBeDefined();
      if (!item.parent) continue;
      const parent = boxes.get(item.parent)!;
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThan(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(parent.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(parent.height);
    }
    // Outside world is left of the host.
    expect(boxes.get('internet')!.x).toBeLessThan(boxes.get('pve')!.x);
  });
});

describe('apps layout', () => {
  const graph = buildApps(model, index, {
    collapsed: new Set(),
    showRetired: false,
    ...DEFAULT_APPS_OPTIONS,
  });

  it('keeps every app inside its stack, and callers before callees', async () => {
    const boxes = await layoutApps(graph, 'RIGHT', 1.6);
    for (const item of graph.items) {
      const box = boxes.get(item.id);
      expect(box, item.id).toBeDefined();
      if (!item.parent) continue;
      const parent = boxes.get(item.parent)!;
      expect(box!.x + box!.width, item.id).toBeLessThanOrEqual(parent.width);
      expect(box!.y + box!.height, item.id).toBeLessThanOrEqual(parent.height);
    }
    const x = (id: string) => boxes.get(id)!.x;
    // Requests and Bazarr → Sonarr and Radarr → Prowlarr and qBittorrent.
    for (const consumer of ['requests', 'bazarr']) {
      for (const middle of ['sonarr', 'radarr']) expect(x(consumer)).toBeLessThan(x(middle));
    }
    for (const middle of ['sonarr', 'radarr']) {
      for (const provider of ['prowlarr', 'qbittorrent'])
        expect(x(middle)).toBeLessThan(x(provider));
    }
  });

  it('packs stacks without overlap', async () => {
    const boxes = await layoutApps(graph, 'RIGHT', 1.6);
    const tops = graph.items.filter((i) => !i.parent).map((i) => boxes.get(i.id)!);
    for (const [i, a] of tops.entries()) {
      for (const b of tops.slice(i + 1)) {
        const apart =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('leaves observer edges out of the ranking', () => {
    const elk = toElkAppsGraph(graph);
    const laidOut = (elk.children ?? []).flatMap((c) => c.edges ?? []).map((e) => e.id);
    expect(laidOut).toContain('calls:sonarr>prowlarr');
    expect(laidOut.some((id) => id.startsWith('calls:homepage>'))).toBe(false);
  });
});

describe('packBoxes', () => {
  const sizes = [
    { id: 'a', width: 400, height: 300 },
    { id: 'b', width: 200, height: 100 },
    { id: 'c', width: 200, height: 100 },
    { id: 'd', width: 400, height: 300 },
  ];

  it('fills a wide screen in rows and a tall one in columns, in order', () => {
    const wide = packBoxes(sizes, 3, 0);
    expect(wide.height).toBe(300);
    // b starts a column next to a; c fits under b within the row.
    expect(wide.positions.get('b')).toEqual({ x: 400, y: 0 });
    expect(wide.positions.get('c')).toEqual({ x: 400, y: 100 });
    const tall = packBoxes(sizes, 0.3, 0);
    expect(tall.width).toBe(400);
    expect(tall.positions.get('a')!.y).toBeLessThan(tall.positions.get('d')!.y);
  });

  it('stacks everything in one column on request', () => {
    const one = packBoxes(sizes, 3, 10, true);
    expect([...one.positions.values()].every((p) => p.x === 0)).toBe(true);
    expect(one.height).toBe(300 + 100 + 100 + 300 + 30);
  });
});
