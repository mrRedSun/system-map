/**
 * `npm run demo`: System Map on the fictional showcase data, with mock Uptime Kuma and Dozzle.
 *
 *   npm run demo                      build, then run the app from dist/
 *   npm run demo -- --no-build        run the existing dist/ build
 *   npm run demo -- --docker [image]  run the published image instead (default :main)
 *   npm run demo -- --port 8080 --data examples/showcase
 *
 * Ctrl-C stops the app and the mocks.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel } from '../src/server/model/build.js';
import { startDozzleMock, type MockContainer } from './mocks/dozzle.js';
import { startKumaMock, type MockMonitor } from './mocks/kuma.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_IMAGE = 'ghcr.io/mrredsun/system-map:main';

export interface DemoOptions {
  dataDir?: string;
  port?: number;
  build?: boolean;
  /** Run this container image instead of the local build. */
  image?: string;
  /** Mock Dozzle appends live lines (off for stable screenshots). */
  liveLogs?: boolean;
  /** Clock for mock log timestamps. */
  now?: () => number;
  quiet?: boolean;
}

export interface Demo {
  url: string;
  stop: () => Promise<void>;
}

/** Monitors and log containers declared in the data, as the mocks need them. */
export function mockInputs(dataDir: string): {
  monitors: MockMonitor[];
  containers: MockContainer[];
} {
  const files = readdirSync(dataDir)
    .filter((n) => n.endsWith('.yaml') && !n.startsWith('.'))
    .sort()
    .map((name) => ({ name, text: readFileSync(resolve(dataDir, name), 'utf8') }));
  const { model } = buildModel(files);
  const active = model.monitors.filter((m) => m.active !== false);
  // Mostly up; one down and one pending, chosen the same way every run so screenshots are
  // repeatable. A device (say, a camera) is the one that is down, when there is one.
  const isDevice = (id: string | undefined) =>
    model.nodes.some((n) => n.id === id && n.kind === 'device');
  const down = (active.find((m) => isDevice(m.node)) ?? active[Math.floor(active.length * 0.45)])
    ?.kuma_id;
  const pending = active[Math.floor(active.length * 0.75)]?.kuma_id;
  const monitors = active.map((m): MockMonitor => ({
    kumaId: m.kuma_id,
    name: m.name,
    status: m.kuma_id === down ? 'down' : m.kuma_id === pending ? 'pending' : 'up',
  }));
  const containers = model.services.flatMap((s) =>
    s.logs?.dozzle ? [{ host: s.logs.dozzle.host, name: s.logs.dozzle.container }] : [],
  );
  return { monitors, containers };
}

async function waitHealthy(url: string, child: ChildProcess | undefined, timeoutMs = 30_000) {
  const start = Date.now();
  for (;;) {
    if (child && child.exitCode !== null) throw new Error(`the app exited (${child.exitCode})`);
    try {
      if ((await fetch(new URL('healthz', url))).ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() - start > timeoutMs) throw new Error('the app did not become healthy');
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function startDemo(o: DemoOptions = {}): Promise<Demo> {
  const dataDir = resolve(ROOT, o.dataDir ?? 'examples/showcase');
  const port = o.port ?? 8080;
  const log = (msg: string) => o.quiet || process.stderr.write(`${msg}\n`);
  const { monitors, containers } = mockInputs(dataDir);
  const kuma = await startKumaMock(monitors);
  const dozzle = await startDozzleMock(containers, { live: o.liveLogs ?? true, now: o.now });
  log(
    `mock Uptime Kuma ${kuma.url} (${monitors.length} monitors), mock Dozzle ${dozzle.url} (${containers.length} containers)`,
  );

  let child: ChildProcess;
  const env = {
    DATA_DIR: dataDir,
    PORT: String(port),
    KUMA_URL: kuma.url,
    DOZZLE_URL: dozzle.url,
    LOG_LEVEL: 'warn',
  };
  if (o.image) {
    // Host networking lets the container reach the mocks on 127.0.0.1.
    child = spawn(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        'host',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '-v',
        `${dataDir}:/data:ro`,
        ...Object.entries({ ...env, DATA_DIR: '/data' }).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
        o.image,
      ],
      { stdio: o.quiet ? 'ignore' : 'inherit' },
    );
  } else {
    if (o.build !== false) {
      log('building…');
      const built = spawnSync('npm', ['run', '--silent', 'build'], {
        cwd: ROOT,
        stdio: o.quiet ? 'ignore' : 'inherit',
      });
      if (built.status !== 0) throw new Error('build failed');
    }
    child = spawn(process.execPath, [resolve(ROOT, 'dist/server.mjs')], {
      env: { ...process.env, ...env },
      stdio: o.quiet ? 'ignore' : 'inherit',
    });
  }

  const url = `http://127.0.0.1:${port}/`;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode === null) {
      const exited = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise((r) => setTimeout(r, 12_000))]);
    }
    await Promise.all([kuma.close(), dozzle.close()]);
  };
  try {
    await waitHealthy(url, child);
  } catch (err) {
    await stop();
    throw err;
  }
  return { url, stop };
}

function parseArgs(argv: string[]): DemoOptions {
  const o: DemoOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-build') o.build = false;
    else if (a === '--docker')
      o.image = argv[i + 1]?.startsWith('-') || !argv[i + 1] ? DEFAULT_IMAGE : argv[++i];
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--data') o.dataDir = argv[++i];
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const demo = await startDemo(parseArgs(process.argv.slice(2)));
  process.stderr.write(`\nSystem Map demo: ${demo.url}  (Ctrl-C to stop)\n`);
  const shutdown = () => void demo.stop().then(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
