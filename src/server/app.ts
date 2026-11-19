/** HTTP surface: read-only API, SSE notifications, and the built SPA. */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { compress } from 'hono/compress';
import { streamSSE } from 'hono/streaming';
import type { HealthResponse, WhoAmI } from '../shared/model.js';
import { toJsonSchema } from '../shared/schema.js';
import type { ModelStore } from './store.js';

export interface HealthSource {
  get(): Promise<HealthResponse>;
}

export interface LogSource {
  stream(
    c: Context,
    host: string,
    container: string,
    tail: number,
    signal: AbortSignal,
  ): Response | Promise<Response>;
}

export interface AppDeps {
  store: ModelStore;
  publicDir?: string;
  health?: HealthSource;
  logs?: LogSource;
  /** Aborted on shutdown so long-lived streams end. */
  shutdown?: AbortSignal;
  maxEventClients?: number;
  heartbeatMs?: number;
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

const MAX_HEADER_VALUE = 200;

/** Identity headers set by the auth proxy; display-only, never used for decisions. */
export function whoAmI(headers: Headers): WhoAmI {
  const clean = (v: string | null) => {
    const s = [...(v ?? '')]
      .filter((ch) => ch >= ' ' && ch !== '\u007f')
      .join('')
      .trim()
      .slice(0, MAX_HEADER_VALUE);
    return s ? s : undefined;
  };
  const out: WhoAmI = {};
  const user = clean(headers.get('remote-user'));
  const name = clean(headers.get('remote-name'));
  if (user) out.user = user;
  if (name) out.name = name;
  return out;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const maxClients = deps.maxEventClients ?? 64;
  const heartbeatMs = deps.heartbeatMs ?? 25_000;
  let eventClients = 0;
  const schemaBody = `${JSON.stringify(toJsonSchema(), null, 2)}\n`;

  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      return c.text('Method Not Allowed', 405, { Allow: 'GET, HEAD' });
    }
    // Hono answers HEAD by running the GET handler and dropping the body, which would leave
    // stream slots and upstream connections open. Streams are GET only.
    if (c.req.method === 'HEAD' && /^\/api\/(events|logs)(\/|$)/.test(c.req.path)) {
      return c.text('Method Not Allowed', 405, { Allow: 'GET' });
    }
    await next();
    if (!c.res.headers.has('Content-Security-Policy')) c.header('Content-Security-Policy', CSP);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
    c.header('Cross-Origin-Opener-Policy', 'same-origin');
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  });

  app.get('/healthz', (c) =>
    deps.store.current()
      ? c.json({ status: 'ok' })
      : c.json({ status: 'starting' }, 503, { 'Cache-Control': 'no-store' }),
  );

  app.get('/api/model', compress(), (c) => {
    const snap = deps.store.current();
    if (!snap) return c.json({ error: 'model not loaded yet' }, 503);
    const headers = { ETag: snap.etag, 'Cache-Control': 'no-cache' };
    if (etagMatches(c.req.header('if-none-match'), snap.etag)) {
      return c.body(null, 304, headers);
    }
    return c.body(snap.body, 200, {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
    });
  });

  app.get('/api/events', (c) => {
    if (eventClients >= maxClients) return c.json({ error: 'too many event streams' }, 503);
    eventClients++;
    c.header('Cache-Control', 'no-store');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const done = new AbortController();
      const end = () => done.abort();
      stream.onAbort(end);
      deps.shutdown?.addEventListener('abort', end, { once: true });
      const send = (etag: string) =>
        stream.writeSSE({ event: 'model', data: JSON.stringify({ etag }) }).catch(end);
      const unsubscribe = deps.store.subscribe((snap) => void send(snap.etag));
      const heartbeat = setInterval(() => void stream.write(': ping\n\n').catch(end), heartbeatMs);
      try {
        const snap = deps.store.current();
        if (snap) await send(snap.etag);
        if (!deps.shutdown?.aborted) {
          await new Promise<void>((resolve) =>
            done.signal.addEventListener('abort', () => resolve(), { once: true }),
          );
        }
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
        deps.shutdown?.removeEventListener('abort', end);
        eventClients--;
      }
    });
  });

  app.get('/api/me', (c) =>
    c.json(whoAmI(c.req.raw.headers), 200, { 'Cache-Control': 'no-store' }),
  );

  app.get('/api/health', async (c) => {
    if (!deps.health)
      return c.json({ error: 'Uptime Kuma is not configured' } satisfies HealthResponse);
    return c.json(await deps.health.get(), 200, { 'Cache-Control': 'no-store' });
  });

  app.get('/api/logs/:host/:container', (c) => {
    if (!deps.logs) return c.json({ error: 'Dozzle is not configured' }, 503);
    const tailParam = c.req.query('tail');
    const tail = tailParam === undefined ? 200 : Number(tailParam);
    if (!Number.isInteger(tail) || tail < 0)
      return c.json({ error: 'tail must be a non-negative integer' }, 400);
    const signal = deps.shutdown
      ? AbortSignal.any([c.req.raw.signal, deps.shutdown])
      : c.req.raw.signal;
    return deps.logs.stream(c, c.req.param('host'), c.req.param('container'), tail, signal);
  });

  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

  app.get('/schema/system-map.schema.json', (c) =>
    c.body(schemaBody, 200, { 'Content-Type': 'application/schema+json; charset=utf-8' }),
  );

  if (deps.publicDir && existsSync(join(deps.publicDir, 'index.html'))) {
    const root = deps.publicDir;
    const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
    // Libraries that inject <style> tags (dialog scroll lock) read this nonce via get-nonce.
    const spa = (c: Context) => {
      const nonce = randomBytes(16).toString('base64');
      return c.html(indexHtml.replaceAll(NONCE_PLACEHOLDER, nonce), 200, {
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': cspWith(`style-src 'self' 'nonce-${nonce}'`),
      });
    };
    app.get('/', spa);
    app.get('/index.html', spa);
    app.use('*', async (c, next) => {
      await next();
      if (c.res.status !== 200 || c.res.headers.has('Cache-Control')) return;
      // Vite puts content-hashed files under /assets.
      const immutable = c.req.path.startsWith('/assets/');
      c.res.headers.set(
        'Cache-Control',
        immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    });
    app.use('*', compress(), serveStatic({ root }));
    // Unknown paths get the SPA; routing happens in the URL hash.
    app.get('*', spa);
  }
  return app;
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((t) => {
    const tag = t.trim();
    return tag === '*' || tag === etag || tag === `W/${etag}`;
  });
}
