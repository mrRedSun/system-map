import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CSP, createApp, whoAmI } from '../src/server/app.js';
import { ConfigError, loadConfig } from '../src/server/config.js';
import { ModelStore, readDataFiles } from '../src/server/store.js';
import type { SystemModel } from '../src/shared/model.js';

let dir: string;
const put = (name: string, text: string) => writeFileSync(join(dir, name), text);
const HOST = 'version: 1\nnodes:\n  - { id: pve, kind: host }\n';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'system-map-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function until(check: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('readDataFiles', () => {
  it('reads *.yaml in lexical order and skips dotfiles, other files and directories', async () => {
    put('b.yaml', 'version: 1\n');
    put('a.yaml', 'version: 1\n');
    put('.hidden.yaml', 'x');
    put('notes.txt', 'x');
    put('c.yml', 'x');
    mkdirSync(join(dir, 'd.yaml'));
    const { files, problems } = await readDataFiles(dir);
    expect(files.map((f) => f.name)).toEqual(['a.yaml', 'b.yaml']);
    expect(problems).toEqual([]);
  });

  it('enforces size and count limits', async () => {
    put('a.yaml', 'version: 1\n');
    put('b.yaml', `version: 1\n# ${'x'.repeat(100)}\n`);
    put('c.yaml', 'version: 1\n');
    put('d.yaml', 'version: 1\n');
    const { files, problems } = await readDataFiles(dir, {
      maxFiles: 3,
      maxFileBytes: 50,
      maxTotalBytes: 22,
    });
    expect(files.map((f) => f.name)).toEqual(['a.yaml', 'c.yaml']);
    expect(problems.map((p) => p.file)).toEqual(['b.yaml', 'd.yaml']);
  });
});

describe('ModelStore', () => {
  it('serves the last good model plus the error when YAML breaks, and recovers', async () => {
    put('a.yaml', HOST);
    const store = new ModelStore(dir);
    await store.reload();
    const good = store.current();
    expect(good?.model.nodes).toHaveLength(1);
    expect(good?.model.stale).toBe(false);

    put('b.yaml', 'version: 1\nnodes: [\n');
    await store.reload();
    const stale = store.current()!;
    expect(stale.model.stale).toBe(true);
    expect(stale.model.nodes).toHaveLength(1);
    expect(stale.model.problems[0]).toMatchObject({ code: 'yaml', file: 'b.yaml' });
    expect(stale.etag).not.toBe(good?.etag);

    put('b.yaml', 'version: 1\nnodes:\n  - { id: ct-a, kind: lxc, parent: pve }\n');
    await store.reload();
    expect(store.current()?.model.stale).toBe(false);
    expect(store.current()?.model.nodes).toHaveLength(2);
    store.close();
  });

  it('serves a partial model when the first load has YAML errors', async () => {
    put('a.yaml', HOST);
    put('b.yaml', 'nodes: [\n');
    const store = new ModelStore(dir);
    await store.reload();
    const { model } = store.current()!;
    expect(model.stale).toBe(false);
    expect(model.nodes).toHaveLength(1);
    expect(model.problems[0]?.code).toBe('yaml');
    store.close();
  });

  it('notifies only when the content changes', async () => {
    put('a.yaml', HOST);
    const store = new ModelStore(dir);
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.etag));
    await store.reload();
    await store.reload();
    expect(seen).toHaveLength(1);
    store.close();
  });

  it('rebuilds when files change on disk', async () => {
    put('a.yaml', HOST);
    const store = new ModelStore(dir, { debounceMs: 20 });
    await store.reload();
    store.watch();
    put('b.yaml', 'version: 1\nnetworks: [{ id: lan }]\n');
    await until(() => store.current()?.model.networks.length === 1);
    store.close();
  });

  it('reports an unreadable data directory without throwing', async () => {
    const store = new ModelStore(join(dir, 'missing'));
    await store.reload();
    expect(store.current()?.model.problems[0]).toMatchObject({ code: 'file', severity: 'error' });
    store.close();
  });
});

