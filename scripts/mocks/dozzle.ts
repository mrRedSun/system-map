/**
 * Mock Dozzle hub (v11 API shape): one host per agent name, one container per declared service,
 * a history of plausible lines and, unless disabled, a live stream that adds a line every second.
 * Development and screenshots only.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockContainer {
  host: string;
  name: string;
}

export interface DozzleMockOptions {
  /** Append a new line every second (off for screenshots, so the tail is stable). */
  live?: boolean;
  /** Timestamp of the newest history line (ms). */
  now?: () => number;
}

/** A fake API key that the app's redaction must hide. Not a secret anywhere. */
export const FAKE_KEY = 'demo_4f9c2a7e1b8d6053';

const TEMPLATES: [RegExp, string[]][] = [
  [
    /traefik|proxy|caddy/,
    ['GET /api/v1/status 200 3ms', 'router %s@docker: 200 OK in 12ms', 'TLS handshake ok for %h'],
  ],
  [
    /sonarr|radarr|prowlarr|bazarr|lidarr/,
    [
      'RSS sync started',
      'Found 3 releases for search',
      'Grabbed release, sent to download client',
      'Import complete: 1 file moved',
    ],
  ],
  [
    /qbit|torrent|sab/,
    [
      'Added torrent to queue',
      'Download finished: 2.1 GiB in 4m12s',
      'Moved files to /data/media/incoming',
    ],
  ],
  [
    /jellyfin|plex|emby/,
    [
      'Playback started on Living room TV',
      'Library scan finished: 4 new items',
      'Transcode: h264 1080p → 720p',
    ],
  ],
  [
    /home-?assistant|hass/,
    [
      'Automation "Evening lights" triggered',
      'Sensor hallway_motion changed to on',
      'Service light.turn_on called',
    ],
  ],
  [
    /frigate|nvr/,
    [
      'Detected person on front_door (score 0.91)',
      'Recording segment saved',
      'Event ended after 18s',
    ],
  ],
  [
    /postgres|mariadb|db/,
    [
      'checkpoint complete: wrote 412 buffers',
      'connection authorized: user=app database=app',
      'autovacuum: table "public.items"',
    ],
  ],
  [
    /bot/,
    ['Received /status from chat', 'Sent daily summary (6 items)', 'Polling Telegram Bot API'],
  ],
  [
    /kuma|grafana|prometheus|loki/,
    ['Check ok: 24 monitors up', 'Scrape finished in 85ms', 'Alert resolved'],
  ],
];

function linesFor(name: string): string[] {
  for (const [re, lines] of TEMPLATES) if (re.test(name)) return lines;
  return ['GET / 200 4ms', 'GET /api/health 200 1ms', 'Background job finished in 230ms'];
}

interface Ev {
  t: string;
  m: string;
  rm: string;
  ts: number;
  id: number;
  l: string;
  s: string;
}

function makeLine(name: string, i: number, ts: number): Ev {
  const templates = linesFor(name);
  let text = templates[i % templates.length]!.replace('%s', name).replace(
    '%h',
    `${name}.home.example`,
  );
  let level = 'info';
  if (i % 11 === 7) level = 'warn';
  if (i % 17 === 13) {
    level = 'error';
    text = `Request to upstream failed: timeout after 5000ms (attempt ${1 + (i % 3)})`;
  }
  // Shows redaction working: the key never reaches the browser.
  if (i % 9 === 4) text = `GET /api/v3/queue?apikey=${FAKE_KEY}&page=1 200 6ms`;
  return {
    t: 'single',
    m: text,
    rm: text,
    ts,
    id: i,
    l: level,
    s: level === 'error' ? 'stderr' : 'stdout',
  };
}

export async function startDozzleMock(
  containers: readonly MockContainer[],
  options: DozzleMockOptions = {},
  port = 0,
): Promise<{ url: string; close: () => Promise<void> }> {
  const now = options.now ?? Date.now;
  const hosts = [...new Set(containers.map((c) => c.host))].map((name, i) => ({
    name,
    id: `host-${i + 1}`,
    available: true,
  }));
  const hostId = (name: string) => hosts.find((h) => h.name === name)!.id;
  const list = containers.map((c, i) => ({
    id: `c${String(i).padStart(3, '0')}`,
    name: c.name,
    host: hostId(c.host),
    state: 'running',
  }));
  const byTarget = new Map(list.map((c) => [`${c.host}/${c.id}`, c.name]));

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    if (url.pathname === '/') {
      const config = JSON.stringify({ hosts });
      res.end(`<html><script type="application/json" id="config__json">${config}</script></html>`);
      return;
    }
    if (url.pathname === '/api/events/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`event: containers-changed\ndata: ${JSON.stringify(list)}\n\n`);
      return; // stays open, like Dozzle
    }
    if (url.pathname === '/api/containers/logs' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      const params = new URLSearchParams(body);
      const name = byTarget.get(params.get('container') ?? '') ?? 'app';
      const count = Math.min(Number(params.get('min') ?? 100), 60);
      const end = now();
      const out = Array.from({ length: count }, (_, i) =>
        JSON.stringify(makeLine(name, i, end - (count - i) * 7_000)),
      );
      res.writeHead(200, { 'Content-Type': 'application/x-jsonl' }).end(`${out.join('\n')}\n`);
      return;
    }
    if (url.pathname === '/api/containers/logs/stream') {
      const name = byTarget.get(url.searchParams.get('container') ?? '') ?? 'app';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': connected\n\n');
      if (options.live === false) return;
      let i = 100;
      const timer = setInterval(() => {
        res.write(`data: ${JSON.stringify(makeLine(name, i++, now()))}\n\n`);
      }, 1_000);
      req.on('close', () => clearInterval(timer));
      return;
    }
    res.writeHead(404).end('not found');
  };

  const server: Server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const { port: bound } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${bound}/`,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
