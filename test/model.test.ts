import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/server/model/build.js';
import type { Problem } from '../src/shared/model.js';
import { exampleFiles, yaml } from './helpers.js';

const file = (name: string, text: string) => ({ name, text });
const build = (...files: { name: string; text: string }[]) => buildModel(files).model;
const codes = (problems: readonly Problem[]) => problems.map((p) => p.code);

const host = yaml`
  version: 1
  nodes:
    - { id: pve, kind: host }
`;

describe('examples', () => {
  it('load without problems', () => {
    const { model, parsed } = buildModel(exampleFiles());
    expect(parsed).toBe(true);
    expect(model.problems).toEqual([]);
    expect(model.meta.title).toBe('Example homelab');
    expect(model.services.length).toBeGreaterThan(5);
  });

  it('derive every edge kind', () => {
    const { model } = buildModel(exampleFiles());
    const kinds = new Set(model.edges.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(
      ['backs-up', 'calls', 'contains', 'monitors', 'mounts', 'routes-to', 'runs-on'].sort(),
    );
    expect(model.edges).toContainEqual(
      expect.objectContaining({ kind: 'calls', source: 'wiki', target: 'wiki-db' }),
    );
    expect(model.edges).toContainEqual(
      expect.objectContaining({ kind: 'contains', source: 'pve', target: 'vm-docker' }),
    );
    expect(model.edges).toContainEqual(
      expect.objectContaining({ kind: 'mounts', source: 'ct-media', target: 'tank' }),
    );
    // External call labels do not become edges.
    expect(model.edges.some((e) => e.target === 'Quad9')).toBe(false);
    expect(new Set(model.edges.map((e) => e.id)).size).toBe(model.edges.length);
  });
});

describe('merge', () => {
  it('concatenates arrays in file order and deep-merges meta', () => {
    const model = build(
      file(
        'a.yaml',
        yaml`
        version: 1
        meta: { title: A, owner: me }
        nodes:
          - { id: pve, kind: host }
      `,
      ),
      file(
        'b.yaml',
        yaml`
        version: 1
        meta: { timezone: UTC }
        nodes:
          - { id: ct-a, kind: lxc, parent: pve }
      `,
      ),
    );
    expect(model.nodes.map((n) => n.id)).toEqual(['pve', 'ct-a']);
    expect(model.meta).toEqual({ title: 'A', owner: 'me', timezone: 'UTC' });
    expect(model.problems).toEqual([]);
    expect(model.files).toEqual(['a.yaml', 'b.yaml']);
  });

  it('warns when a later file overrides a meta value', () => {
    const model = build(
      file('a.yaml', 'version: 1\nmeta: { title: A }\n'),
      file('b.yaml', 'version: 1\nmeta:\n  title: B\n'),
    );
    expect(model.meta.title).toBe('B');
    expect(model.problems).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'merge-conflict',
        file: 'b.yaml',
        line: 3,
        path: 'meta.title',
      }),
    ]);
  });

  it('warns when a later scalar replaces an object from an earlier file', () => {
    const model = build(
      file('a.yaml', 'version: 1\nmeta: { title: { x: 1 } }\n'),
      file('b.yaml', 'version: 1\nmeta: { title: Home }\n'),
    );
    expect(model.problems.map((p) => p.code)).toEqual(['merge-conflict']);
  });

  it('reports a missing version, unknown top-level keys, and non-list sections', () => {
    const model = build(file('a.yaml', 'nodes: {}\nextra: 1\n'));
    expect(model.problems).toEqual([
      expect.objectContaining({ severity: 'error', code: 'schema', line: 1, path: 'nodes' }),
      expect.objectContaining({
        severity: 'error',
        code: 'schema',
        message: 'No file declares `version: 1`; add it to the file with `meta`',
      }),
      expect.objectContaining({ severity: 'warning', code: 'unknown-key', line: 2, path: 'extra' }),
    ]);
  });

  it('reports a top level that is not a mapping and warns on empty files', () => {
    const model = build(file('a.yaml', '- 1\n'), file('b.yaml', '# nothing\n'));
    expect(model.problems).toEqual([
      expect.objectContaining({ code: 'schema', file: 'a.yaml', severity: 'error', line: 1 }),
      expect.objectContaining({ code: 'schema', file: 'a.yaml', path: 'version' }),
      expect.objectContaining({ code: 'file', file: 'b.yaml', severity: 'warning' }),
    ]);
  });

  it('needs `version: 1` in only one file', () => {
    const model = build(
      file('00-meta.yaml', 'version: 1\nmeta: { title: T }\n'),
      file('10-nodes.yaml', 'nodes:\n  - { id: pve, kind: host }\n'),
    );
    expect(model.problems).toEqual([]);
    expect(model.nodes).toHaveLength(1);
  });

  it('rejects a version other than 1 in any file', () => {
    const model = build(file('a.yaml', 'version: 1\n'), file('b.yaml', 'version: 2\n'));
    expect(model.problems).toEqual([
      expect.objectContaining({ code: 'schema', file: 'b.yaml', line: 1, path: 'version' }),
    ]);
  });
});

