import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/server/model/build.js';
import {
  DEFAULT_APPS_OPTIONS,
  OTHER_STACK,
  OUTSIDE,
  buildApps,
  edgeLabel,
  stackGroupOf,
  focusGraph,
  externalKey,
  hostLabel,
  type AppsOptions,
} from '../src/web/graph/apps.js';
import { indexModel } from '../src/web/lib/model-index.js';
import { exampleFiles, yaml } from './helpers.js';

const examples = buildModel(exampleFiles()).model;
const index = indexModel(examples);

function apps(over: Partial<AppsOptions> = {}, model = examples) {
  return buildApps(model, model === examples ? index : indexModel(model), {
    collapsed: new Set(),
    showRetired: false,
    ...DEFAULT_APPS_OPTIONS,
    ...over,
  });
}

const edge = (g: ReturnType<typeof apps>, source: string, target: string) =>
  g.edges.find((e) => e.source === source && e.target === target);

function model(text: string) {
  const built = buildModel([{ name: 'a.yaml', text }]).model;
  return built;
}

describe('apps graph', () => {
  it('has one item per service inside its stack, and no guests', () => {
    const g = apps();
    const sonarr = g.items.find((i) => i.id === 'sonarr');
    expect(sonarr).toMatchObject({ kind: 'app', parent: 'media', host: 'CT 120' });
    expect(g.items.find((i) => i.id === 'media')).toMatchObject({
      kind: 'stack',
      label: 'Media',
      color: 'violet',
      expanded: true,
      entity: 'media',
    });
    expect(g.items.some((i) => i.id === 'vm-docker' || i.id === 'pve')).toBe(false);
    // Stacks follow `order`; apps without a stack go to Other, last.
    const stacks = g.items.filter((i) => i.kind === 'stack').map((i) => i.id);
    expect(stacks).toEqual([
      'edge',
      'media',
      'home',
      'apps',
      'bots',
      'observability',
      OTHER_STACK,
      OUTSIDE,
    ]);
    expect(g.items.find((i) => i.id === 'proxmox-ui')?.parent).toBe(OTHER_STACK);
  });

  it('draws calls between apps, caller to callee', () => {
    const e = edge(apps(), 'sonarr', 'prowlarr');
    expect(e).toMatchObject({ kind: 'use', count: 1, labels: ['Indexer search'], via: [] });
  });

  it('merges duplicate caller → callee pairs into one edge with a count', () => {
    const e = edge(apps(), 'home-assistant', 'frigate');
    expect(e).toMatchObject({ count: 2, labels: ['Events and clips', 'Live camera streams'] });
    expect(
      apps().edges.filter((x) => x.source === 'home-assistant' && x.target === 'frigate'),
    ).toHaveLength(1);
  });

  it('resolves calls to a route to the route target, noting the hostname', () => {
    const g = apps();
    expect(edge(g, 'notify-bot', 'home-assistant')).toMatchObject({
      kind: 'use',
      via: ['home.example.net'],
    });
    expect(g.items.some((i) => i.id === 'route-home')).toBe(false);
  });

  it('shows calls to nodes as device items', () => {
    const g = apps();
    expect(g.items.find((i) => i.id === 'cam-door')).toMatchObject({
      kind: 'device',
      label: 'Door camera',
      entity: 'cam-door',
    });
    expect(edge(g, 'frigate', 'cam-door')).toBeDefined();
  });

  it('puts devices and externals in the one stack that calls them, else in Outside', () => {
    const g = apps();
    const parent = (id: string) => g.items.find((i) => i.id === id)?.parent;
    expect(parent('cam-door')).toBe('home');
    expect(parent(externalKey('TMDB API'))).toBe('media');
    // Called from observability (Uptime Kuma) and bots (Notify bot).
    expect(parent(externalKey('Telegram Bot API'))).toBe(OUTSIDE);
    expect(g.items.find((i) => i.id === OUTSIDE)).toMatchObject({ kind: 'stack', childCount: 1 });
    // Without stacks there are no groups at all.
    const flat = buildModel([
      {
        name: 'a.yaml',
        text: yaml`
          version: 1
          nodes: [{ id: n, kind: vm }]
          services:
            - { id: a, name: A, node: n, kind: native, calls: [{ target: Some API }] }
        `,
      },
    ]).model;
    expect(apps({}, flat).items.map((i) => [i.id, i.parent])).toEqual([
      ['a', undefined],
      [externalKey('Some API'), undefined],
    ]);
  });

  it('merges free-text targets that differ only in case and spacing', () => {
    const g = apps();
    const tmdb = g.items.filter((i) => i.kind === 'external' && i.id === externalKey('TMDB API'));
    expect(tmdb).toHaveLength(1);
    expect(tmdb[0]!.label).toBe('TMDB API');
    expect(edge(g, 'radarr', externalKey('tmdb api'))).toBeDefined();
    expect(edge(g, 'requests', externalKey('TMDB API'))).toBeDefined();
    // Different strings stay separate.
    const telegram = g.items.filter((i) => i.label.startsWith('Telegram')).map((i) => i.label);
    expect(telegram.sort()).toEqual(['Telegram Bot API', 'Telegram Bot API (long polling)']);
    expect(externalKey('  Telegram   bot API ')).toBe(externalKey('telegram bot api'));
  });

  it('hides externals when asked', () => {
    const g = apps({ externals: false });
    expect(g.items.some((i) => i.kind === 'external')).toBe(false);
    expect(g.edges.some((e) => e.target.startsWith('ext:'))).toBe(false);
    expect(g.items.some((i) => i.kind === 'device')).toBe(true);
  });

  it('marks observer calls, and a real call wins when both connect a pair', () => {
    const g = apps();
    expect(edge(g, 'homepage', 'sonarr')?.kind).toBe('observe');
    expect(edge(g, 'system-map', 'dozzle')?.kind).toBe('observe');
    const m = model(yaml`
      version: 1
      nodes: [{ id: n, kind: vm }]
      services:
        - id: a
          name: A
          node: n
          kind: native
          calls: [{ target: b, kind: observe }, { target: b, purpose: Data }]
        - { id: b, name: B, node: n, kind: native }
    `);
    expect(apps({}, m).edges).toEqual([
      expect.objectContaining({ kind: 'use', count: 2, labels: ['Data'] }),
    ]);
  });

  it('collapses a stack into one item and merges edges onto it', () => {
    const g = apps({ collapsed: new Set(['media']) });
    expect(g.items.find((i) => i.id === 'media')).toMatchObject({ expanded: false, childCount: 8 });
    expect(g.items.some((i) => i.parent === 'media')).toBe(false);
    // Homepage observes five media apps: one edge to the stack.
    expect(edge(g, 'homepage', 'media')).toMatchObject({ kind: 'observe', count: 5 });
    // Calls inside the stack disappear, with the externals only the stack calls.
    expect(g.edges.some((e) => e.source === 'media' && e.target === 'media')).toBe(false);
    expect(g.items.some((i) => i.id === externalKey('TMDB API'))).toBe(false);
    // Collapsing Outside merges its shared items the same way.
    const out = apps({ collapsed: new Set([OUTSIDE]) });
    expect(edge(out, 'notify-bot', OUTSIDE)).toMatchObject({ count: 1 });
    expect(out.items.some((i) => i.parent === OUTSIDE)).toBe(false);
  });

  it('hides retired apps and apps on retired nodes unless asked', () => {
    expect(apps().items.some((i) => i.id === 'old-dashboard')).toBe(false);
    expect(apps().items.find((i) => i.id === 'observability')?.childCount).toBe(4);
    const shown = apps({ showRetired: true });
    expect(shown.items.find((i) => i.id === 'old-dashboard')).toMatchObject({ dimmed: true });
    expect(edge(shown, 'old-dashboard', 'jellyfin')).toBeDefined();

    const m = model(yaml`
      version: 1
      nodes:
        - { id: old, kind: lxc, status: retired }
        - { id: new, kind: lxc }
      services:
        - { id: legacy, name: L, node: old, kind: native }
        - { id: app, name: A, node: new, kind: native, calls: [{ target: legacy }, { target: old }] }
    `);
    expect(apps({}, m).items.map((i) => i.id)).toEqual(['app']);
    expect(apps({}, m).edges).toEqual([]);
    expect(apps({ showRetired: true }, m).edges).toHaveLength(2);
  });

  it('lists public hostnames and draws ingress edges only on request', () => {
    const g = apps();
    expect(g.items.find((i) => i.id === 'photos')?.public).toEqual([
      'photos.example.net',
      'photos.example.net/share/*',
    ]);
    expect(g.edges.some((e) => e.kind === 'ingress')).toBe(false);

    const withIngress = apps({ ingress: true });
    expect(edge(withIngress, 'traefik', 'home-assistant')).toMatchObject({
      kind: 'ingress',
      labels: ['home.example.net'],
    });
    // Traefik already calls the wiki; no second line.
    expect(withIngress.edges.filter((e) => e.target === 'wiki')).toHaveLength(1);
    // Routes through something that is not a service get a synthetic ingress item.
    expect(withIngress.items.find((i) => i.id === 'ingress:cloudflare-worker')?.kind).toBe(
      'ingress',
    );
  });

  it('focus keeps the item, its neighbours both ways, and their stacks', () => {
    const g = focusGraph(apps(), 'sonarr');
    const ids = new Set(g.items.map((i) => i.id));
    for (const id of ['sonarr', 'prowlarr', 'qbittorrent', 'jellyfin', 'requests', 'bazarr']) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(ids.has('homepage')).toBe(true);
    expect(ids.has('observability')).toBe(true);
    expect(ids.has('radarr')).toBe(false);
    expect(ids.has('wiki')).toBe(false);
    expect(g.edges.every((e) => e.source === 'sonarr' || e.target === 'sonarr')).toBe(true);
    // Focus on something without edges changes nothing.
    expect(focusGraph(apps(), 'nothing')).toEqual(apps());
  });

  it('does not box apps when no stacks are defined, and puts unknown stacks in Other', () => {
    const plain = model(yaml`
      version: 1
      nodes: [{ id: n, kind: vm, vmid: 7 }]
      services:
        - { id: a, name: A, node: n, kind: native, calls: [{ target: b }] }
        - { id: b, name: B, node: n, kind: native }
    `);
    const g = apps({}, plain);
    expect(g.items.map((i) => [i.id, i.parent, i.host])).toEqual([
      ['a', undefined, 'VM 7'],
      ['b', undefined, 'VM 7'],
    ]);

    const typo = buildModel([
      {
        name: 'a.yaml',
        text: yaml`
          version: 1
          nodes: [{ id: n, kind: vm }]
          stacks: [{ id: media }]
          services:
            - { id: a, name: A, node: n, kind: native, stack: media }
            - { id: b, name: B, node: n, kind: native, stack: meida }
        `,
      },
    ]).model;
    expect(typo.problems).toContainEqual(
      expect.objectContaining({ code: 'dangling-ref', path: 'services[1].stack' }),
    );
    const t = apps({}, typo);
    expect(t.items.find((i) => i.id === 'b')?.parent).toBe(OTHER_STACK);
    // A stack without a color gets one from the palette.
    expect(t.items.find((i) => i.id === 'media')?.color).toBeDefined();
  });
});

