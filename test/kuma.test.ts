import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KumaClient, kumaHealth, parsePrometheus } from '../src/server/kuma.js';

// Shapes taken from Uptime Kuma 2.5 /metrics output.
const METRICS = `# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)
# TYPE monitor_status gauge
monitor_status{env="prod",monitor_id="1",monitor_name="Wiki",monitor_type="http",monitor_url="https://wiki.example.net/",monitor_hostname="null",monitor_port="null"} 1
monitor_status{monitor_id="2",monitor_name="Auth \\"portal\\", main",monitor_type="http",monitor_url="https://auth.example.net/",monitor_hostname="null",monitor_port="null"} 0
monitor_status{monitor_id="3",monitor_name="DNS",monitor_type="dns",monitor_url="null",monitor_hostname="10.10.0.53",monitor_port="53"} 2
monitor_status{monitor_id="4",monitor_name="Maint",monitor_type="http",monitor_url="null",monitor_hostname="null",monitor_port="null"} 3
monitor_response_time{monitor_id="1",monitor_name="Wiki",monitor_type="http",monitor_url="https://wiki.example.net/",monitor_hostname="null",monitor_port="null"} 123
monitor_response_time{monitor_id="3",monitor_name="DNS",monitor_type="dns",monitor_url="null",monitor_hostname="10.10.0.53",monitor_port="53"} -1
monitor_uptime_ratio{monitor_id="1",monitor_name="Wiki",monitor_type="http",monitor_url="https://wiki.example.net/",monitor_hostname="null",monitor_port="null",window="1d"} 0.998
monitor_uptime_ratio{monitor_id="1",monitor_name="Wiki",monitor_type="http",monitor_url="https://wiki.example.net/",monitor_hostname="null",monitor_port="null",window="30d"} 0.9991
monitor_status{monitor_name="Old 1.23 series",monitor_type="http",monitor_url="null",monitor_hostname="null",monitor_port="null"} 1
process_cpu_user_seconds_total 0.5
app_version{version="2.5.12",major="2",minor="5",patch="12"} 1
`;

describe('Kuma metrics', () => {
  it('parses labels including escaped quotes and commas', () => {
    const s = parsePrometheus(METRICS).find((x) => x.labels.monitor_id === '2');
    expect(s?.labels.monitor_name).toBe('Auth "portal", main');
    expect(s?.value).toBe(0);
  });

  it('maps statuses, pings and uptime per monitor id', () => {
    expect(kumaHealth(METRICS)).toEqual({
      '1': { status: 'up', name: 'Wiki', ping: 123, uptime: { '1d': 0.998, '30d': 0.9991 } },
      '2': { status: 'down', name: 'Auth "portal", main' },
      '3': { status: 'pending', name: 'DNS' },
      '4': { status: 'maintenance', name: 'Maint' },
    });
  });

  it('ignores garbage', () => {
    expect(kumaHealth('not metrics\n{}\nmonitor_status{monitor_id="x"} 1\n')).toEqual({});
  });
});

describe('KumaClient', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const ok = () => new Response(METRICS, { status: 200 });

  it('fetches /metrics without auth when no key file is set, and caches', async () => {
    const fetchMock = vi.fn(async () => ok());
    let now = 0;
    const kuma = new KumaClient({
      url: new URL('http://kuma:3001/'),
      fetch: fetchMock as typeof fetch,
      now: () => now,
    });
    const [a, b] = await Promise.all([kuma.get(), kuma.get()]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe('http://kuma:3001/metrics');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect((a['1'] as { status: string }).status).toBe('up');

    now = 29_000;
    await kuma.get();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now = 31_000;
    await kuma.get();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends the API key as the basic-auth password when a key file is set', async () => {
    dir = mkdtempSync(join(tmpdir(), 'kuma-'));
    const keyFile = join(dir, 'key');
    writeFileSync(keyFile, 'uk1_secret\n');
    const fetchMock = vi.fn(async () => ok());
    await new KumaClient({
      url: new URL('http://kuma:3001/base/'),
      apiKeyFile: keyFile,
      fetch: fetchMock as typeof fetch,
    }).get();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe('http://kuma:3001/base/metrics');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(':uk1_secret').toString('base64')}`,
    );
  });

  it('returns an error instead of failing when the key file is missing', async () => {
    const fetchMock = vi.fn(async () => ok());
    const body = await new KumaClient({
      url: new URL('http://kuma:3001/'),
      apiKeyFile: '/nonexistent/key',
      fetch: fetchMock as typeof fetch,
    }).get();
    expect(body).toEqual({ error: expect.stringContaining('not readable') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an error for HTTP failures, network errors and oversized bodies', async () => {
    const url = new URL('http://kuma:3001/');
    const http = await new KumaClient({
      url,
      fetch: (async () => new Response('no', { status: 401 })) as typeof fetch,
    }).get();
    expect(http).toEqual({ error: 'Uptime Kuma answered HTTP 401' });

    const down = await new KumaClient({
      url,
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    }).get();
    expect(down).toEqual({ error: 'fetch failed' });

    const big = await new KumaClient({
      url,
      maxBytes: 100,
      fetch: (async () => ok()) as typeof fetch,
    }).get();
    expect(big.error).toContain('exceed');
  });

  it('retries sooner after an error than after success', async () => {
    let now = 0;
    let fail = true;
    const fetchMock = vi.fn(async () => (fail ? new Response('', { status: 500 }) : ok()));
    const kuma = new KumaClient({
      url: new URL('http://kuma:3001/'),
      fetch: fetchMock as typeof fetch,
      now: () => now,
    });
    expect((await kuma.get()).error).toBeDefined();
    fail = false;
    now = 11_000;
    expect((await kuma.get()).error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('times out a hanging Kuma', async () => {
    const hang = ((_u: URL, init: RequestInit) =>
      new Promise((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(new Error('timed out'))),
      )) as unknown as typeof fetch;
    const body = await new KumaClient({
      url: new URL('http://kuma/'),
      timeoutMs: 50,
      fetch: hang,
    }).get();
    expect(body.error).toBe('timed out');
  });
});
