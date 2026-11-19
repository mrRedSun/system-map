import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/server/model/build.js';
import {
  DEFAULT_EDGE_KINDS,
  buildTopology,
  defaultExpanded,
  type TopologyOptions,
} from '../src/web/graph/topology.js';
import { exposureOf, indexModel } from '../src/web/lib/model-index.js';
import { exampleFiles, yaml } from './helpers.js';

const examples = buildModel(exampleFiles()).model;
const index = indexModel(examples);

function topo(over: Partial<TopologyOptions> = {}, model = examples) {
  return buildTopology(model, model === examples ? index : indexModel(model), {
    expanded: defaultExpanded(model),
    edgeKinds: DEFAULT_EDGE_KINDS,
    showRetired: false,
    ...over,
  });
}

describe('topology', () => {
  it('opens at guest level: host expanded, guests collapsed', () => {
    const t = topo();
    const ids = t.items.map((i) => i.id);
    expect(ids).toContain('pve');
    expect(ids).toContain('vm-docker');
    expect(ids).not.toContain('wiki');
    expect(t.items.find((i) => i.id === 'pve')).toMatchObject({ expanded: true, depth: 0 });
    expect(t.items.find((i) => i.id === 'vm-docker')).toMatchObject({
      parent: 'pve',
      expanded: false,
      depth: 1,
    });
    expect(t.items.find((i) => i.id === 'vm-docker')!.childCount).toBeGreaterThan(3);
  });

  it('attaches edges to the nearest visible ancestor and merges them', () => {
    const t = topo();
    // Routes group is collapsed: all route edges come from it, merged per target guest.
    const routeEdges = t.edges.filter((e) => e.kind === 'routes-to');
    expect(routeEdges.every((e) => e.source === 'group:routes')).toBe(true);
    const toDocker = routeEdges.find((e) => e.target === 'vm-docker');
    expect(toDocker?.count).toBe(5);
    // Calls inside one collapsed guest disappear (traefik → wiki, both in vm-docker).
    expect(t.edges.some((e) => e.source === e.target)).toBe(false);
    expect(t.edges.find((e) => e.kind === 'mounts' && e.source === 'ct-media')?.target).toBe(
      'tank',
    );
  });

  it('shows services and their own edges when a guest is expanded', () => {
    const t = topo({ expanded: new Set(['pve', 'vm-docker']) });
    expect(t.items.find((i) => i.id === 'wiki')?.parent).toBe('vm-docker');
    expect(t.edges).toContainEqual(
      expect.objectContaining({ kind: 'calls', source: 'wiki', target: 'wiki-db', count: 1 }),
    );
  });

  it('draws monitor edges to nodes', () => {
    const t = topo({ edgeKinds: { ...DEFAULT_EDGE_KINDS, monitors: true } });
    expect(t.edges).toContainEqual(
      expect.objectContaining({ kind: 'monitors', source: 'group:monitors', target: 'pve' }),
    );
  });

  it('hides edge kinds that are toggled off, with their groups', () => {
    const t = topo({ edgeKinds: { ...DEFAULT_EDGE_KINDS, 'routes-to': false, monitors: true } });
    expect(t.items.some((i) => i.id === 'group:routes')).toBe(false);
    expect(t.items.some((i) => i.id === 'group:monitors')).toBe(true);
    expect(t.edges.some((e) => e.kind === 'routes-to')).toBe(false);
    expect(t.edges.some((e) => e.kind === 'monitors')).toBe(true);
  });

  it('dims deliberately stopped items', () => {
    expect(topo().items.find((i) => i.id === 'ct-sandbox')?.dimmed).toBe(true);
    expect(topo().items.find((i) => i.id === 'vm-docker')?.dimmed).toBe(false);
  });

  it('hides retired items and their contents unless asked', () => {
    const model = buildModel([
      {
        name: 'a.yaml',
        text: yaml`
          version: 1
          nodes:
            - { id: pve, kind: host }
            - { id: old, kind: lxc, parent: pve, status: retired }
            - { id: new, kind: lxc, parent: pve }
          services:
            - { id: legacy, name: L, node: old, kind: native }
            - { id: app, name: A, node: new, kind: native, calls: [{ target: legacy }] }
        `,
      },
    ]).model;
    const all = { expanded: new Set(['pve', 'old', 'new']) };
    const hidden = topo(all, model);
    expect(hidden.items.map((i) => i.id)).toEqual(['pve', 'new', 'app']);
    expect(hidden.edges).toEqual([]);
    const shown = topo({ ...all, showRetired: true }, model);
    expect(shown.items.map((i) => i.id)).toEqual(['pve', 'old', 'legacy', 'new', 'app']);
    expect(shown.items.find((i) => i.id === 'old')?.dimmed).toBe(true);
    expect(shown.edges.map((e) => e.id)).toEqual(['calls:app>legacy']);
  });

  it('breaks only the cycle, not nodes hanging below it', () => {
    const model = buildModel([
      {
        name: 'a.yaml',
        text: 'version: 1\nnodes:\n  - { id: a, kind: vm, parent: b }\n  - { id: b, kind: vm, parent: c }\n  - { id: c, kind: vm, parent: b }\n',
      },
    ]).model;
    const t = topo({ expanded: new Set(['a', 'b', 'c']) }, model);
    expect(t.items.find((i) => i.id === 'a')?.parent).toBe('b');
  });

  it('survives parent cycles', () => {
    const model = buildModel([
      {
        name: 'a.yaml',
        text: 'version: 1\nnodes:\n  - { id: a, kind: vm, parent: b }\n  - { id: b, kind: vm, parent: a }\n',
      },
    ]).model;
    const t = topo({ expanded: new Set(['a', 'b']) }, model);
    expect(t.items.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });
});

describe('exposure', () => {
  it('is the widest port exposure, or public when routed', () => {
    expect(exposureOf(index, 'wiki-db')).toBe('internal');
    expect(exposureOf(index, 'adguard')).toBe('lan');
    expect(exposureOf(index, 'authelia')).toBe('public');
    expect(exposureOf(index, 'pve')).toBeUndefined();
  });
});

describe('dnsRecordsFor', () => {
  it('prefers exact records over wildcards', async () => {
    const { dnsRecordsFor } = await import('../src/web/lib/model-index.js');
    expect(dnsRecordsFor(examples, 'vpn.example.net').map((r) => r.record.type)).toEqual(['A']);
    expect(dnsRecordsFor(examples, 'wiki.example.net').map((r) => r.record.name)).toEqual([
      '*.example.net',
    ]);
    expect(dnsRecordsFor(examples, 'example.org')).toEqual([]);
  });
});

describe('entityHealth', () => {
  it('rolls monitor status up to services and their nodes, worst first', async () => {
    const { entityHealth } = await import('../src/web/lib/health.js');
    const h = entityHealth(examples, index, {
      '1': { status: 'up', name: 'Wiki' },
      '2': { status: 'down', name: 'Authelia' },
      '4': { status: 'up', name: 'DNS' },
    });
    expect(h.get('kuma-1')).toBe('up');
    expect(h.get('wiki')).toBe('up');
    expect(h.get('authelia')).toBe('down');
    expect(h.get('vm-docker')).toBe('down');
    expect(h.get('ct-dns')).toBe('up');
    expect(h.get('pve')).toBe('down');
    expect(h.get('jellyfin')).toBeUndefined();
  });

  it("includes a node's own ping monitors", async () => {
    const { entityHealth } = await import('../src/web/lib/health.js');
    const h = entityHealth(examples, index, {
      '5': { status: 'up', name: 'Jellyfin' },
      '9': { status: 'down', name: 'Media ping' },
      '8': { status: 'up', name: 'Proxmox host ping' },
    });
    expect(h.get('jellyfin')).toBe('up');
    expect(h.get('ct-media')).toBe('down');
    expect(h.get('pve')).toBe('down');
    expect(index.monitorsOf.get('pve')).toEqual(['kuma-8']);
  });
});