describe('helpers', () => {
  it('labels edges with purposes, count and route hostname', () => {
    const base = { id: 'x', kind: 'use' as const, source: 'a', target: 'b' };
    expect(edgeLabel({ ...base, count: 1, labels: ['Search'], via: [] })).toBe('Search');
    expect(edgeLabel({ ...base, count: 2, labels: ['A', 'B'], via: [] })).toBe('A, B ×2');
    expect(edgeLabel({ ...base, count: 3, labels: ['A', 'B', 'C'], via: [] })).toBe('A, B +1 ×3');
    expect(edgeLabel({ ...base, count: 1, labels: [], via: ['h.example.net'] })).toBe(
      'via h.example.net',
    );
  });

  it('finds the stack group of a service', () => {
    expect(stackGroupOf(examples, 'sonarr')).toBe('media');
    expect(stackGroupOf(examples, 'proxmox-ui')).toBe(OTHER_STACK);
    expect(stackGroupOf(examples, 'pve')).toBeUndefined();
  });
});

describe('hostLabel', () => {
  it('names guests by vmid and other nodes by hostname or name', () => {
    expect(hostLabel({ id: 'ct-x', kind: 'lxc', vmid: 101 })).toBe('CT 101');
    expect(hostLabel({ id: 'vm-x', kind: 'vm', vmid: 7 })).toBe('VM 7');
    expect(hostLabel({ id: 'pve', kind: 'host', hostname: 'pve1', name: 'Host' })).toBe('pve1');
    expect(hostLabel({ id: 'r', kind: 'router', name: 'Edge' })).toBe('Edge');
    expect(hostLabel(undefined)).toBeUndefined();
  });
});
