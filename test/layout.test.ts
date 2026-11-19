import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/server/model/build.js';
import { layoutTopology } from '../src/web/graph/layout.js';
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