describe('yaml errors', () => {
  it('report file and line and mark the build as not parsed', () => {
    const { model, parsed } = buildModel([
      file('a.yaml', host),
      file('b.yaml', 'version: 1\nnodes:\n  - id: x\n   kind: [\n'),
    ]);
    expect(parsed).toBe(false);
    expect(model.problems[0]).toMatchObject({ severity: 'error', code: 'yaml', file: 'b.yaml' });
    expect(model.problems[0]?.line).toBeGreaterThan(0);
    // The good file is still loaded.
    expect(model.nodes.map((n) => n.id)).toEqual(['pve']);
  });

  it('rejects duplicate keys', () => {
    const { parsed, model } = buildModel([file('a.yaml', 'version: 1\nversion: 1\n')]);
    expect(parsed).toBe(false);
    expect(codes(model.problems)).toEqual(['yaml']);
  });

  it('bounds alias expansion', () => {
    const bomb = [
      'version: 1',
      'a: &a [x, x, x, x, x, x, x, x, x, x]',
      'b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]',
      'c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]',
      'd: [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]',
    ].join('\n');
    const { parsed, model } = buildModel([file('a.yaml', bomb)]);
    expect(parsed).toBe(false);
    expect(model.problems[0]).toMatchObject({ code: 'yaml', file: 'a.yaml' });
  });
});

describe('validation', () => {
  it('drops invalid entities with a located error', () => {
    const model = build(
      file(
        'a.yaml',
        yaml`
        version: 1
        nodes:
          - id: pve
            kind: host
          - id: Bad_Id
            kind: spaceship
      `,
      ),
    );
    expect(model.nodes.map((n) => n.id)).toEqual(['pve']);
    expect(model.problems).toEqual([
      expect.objectContaining({ code: 'schema', line: 5, path: 'nodes[1].id', entity: 'Bad_Id' }),
      expect.objectContaining({ code: 'schema', line: 6, path: 'nodes[1].kind' }),
    ]);
  });

  it('names missing required fields', () => {
    const model = build(file('a.yaml', 'version: 1\nservices:\n  - id: svc\n'));
    const messages = model.problems.map((p) => p.message);
    expect(messages).toContain('services[0].name: required (`svc` skipped)');
    expect(messages).toContain('services[0].node: required (`svc` skipped)');
  });

  it('keeps entities with unknown keys and warns at the key', () => {
    const model = build(
      file(
        'a.yaml',
        yaml`
        version: 1
        nodes:
          - id: pve
            kind: host
            colour: red
            hardware:
              gpu: none
      `,
      ),
    );
    expect(model.nodes).toHaveLength(1);
    expect(model.nodes[0]).toMatchObject({ colour: 'red' });
    expect(model.problems).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'unknown-key',
        line: 5,
        path: 'nodes[0].colour',
      }),
      expect.objectContaining({
        severity: 'warning',
        code: 'unknown-key',
        line: 7,
        path: 'nodes[0].hardware.gpu',
      }),
    ]);
  });

  it('rejects links that are not http(s)', () => {
    const model = build(
      file(
        'a.yaml',
        yaml`
        version: 1
        nodes:
          - id: pve
            kind: host
            links: [{ label: x, url: 'javascript:alert(1)' }]
      `,
      ),
    );
    expect(model.nodes).toEqual([]);
    expect(model.problems[0]).toMatchObject({ code: 'schema', path: 'nodes[0].links[0].url' });
  });

  it('reports duplicate ids across kinds and files, keeping the first', () => {
    const model = build(
      file('a.yaml', host),
      file(
        'b.yaml',
        yaml`
        version: 1
        networks:
          - { id: pve, cidr: 10.0.0.0/24 }
      `,
      ),
    );
    expect(model.nodes.map((n) => n.id)).toEqual(['pve']);
    expect(model.networks).toEqual([]);
    expect(model.problems).toEqual([
      expect.objectContaining({ code: 'duplicate-id', file: 'b.yaml', line: 3, entity: 'pve' }),
    ]);
    expect(model.problems[0]?.message).toContain('a.yaml:3');
  });
});

