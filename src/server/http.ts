/** HTTP surface: the typed JSON API, SSE notifications and log streams, and the built SPA. */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Context, Deferred, Duration, Effect, Layer, Option, Semaphore, Stream } from 'effect';
import {
  HttpMiddleware,
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { SystemMapApi } from '../shared/api.js';
import type { WhoAmI } from '../shared/model.js';
import { toJsonSchema } from '../shared/schema.js';
import { sseComment, sseFrame } from '../shared/sse.js';
import { Logs } from './dozzle.js';
import { Health } from './kuma.js';
import { DataStore } from './store.js';

/** Completed on shutdown so long-lived streams end instead of holding the server open. */
export class Shutdown extends Context.Service<Shutdown, Deferred.Deferred<void>>()(
  'system-map/Shutdown',
) {
  static readonly layer = Layer.effect(Shutdown, Deferred.make<void>());
}

export interface HttpOptions {
  /** Directory with the built SPA; without an `index.html` only the API is served. */
  readonly publicDir?: string | undefined;
  readonly maxEventClients?: number;
  readonly heartbeat?: Duration.Input;
}

/** CSP for everything except the SPA page, which adds a per-response style nonce. */
export const CSP = cspWith("style-src 'self'");

/** Placeholder in index.html replaced by the per-response nonce. */
export const NONCE_PLACEHOLDER = '__CSP_NONCE__';

function cspWith(styleSrc: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    styleSrc,
    // React Flow and Radix position elements with inline style attributes.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

const MAX_HEADER_VALUE = 200;

/** Identity headers set by the auth proxy; display-only, never used for decisions. */
export function whoAmI(header: (name: string) => string | undefined): WhoAmI {
  const clean = (v: string | undefined) => {
    const s = [...(v ?? '')]
      .filter((ch) => ch >= ' ' && ch !== '\u007f')
      .join('')
      .trim()
      .slice(0, MAX_HEADER_VALUE);
    return s ? s : undefined;
  };
  const user = clean(header('remote-user'));
  const name = clean(header('remote-name'));
  return { ...(user ? { user } : {}), ...(name ? { name } : {}) };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers });

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((t) => {
    const tag = t.trim();
    return tag === '*' || tag === etag || tag === `W/${etag}`;
  });
}