describe('app', () => {
  async function setup(extra: Partial<Parameters<typeof createApp>[0]> = {}) {
    put('a.yaml', HOST);
    const store = new ModelStore(dir);
    await store.reload();
    return { store, app: createApp({ store, ...extra }) };
  }

  it('serves the model with an ETag and answers 304 when unchanged', async () => {
    const { app } = await setup();
    const res = await app.request('/api/model');
    expect(res.status).toBe(200);
    const etag = res.headers.get('etag')!;
    const body = (await res.json()) as SystemModel;
    expect(body.nodes[0]?.id).toBe('pve');
    expect(res.headers.get('content-security-policy')).toBe(CSP);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');

    const again = await app.request('/api/model', { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
  });

  it('reports health of the server', async () => {
    const { app } = await setup();
    expect((await app.request('/healthz')).status).toBe(200);
    const empty = createApp({ store: new ModelStore(dir) });
    expect((await empty.request('/healthz')).status).toBe(503);
  });

  it('is read-only', async () => {
    const { app } = await setup();
    const res = await app.request('/api/model', { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('returns 404 JSON for unknown API paths', async () => {
    const { app } = await setup();
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
  });

  it('serves the JSON Schema', async () => {
    const { app } = await setup();
    const res = await app.request('/schema/system-map.schema.json');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { title: string }).title).toContain('System Map');
  });

  it('reports a missing Kuma or Dozzle configuration without failing', async () => {
    const { app } = await setup();
    const health = await app.request('/api/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ error: 'Uptime Kuma is not configured' });
    expect((await app.request('/api/logs/docker/wiki')).status).toBe(503);
  });

  it('streams a model event on connect and on change', async () => {
    const shutdown = new AbortController();
    const { app, store } = await setup({ shutdown: shutdown.signal });
    const res = await app.request('/api/events');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle: RegExp) => {
      while (!needle.test(text)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil(/event: model/);
    expect(text).toContain(store.current()!.etag.replace(/"/g, '\\"'));

    put('b.yaml', 'version: 1\nnetworks: [{ id: lan }]\n');
    await store.reload();
    await readUntil(/event: model[\s\S]*event: model/);

    shutdown.abort();
    await readUntil(/$^/); // drains until the stream ends
    store.close();
  });

  it('limits concurrent event streams', async () => {
    const { app } = await setup({ maxEventClients: 0 });
    expect((await app.request('/api/events')).status).toBe(503);
  });

  it('serves the SPA with long-lived caching only for hashed assets', async () => {
    const pub = join(dir, 'public');
    mkdirSync(join(pub, 'assets'), { recursive: true });
    writeFileSync(
      join(pub, 'index.html'),
      '<!doctype html><meta name="csp-nonce" content="__CSP_NONCE__"><title>x</title>',
    );
    writeFileSync(join(pub, 'assets', 'app-abc.js'), 'console.log(1)');
    const { app } = await setup({ publicDir: pub });

    const index = await app.request('/');
    expect(index.status).toBe(200);
    expect(index.headers.get('cache-control')).toBe('no-cache');
    // Each page load gets its own style nonce, in both the CSP and the page.
    const nonce = /'nonce-([^']+)'/.exec(index.headers.get('content-security-policy')!)?.[1];
    expect(nonce).toMatch(/^[A-Za-z0-9+/=]{24}$/);
    expect(await index.text()).toContain(`content="${nonce}"`);
    const again = await app.request('/');
    expect(again.headers.get('content-security-policy')).not.toContain(nonce);
    // Other responses keep the nonce-free policy.
    expect((await app.request('/api/model')).headers.get('content-security-policy')).toBe(CSP);
    const asset = await app.request('/assets/app-abc.js');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    const deep = await app.request('/some/client/path');
    expect(await deep.text()).toContain('<title>x</title>');
    const traversal = await app.request('/../a.yaml');
    expect(await traversal.text()).not.toContain('version');
  });
});

describe('whoAmI', () => {
  it('reads the proxy identity headers and strips control characters', () => {
    const headers = new Headers({ 'Remote-User': 'alice', 'Remote-Name': 'Alice\u0007 A.' });
    expect(whoAmI(headers)).toEqual({ user: 'alice', name: 'Alice A.' });
    expect(whoAmI(new Headers())).toEqual({});
  });
});

describe('config', () => {
  it('applies defaults', () => {
    expect(loadConfig({}, '/pub')).toEqual({
      dataDir: '/data',
      port: 8080,
      kumaUrl: undefined,
      kumaApiKeyFile: undefined,
      dozzleUrl: undefined,
      publicDir: '/pub',
    });
  });

  it('parses URLs and treats empty values as unset', () => {
    const c = loadConfig({ KUMA_URL: 'http://kuma:3001', DOZZLE_URL: '', PORT: '9000' }, '/p');
    expect(c.kumaUrl?.href).toBe('http://kuma:3001/');
    expect(c.dozzleUrl).toBeUndefined();
    expect(c.port).toBe(9000);
  });

  it('fails clearly on invalid values', () => {
    expect(() => loadConfig({ PORT: 'eighty', KUMA_URL: 'ftp://x' }, '/p')).toThrow(ConfigError);
    try {
      loadConfig({ PORT: '70000', DOZZLE_URL: 'not a url' }, '/p');
    } catch (err) {
      expect((err as Error).message).toMatch(/PORT[\s\S]*DOZZLE_URL/);
    }
  });
});

describe('review regressions', () => {
  it('does not leak event-stream slots on HEAD requests', async () => {
    put('a.yaml', HOST);
    const store = new ModelStore(dir);
    await store.reload();
    const app = createApp({ store, maxEventClients: 2 });
    for (let i = 0; i < 3; i++) {
      expect((await app.request('/api/events', { method: 'HEAD' })).status).toBe(405);
    }
    const res = await app.request('/api/events');
    expect(res.status).toBe(200);
    await res.body!.cancel();
    expect((await app.request('/api/logs/docker/wiki', { method: 'HEAD' })).status).toBe(405);
    store.close();
  });

  it('keeps the last good model when an alias refers to itself', async () => {
    put('a.yaml', HOST);
    const store = new ModelStore(dir);
    await store.reload();
    put('a.yaml', 'version: 1\nnodes:\n  - { id: pve, kind: host, x: &l { s: *l } }\n');
    await store.reload();
    const { model } = store.current()!;
    expect(model.stale).toBe(true);
    expect(model.problems[0]).toMatchObject({ code: 'yaml', file: 'a.yaml' });
    store.close();
  });

  it('ignores __proto__ keys instead of polluting prototypes', async () => {
    put(
      'a.yaml',
      'version: 1\nmeta: { __proto__: { polluted: yes } }\nnodes:\n  - { id: pve, kind: host, __proto__: { logs: x } }\n',
    );
    const store = new ModelStore(dir);
    await store.reload();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const { model } = store.current()!;
    expect(Object.getPrototypeOf(model.nodes[0])).toBe(Object.prototype);
    expect(model.problems.map((p) => p.code)).toContain('unknown-key');
    store.close();
  });
});