describe('references', () => {
  it('reports unknown and wrong-kind references', () => {
    const model = build(
      file(
        'a.yaml',
        yaml`
        version: 1
        networks:
          - { id: lan }
        nodes:
          - { id: pve, kind: host, network: lan }
          - { id: ct-a, kind: lxc, parent: nope }
        services:
          - { id: svc, name: Svc, kind: native, node: lan }
        routes:
          - { id: r, host: x.example.net, via: traefik, target: pve }
      `,
      ),
    );
    expect(model.problems.map((p) => [p.code, p.entity, p.line])).toEqual([
      ['dangling-ref', 'ct-a', 6],
      ['dangling-ref', 'svc', 8],
      ['dangling-ref', 'r', 10],
    ]);
    expect(model.problems[1]?.message).toContain('must reference a node');
    // No edges to missing or wrong targets.
    expect(model.edges.find((e) => e.source === 'ct-a')).toBeUndefined();
  });

  it('treats unknown call targets as external labels and warns only for id-like ones', () => {
    const model = build(
      file(
        'a.yaml',
        yaml`
        version: 1
        nodes: [{ id: pve, kind: host }]
        services:
          - id: svc
            name: Svc
            kind: native
            node: pve
            calls:
              - { target: api.example.com }
              - { target: Some API }
              - { target: wiki-dbb }
      `,
      ),
    );
    expect(model.problems).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'dangling-ref',
        path: 'services[0].calls[2].target',
      }),
    ]);
    expect(model.edges.filter((e) => e.kind === 'calls')).toEqual([]);
  });

  it('does not double-report references to entities that failed validation', () => {
    const model = build(
      file(
        'a.yaml',
        yaml`
        version: 1
        nodes:
          - { id: pve, kind: spaceship }
          - { id: ct-a, kind: lxc, parent: pve }
      `,
      ),
    );
    expect(codes(model.problems)).toEqual(['schema']);
  });

  it('reports parent cycles once', () => {
    const model = build(
      file(
        'a.yaml',
        yaml`
        version: 1
        nodes:
          - { id: a, kind: vm, parent: b }
          - { id: b, kind: vm, parent: a }
          - { id: c, kind: vm, parent: c }
      `,
      ),
    );
    expect(model.problems.map((p) => p.message)).toEqual([
      'Parent cycle: `a` → `b` → `a`',
      'Parent cycle: `c` → `c`',
    ]);
  });

  it('checks monitor, scope and backup references', () => {
    const model = build(
      file(
        'a.yaml',
        yaml`
        version: 1
        nodes: [{ id: pve, kind: host }]
        services:
          - { id: svc, name: Svc, kind: native, node: pve, health: { kuma: [kuma-9] } }
        monitors:
          - { id: kuma-1, kuma_id: 1, name: M, service: pve }
        policies:
          - { id: p, title: T, rule: R, scope: [ghost] }
        backups:
          - { id: b, what: W, to: somewhere, from: [svc, ghost2] }
      `,
      ),
    );
    expect(model.problems.map((p) => p.path)).toEqual([
      'services[0].health.kuma[0]',
      'monitors[0].service',
      'policies[0].scope[0]',
      'backups[0].from[1]',
    ]);
    expect(model.edges).toContainEqual(
      expect.objectContaining({ kind: 'backs-up', source: 'b', target: 'svc' }),
    );
  });
});

