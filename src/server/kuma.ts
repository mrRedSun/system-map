/**
 * Uptime Kuma health from its Prometheus `/metrics` endpoint, fetched on demand and cached, so
 * the page never waits on Kuma and Kuma's API rate limit (60/min) is never approached. Nothing
 * polls Kuma while nobody looks at the page.
 */
import {
  Clock,
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Schema,
  Semaphore,
  Stream,
} from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import type { HealthResponse, HealthStatus, MonitorHealth } from '../shared/model.js';
import { AppConfig } from './config.js';
import { errorMessage } from './logging.js';

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

type MutableHealth = { -readonly [K in keyof MonitorHealth]: MonitorHealth[K] } & {
  uptime?: Record<string, number>;
};

/** Kuma metrics → health per monitor id. Series without `monitor_id` (Kuma < 2.0) are skipped. */
export function kumaHealth(text: string): Record<string, MonitorHealth> {
  const monitors: Record<string, MutableHealth> = {};
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

export class KumaError extends Schema.TaggedError<KumaError>()('KumaError', {
  message: Schema.String,
}) {}

export interface KumaOptions {
  url: URL;
  apiKeyFile?: string;
  ttl?: Duration.Input;
  /** Errors are cached for less time, so recovery shows up quickly; see `errorTtl`. */
  errorTtl?: Duration.Input;
  timeout?: Duration.Input;
  maxBytes?: number;
}

/**
 * How long a failed read is cached: `base`, doubling with each consecutive failure, never
 * longer than a successful read is cached. Kuma being down then costs at most one request
 * per `ttl`, while a short outage still clears within `base`.
 */
export function errorBackoff(failures: number, base: Duration.Duration, ttl: Duration.Duration) {
  const ms = Duration.toMillis(base) * 2 ** Math.max(0, failures - 1);
  return Duration.millis(Math.min(ms, Duration.toMillis(ttl)));
}

/** Health source behind `/api/health`. Never fails: errors become `{ error }`. */
export class Health extends Context.Service<
  Health,
  { readonly get: Effect.Effect<HealthResponse> }
>()('system-map/Health') {
  /** Kuma when `KUMA_URL` is set; otherwise a fixed "not configured" answer. */
  static readonly layer = Layer.effect(
    Health,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      if (Option.isNone(config.kumaUrl)) {
        return Health.of({ get: Effect.succeed({ error: 'Uptime Kuma is not configured' }) });
      }
      return yield* makeKuma({
        url: config.kumaUrl.value,
        ...(Option.isSome(config.kumaApiKeyFile)
          ? { apiKeyFile: config.kumaApiKeyFile.value }
          : {}),
      });
    }),
  );
}

export const makeKuma = Effect.fnUntraced(function* (o: KumaOptions) {
  const http = yield* HttpClient.HttpClient;
  const fs = yield* FileSystem.FileSystem;
  const ttl = Duration.fromInputUnsafe(o.ttl ?? '30 seconds');
  const errorTtl = Duration.fromInputUnsafe(o.errorTtl ?? '10 seconds');
  const maxBytes = o.maxBytes ?? 8 * 1024 * 1024;
  const metricsUrl = new URL('metrics', o.url).href;
  const lock = yield* Semaphore.make(1);
  let cached: { at: number; body: HealthResponse; ok: boolean } | undefined;
  let failures = 0;

  const authHeader = Effect.gen(function* () {
    if (o.apiKeyFile === undefined) return Option.none<string>();
    const key = (yield* fs
      .readFileString(o.apiKeyFile)
      .pipe(
        Effect.mapError(
          (err) =>
            new KumaError({ message: `Kuma API key file is not readable: ${errorMessage(err)}` }),
        ),
      )).trim();
    if (!key) return yield* new KumaError({ message: 'Kuma API key file is empty' });
    // Kuma takes the key as the basic-auth password; the username is ignored.
    return Option.some(`Basic ${Buffer.from(`:${key}`).toString('base64')}`);
  });

  const fetchMetrics = Effect.gen(function* () {
    const auth = yield* authHeader;
    let req = HttpClientRequest.get(metricsUrl).pipe(HttpClientRequest.accept('text/plain'));
    if (Option.isSome(auth)) req = HttpClientRequest.setHeader(req, 'Authorization', auth.value);
    const res = yield* http.execute(req).pipe(
      // Report the underlying cause (e.g. "fetch failed"), as the pre-Effect client did.
      Effect.mapError((err) => {
        const cause = (err.reason as { cause?: unknown } | undefined)?.cause;
        return new KumaError({ message: errorMessage(cause ?? err.reason ?? err) });
      }),
    );
    if (res.status < 200 || res.status >= 300) {
      return yield* new KumaError({ message: `Uptime Kuma answered HTTP ${res.status}` });
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    yield* res.stream.pipe(
      Stream.mapError((err) => new KumaError({ message: errorMessage(err) })),
      Stream.runForEach((chunk) => {
        size += chunk.byteLength;
        if (size > maxBytes) {
          return Effect.fail(
            new KumaError({ message: `Uptime Kuma metrics exceed ${maxBytes} bytes` }),
          );
        }
        chunks.push(chunk);
        return Effect.void;
      }),
    );
    return Buffer.concat(chunks).toString('utf8');
  }).pipe(
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: o.timeout ?? '5 seconds',
      orElse: () => Effect.fail(new KumaError({ message: 'Uptime Kuma did not answer in time' })),
    }),
  );

  const refresh = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (cached) {
      const fresh = cached.ok ? ttl : errorBackoff(failures, errorTtl, ttl);
      if (now - cached.at < Duration.toMillis(fresh)) return cached.body;
    }
    const result = yield* Effect.result(fetchMetrics);
    if (result._tag === 'Success') {
      failures = 0;
      cached = { at: now, body: { ...kumaHealth(result.success) }, ok: true };
    } else {
      if (failures === 0) {
        yield* Effect.logWarning('uptime kuma unavailable').pipe(
          Effect.annotateLogs({ error: result.failure.message }),
        );
      }
      failures++;
      cached = { at: now, body: { error: result.failure.message }, ok: false };
    }
    return cached.body;
  });

  // One fetch at a time; callers that waited get the result it cached.
  return Health.of({ get: lock.withPermits(1)(refresh) });
});
