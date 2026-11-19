import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/server/model/build.js';
import { wikiLinks } from '../src/shared/wikilinks.js';
import { indexModel } from '../src/web/lib/model-index.js';
import {
  OTHER,
  coverage,
  coverageRatio,
  glance,
  healthSummary,
  jobsNear,
  mentions,
  nodeTree,
  sortedArticles,
  stackGroups,
  stackModel,
} from '../src/web/wiki/data.js';
import { exampleFiles, yaml } from './helpers.js';

const build = (text: string) => buildModel([{ name: 'a.yaml', text }]).model;

const DATA = yaml`
  version: 1
  stacks:
    - { id: media, name: Media, order: 2, summary: Films. }
    - { id: edge, order: 1 }
  nodes:
    - { id: pve, kind: host, summary: The server. }
    - { id: ct-a, kind: lxc, parent: pve }
    - { id: ct-old, kind: lxc, parent: pve, status: retired }
  services:
    - { id: sonarr, name: Sonarr, node: ct-a, kind: container, stack: media, summary: Finds series.,
        calls: [{ target: prowlarr }, { target: qbit }, { target: rt-x }, { target: Some API }] }
    - { id: prowlarr, name: Prowlarr, node: ct-a, kind: container, stack: edge }
    - { id: qbit, name: qBittorrent, node: ct-a, kind: container, stack: media }
    - { id: loose, name: Loose, node: pve, kind: native }
    - { id: gone, name: Gone, node: ct-a, kind: container, stack: media, status: retired }
  routes:
    - { id: rt-x, host: x.example.net, via: traefik, target: prowlarr }
  monitors:
    - { id: m1, kuma_id: 1, name: M1, service: sonarr }
    - { id: m2, kuma_id: 2, name: M2, service: qbit, active: false }
  jobs:
    - { id: j1, node: ct-a, schedule: daily }
    - { id: j2, node: pve, schedule: weekly }
  policies:
    - { id: p1, title: P, rule: 'Keep [[sonarr]] pinned.', scope: [sonarr] }
  articles:
    - { id: art-b, title: B, body: 'See [[qbit]].' }
    - { id: art-a, title: A, order: 1, refs: [sonarr], body: x }
`;

describe('wiki data contract', () => {
  it('accepts summaries, stack descriptions and articles', () => {
    const model = build(DATA);
    expect(model.problems).toEqual([]);
    expect(model.articles.map((a) => a.id)).toEqual(['art-b', 'art-a']);
    expect(model.sources['art-a']?.line).toBeGreaterThan(0);
  });

  it('reports unknown [[id]] links and article refs as errors, with file and line', () => {
    const model = build(yaml`
      version: 1
      nodes:
        - id: pve
          kind: host
          notes: |
            Runs [[ct-nope]].
      articles:
        - { id: art-x, title: X, refs: [ghost], body: 'Read [[pve]] and [[missing-one]].' }
    `);
    const messages = model.problems.map((p) => `${p.line} ${p.message}`);
    expect(messages).toEqual([
      '5 `pve` references unknown id `ct-nope`',
      '8 `art-x` references unknown id `ghost`',
      '8 `art-x` references unknown id `missing-one`',
    ]);
    expect(model.problems.every((p) => p.severity === 'error' && p.code === 'dangling-ref')).toBe(
      true,
    );
  });

  it('finds links only in id form', () => {
    expect(wikiLinks('a [[x-1]] b [[Not An Id]] [[ -f x ]] [[y]]')).toEqual(['x-1', 'y']);
    expect(wikiLinks(undefined)).toEqual([]);
  });

  it('validates the examples strictly', () => {
    const model = buildModel(exampleFiles()).model;
    expect(model.problems).toEqual([]);
    expect(model.articles.length).toBeGreaterThan(0);
  });
});

describe('wiki pages', () => {
  const model = build(DATA);
  const index = indexModel(model);

  it('counts the system at a glance without retired things', () => {
    expect(glance(model)).toEqual({ guests: 1, apps: 4, publicRoutes: 1, monitors: 1, jobs: 2 });
  });

  it('summarises health of active apps', () => {
    const h = healthSummary(model, (id) =>
      id === 'sonarr' ? 'down' : id === 'qbit' ? 'up' : undefined,
    );
    expect(h).toEqual({ up: 1, down: ['sonarr'], pending: [], unknown: 2 });
  });

  it('groups apps by stack in order, with the rest under Other', () => {
    expect(stackGroups(model).map((g) => [g.id, g.apps.map((a) => a.id)])).toEqual([
      ['edge', ['prowlarr']],
      ['media', ['sonarr', 'qbit']],
      [OTHER, ['loose']],
    ]);
  });

  it('orders articles and nodes', () => {
    expect(sortedArticles(model).map((a) => a.id)).toEqual(['art-a', 'art-b']);
    expect(nodeTree(model).map(({ node, depth }) => `${depth}:${node.id}`)).toEqual([
      '0:pve',
      '1:ct-a',
      '1:ct-old',
    ]);
  });

  it('lists documentation gaps', () => {
    expect(coverage(model)).toEqual([
      { id: 'media', section: 'stacks', missing: ['description'] },
      { id: 'edge', section: 'stacks', missing: ['summary', 'description'] },
      { id: 'prowlarr', section: 'services', missing: ['summary'] },
      { id: 'qbit', section: 'services', missing: ['summary'] },
      { id: 'loose', section: 'services', missing: ['summary'] },
      { id: 'ct-a', section: 'nodes', missing: ['summary'] },
    ]);
    expect(coverageRatio(model)).toEqual({ documented: 3, total: 8 });
  });

  it('collects what mentions an entity and the jobs where it runs', () => {
    const m = mentions(model, 'sonarr');
    expect(m.policies.map((p) => p.id)).toEqual(['p1']);
    expect(m.articles.map((a) => a.id)).toEqual(['art-a']);
    expect(jobsNear(model, index, 'sonarr').map((j) => j.id)).toEqual(['j1']);
    expect(jobsNear(model, index, 'pve').map((j) => j.id)).toEqual(['j2']);
  });

  it('cuts a stack out of the model; calls leaving it become named externals', () => {
    const sub = stackModel(model, index, 'media');
    expect(sub.services.map((s) => s.id)).toEqual(['sonarr', 'qbit', 'gone']);
    expect(sub.stacks.map((s) => s.id)).toEqual(['media']);
    expect(sub.services[0]?.calls?.map((c) => c.target)).toEqual([
      'Prowlarr',
      'qbit',
      'Prowlarr',
      'Some API',
    ]);
    expect(stackModel(model, index, OTHER).services.map((s) => s.id)).toEqual(['loose']);
  });
});
