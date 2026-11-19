/**
 * Mock Uptime Kuma: serves `/metrics` in Kuma 2.x Prometheus format for the given monitors.
 * Development and screenshots only; never used by the app itself.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockMonitor {
  kumaId: number;
  name: string;
  status: 'up' | 'down' | 'pending' | 'maintenance';
}

const STATUS = { down: 0, up: 1, pending: 2, maintenance: 3 } as const;
const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

export function kumaMetrics(monitors: readonly MockMonitor[]): string {
  const lines = [
    '# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)',
    '# TYPE monitor_status gauge',
  ];
  for (const m of monitors) {
    const labels = `monitor_id="${m.kumaId}",monitor_name="${escape(m.name)}",monitor_type="http"`;
    lines.push(`monitor_status{${labels}} ${STATUS[m.status]}`);
    if (m.status !== 'down')
      lines.push(`monitor_response_time{${labels}} ${18 + ((m.kumaId * 37) % 140)}`);
    const day = m.status === 'down' ? 0.912 : (9985 - (m.kumaId % 4) * 7) / 10_000;
    lines.push(`monitor_uptime_ratio{${labels},window="1d"} ${day}`);
    lines.push(`monitor_uptime_ratio{${labels},window="30d"} ${((day + 0.9995) / 2).toFixed(4)}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function startKumaMock(
  monitors: readonly MockMonitor[],
  port = 0,
): Promise<{ url: string; close: () => Promise<void> }> {
  const body = kumaMetrics(monitors);
  const server: Server = createServer((req, res) => {
    if (req.url !== '/metrics') return void res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(body);
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const { port: bound } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${bound}/`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
