/**
 * Uptime Kuma health from its Prometheus `/metrics` endpoint, cached so the page never waits on
 * Kuma and Kuma's API rate limit (60/min) is never approached.
 */
import { readFile } from 'node:fs/promises';
import type { HealthResponse, HealthStatus, MonitorHealth } from '../shared/model.js';
import { errorMessage, log } from './log.js';

const STATUS: Record<string, HealthStatus> = {
  '0': 'down',
  '1': 'up',
  '2': 'pending',
  '3': 'maintenance',
};

export interface MetricSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)(?:\s+\d+)?$/;
const LABEL = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"\s*,?\s*/g;

/** Minimal Prometheus text-format parser (enough for Kuma's gauges). */
export function parsePrometheus(text: string): MetricSample[] {
  const out: MetricSample[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    const labels: Record<string, string> = {};
    for (const l of (m[2] ?? '').matchAll(LABEL)) {
      labels[l[1]!] = l[2]!.replace(/\\(["\\n])/g, (_, c: string) => (c === 'n' ? '\n' : c));
    }
    out.push({ name: m[1]!, labels, value: Number(m[3]) });
  }
  return out;
}

/** Kuma metrics → health per monitor id. Series without `monitor_id` (Kuma < 2.0) are skipped. */
export function kumaHealth(text: string): Record<string, MonitorHealth> {
  const monitors: Record<string, MonitorHealth> = {};
  const get = (labels: Record<string, string>) => {
    const id = labels.monitor_id;
    if (!id || !/^\d+$/.test(id)) return undefined;
    monitors[id] ??= { status: 'unknown', name: labels.monitor_name ?? '' };
    return monitors[id];
  };
  for (const s of parsePrometheus(text)) {
    if (s.name === 'monitor_status') {
      const m = get(s.labels);
      if (m) m.status = STATUS[String(s.value)] ?? 'unknown';
    } else if (s.name === 'monitor_response_time') {
      const m = get(s.labels);
      if (m && Number.isFinite(s.value) && s.value >= 0) m.ping = s.value;
    } else if (s.name === 'monitor_uptime_ratio' && s.labels.window) {
      const m = get(s.labels);
      if (m && Number.isFinite(s.value)) (m.uptime ??= {})[s.labels.window] = s.value;
    }
  }
  return monitors;
}

export interface KumaOptions {
  url: URL;
  apiKeyFile?: string;
  ttlMs?: number;
  /** Errors are cached for less time, so recovery shows up quickly. */
  errorTtlMs?: number;
  timeoutMs?: number;
  maxBytes?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

export class KumaClient {
  private cached: { at: number; body: HealthResponse; ok: boolean } | undefined;
  private inflight: Promise<HealthResponse> | undefined;
  private readonly metricsUrl: URL;

  constructor(private readonly o: KumaOptions) {
    this.metricsUrl = new URL('metrics', o.url);
  }

  async get(): Promise<HealthResponse> {
    const now = (this.o.now ?? Date.now)();
    if (this.cached) {
      const ttl = this.cached.ok ? (this.o.ttlMs ?? 30_000) : (this.o.errorTtlMs ?? 10_000);
      if (now - this.cached.at < ttl) return this.cached.body;
    }
    this.inflight ??= this.fetchHealth().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async fetchHealth(): Promise<HealthResponse> {
    const now = (this.o.now ?? Date.now)();
    try {
      const headers: Record<string, string> = { Accept: 'text/plain' };
      if (this.o.apiKeyFile) {
        let key: string;
        try {
          key = (await readFile(this.o.apiKeyFile, 'utf8')).trim();
        } catch (err) {
          throw new Error(`Kuma API key file is not readable: ${errorMessage(err)}`, {
            cause: err,
          });
        }
        if (!key) throw new Error('Kuma API key file is empty');
        // Kuma takes the key as the basic-auth password; the username is ignored.
        headers.Authorization = `Basic ${Buffer.from(`:${key}`).toString('base64')}`;
      }
      const res = await (this.o.fetch ?? fetch)(this.metricsUrl, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 5_000),
      });
      if (!res.ok) throw new Error(`Uptime Kuma answered HTTP ${res.status}`);
      const text = await readLimited(res, this.o.maxBytes ?? 8 * 1024 * 1024);
      const body: HealthResponse = { ...kumaHealth(text) };
      this.cached = { at: now, body, ok: true };
      return body;
    } catch (err) {
      const message = errorMessage(err);
      if (this.cached?.ok !== false) log.warn('uptime kuma unavailable', { error: message });
      const body: HealthResponse = { error: message };
      this.cached = { at: now, body, ok: false };
      return body;
    }
  }
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`Uptime Kuma metrics exceed ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