const STREAM_HEADERS = { 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' };
const sseResponse = <E>(body: Stream.Stream<Uint8Array, E>) =>
  HttpServerResponse.stream(body, { contentType: 'text/event-stream', headers: STREAM_HEADERS });

/** The JSON API, implemented against the shared `HttpApi` definition. */
const ApiHandlers = HttpApiBuilder.group(SystemMapApi, 'systemMap', (handlers) =>
  Effect.gen(function* () {
    const store = yield* DataStore;
    const health = yield* Health;
    return handlers
      .handle('model', ({ request }) =>
        Effect.gen(function* () {
          const snap = yield* store.current;
          if (Option.isNone(snap)) return json({ error: 'model not loaded yet' }, 503);
          // The model is served as serialized once per change, not re-encoded per request.
          const headers = { ETag: snap.value.etag, 'Cache-Control': 'no-cache' };
          if (etagMatches(request.headers['if-none-match'], snap.value.etag)) {
            return HttpServerResponse.empty({ status: 304, headers });
          }
          return HttpServerResponse.text(snap.value.body, {
            headers,
            contentType: 'application/json; charset=utf-8',
          });
        }),
      )
      .handle('health', () =>
        Effect.map(health.get, (body) => json(body, 200, { 'Cache-Control': 'no-store' })),
      )
      .handle('me', ({ request }) =>
        Effect.succeed(
          json(
            whoAmI((name) => request.headers[name]),
            200,
            { 'Cache-Control': 'no-store' },
          ),
        ),
      );
  }),
);

const ApiLayer = HttpApiBuilder.layer(SystemMapApi).pipe(Layer.provide(ApiHandlers));

/** `/healthz`, the SSE streams and the JSON Schema. */
const routes = (options: HttpOptions) =>
  HttpRouter.use(
    Effect.fnUntraced(function* (router) {
      const store = yield* DataStore;
      const logs = yield* Logs;
      const shutdown = yield* Shutdown;
      const ended = Deferred.await(shutdown);
      const maxEventClients = options.maxEventClients ?? 64;
      const eventSlots = yield* Semaphore.make(maxEventClients);
      const schemaBody = `${JSON.stringify(toJsonSchema(), null, 2)}\n`;

      yield* router.add(
        'GET',
        '/healthz',
        Effect.map(store.current, (snap) =>
          Option.isSome(snap)
            ? json({ status: 'ok' })
            : json({ status: 'starting' }, 503, { 'Cache-Control': 'no-store' }),
        ),
      );

      yield* router.add(
        'GET',
        '/api/events',
        Effect.gen(function* () {
          if (maxEventClients <= 0 || !(yield* eventSlots.takeIfAvailable(1))) {
            return json({ error: 'too many event streams' }, 503);
          }
          const heartbeat = Stream.tick(options.heartbeat ?? '25 seconds').pipe(
            Stream.drop(1),
            Stream.map(() => sseComment('ping')),
          );
          const body = store.snapshots.pipe(
            Stream.map((snap) => sseFrame('model', { etag: snap.etag })),
            Stream.merge(heartbeat),
            Stream.interruptWhen(ended),
            Stream.ensuring(eventSlots.release(1)),
          );
          return sseResponse(body);
        }),
      );

      yield* router.add(
        'GET',
        '/api/logs/:host/:container',
        Effect.gen(function* () {
          const { params } = yield* HttpRouter.RouteContext;
          const search = yield* HttpServerRequest.ParsedSearchParams;
          const raw = search.tail;
          const tail = raw === undefined ? 200 : Number(Array.isArray(raw) ? raw[0] : raw);
          if (!Number.isInteger(tail) || tail < 0) {
            return json({ error: 'tail must be a non-negative integer' }, 400);
          }
          const opened = yield* Effect.result(
            logs.open(params.host ?? '', params.container ?? '', tail),
          );
          if (opened._tag === 'Failure') {
            return json({ error: opened.failure.message }, opened.failure.status);
          }
          return sseResponse(
            opened.success.pipe(
              Stream.map((e) => sseFrame(e.event, e.data)),
              Stream.interruptWhen(ended),
            ),
          );
        }),
      );

      yield* router.add(
        'GET',
        '/schema/system-map.schema.json',
        HttpServerResponse.text(schemaBody, {
          contentType: 'application/schema+json; charset=utf-8',
        }),
      );
    }),
  );

const STREAM_PATH = /^\/api\/(events|logs)(\/|$)/;

/**
 * Wraps every request: GET/HEAD only, security headers, 404 JSON for unknown API paths, and the
 * SPA (static files, then `index.html`) for everything else.
 */
const appMiddleware = (options: HttpOptions) => {
  const root = options.publicDir;
  const indexHtml =
    root && existsSync(join(root, 'index.html'))
      ? readFileSync(join(root, 'index.html'), 'utf8')
      : undefined;

  // Libraries that inject <style> tags (dialog scroll lock) read this nonce via get-nonce.
  const spa = Effect.sync(() => {
    const nonce = randomBytes(16).toString('base64');
    return HttpServerResponse.html(indexHtml!.replaceAll(NONCE_PLACEHOLDER, nonce)).pipe(
      HttpServerResponse.setHeaders({
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': cspWith(`style-src 'self' 'nonce-${nonce}'`),
      }),
    );
  });

  return HttpRouter.middleware<{ handles: HttpServerError.HttpServerError }>()(
    Effect.gen(function* () {
      const statics = indexHtml
        ? Option.some(yield* HttpStaticServer.make({ root: root! }))
        : Option.none();
      return (httpEffect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const path = new URL(request.url, 'http://x').pathname;
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            return HttpServerResponse.text('Method Not Allowed', {
              status: 405,
              headers: { Allow: 'GET, HEAD' },
            });
          }
          // Streams are GET only; a HEAD would otherwise hold a stream slot and an upstream.
          if (request.method === 'HEAD' && STREAM_PATH.test(path)) {
            return HttpServerResponse.text('Method Not Allowed', {
              status: 405,
              headers: { Allow: 'GET' },
            });
          }
          if (Option.isSome(statics) && (path === '/' || path === '/index.html')) return yield* spa;

          const response = yield* httpEffect.pipe(
            Effect.catchTag('HttpServerError', (err) => {
              if (err.reason._tag !== 'RouteNotFound') return Effect.fail(err);
              if (path.startsWith('/api/') || path === '/api' || Option.isNone(statics)) {
                return Effect.succeed(json({ error: 'not found' }, 404));
              }
              return statics.value.pipe(
                Effect.map((res) => {
                  if (res.status !== 200 || res.headers['cache-control']) return res;
                  // Vite puts content-hashed files under /assets.
                  const immutable = path.startsWith('/assets/');
                  return HttpServerResponse.setHeader(
                    res,
                    'Cache-Control',
                    immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
                  );
                }),
                // Unknown paths get the SPA; routing happens in the URL hash.
                Effect.catch(() => spa),
              );
            }),
          );
          return response;
        }).pipe(
          Effect.map((res) =>
            HttpServerResponse.setHeaders(res, {
              ...(res.headers['content-security-policy'] ? {} : { 'Content-Security-Policy': CSP }),
              ...SECURITY_HEADERS,
            }),
          ),
          // Event streams must not be buffered by a compressor.
          HttpMiddleware.compression({
            algorithms: ['gzip'],
            compressible: (type) =>
              !type.startsWith('text/event-stream') && /json|javascript|text|svg|xml/.test(type),
          }),
        );
    }),
    { global: true },
  );
};

/** All routes and middleware; needs DataStore, Health, Logs and Shutdown. */
export const layer = (options: HttpOptions = {}) =>
  Layer.mergeAll(ApiLayer, routes(options), appMiddleware(options));