describe('monitors on nodes', () => {
  const nodes =
    'version: 1\nnodes: [{ id: pve, kind: host }]\nservices: [{ id: svc, name: S, kind: native, node: pve }]\n';

  it('derive a monitors edge to the node', () => {
    const model = build(
      file(
        'a.yaml',
        nodes +
          'monitors:\n  - { id: kuma-1, kuma_id: 1, name: Ping, node: pve }\n  - { id: kuma-2, kuma_id: 2, name: Push }\n',
      ),
    );
    expect(model.problems).toEqual([]);
    expect(model.edges).toContainEqual(
      expect.objectContaining({ kind: 'monitors', source: 'kuma-1', target: 'pve' }),
    );
  });

  it('reject a monitor with both service and node', () => {
    const model = build(
      file(
        'a.yaml',
        nodes + 'monitors:\n  - { id: kuma-1, kuma_id: 1, name: Ping, node: pve, service: svc }\n',
      ),
    );
    expect(model.monitors).toEqual([]);
    expect(model.problems).toEqual([
      expect.objectContaining({
        code: 'schema',
        line: 5,
        path: 'monitors[0].node',
        message: expect.stringContaining('either `service` or `node`'),
      }),
    ]);
  });

  it('require node to reference a node', () => {
    const model = build(
      file('a.yaml', nodes + 'monitors:\n  - { id: kuma-1, kuma_id: 1, name: Ping, node: svc }\n'),
    );
    expect(model.problems[0]?.message).toContain('must reference a node');
  });
});

describe('sources', () => {
  it('records file, line and the raw YAML of each entity', () => {
    const model = build(
      file(
        'a.yaml',
        yaml`
        version: 1
        nodes:
          # The host
          - id: pve
            kind: host   # inline comment
            ips:
              - 10.0.0.2
      `,
      ),
    );
    expect(model.sources.pve).toEqual({
      file: 'a.yaml',
      line: 4,
      raw: 'id: pve\nkind: host   # inline comment\nips:\n  - 10.0.0.2',
    });
  });
});

describe('fields used by the real data', () => {
  it('are accepted without warnings', () => {
    const model = build(
      file(
        'a.yaml',
        yaml`
        version: 1
        meta: { title: T, description: D, conventions: '**md**' }
        networks: [{ id: lan }]
        zones:
          - { id: z, domain: example.net, settings: { ssl: strict, min_tls: '1.2' } }
        nodes:
          - id: pve
            kind: host
            description: Host
            network: lan
            features: [nesting=1]
            devices: [{ source: /dev/dri, target: /dev/dri }]
            firewall: { enabled: true, notes: Managed in the UI }
        services:
          - id: svc
            name: Svc
            node: pve
            kind: worker
            status: running
            description: A worker
            schedule: hourly
            links: [{ label: Docs, url: 'https://example.net/docs' }]
            calls: [{ target: Some external SaaS }]
        routes:
          - { id: r, host: a.example.net, paths: ['HostRegexp(\`^.+\\.example\\.net$\`)'], via: traefik, target: svc }
        monitors:
          - { id: kuma-1, kuma_id: 1, name: M, service: svc, active: false, interval_s: 60, group: G }
        jobs:
          - { id: j, node: pve, schedule: daily, source: crontab, notes: Some notes }
        backups:
          - { id: b, what: Everything, from: [pve], to: offsite }
      `,
      ),
    );
    expect(model.problems).toEqual([]);
  });
});
