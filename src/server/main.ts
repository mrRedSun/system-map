import { statSync } from 'node:fs';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { errorMessage, log } from './log.js';
import { ModelStore } from './store.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function configure(): Config {
  try {
    const config = loadConfig(process.env, fileURLToPath(new URL('./public', import.meta.url)));
    if (!statSync(config.dataDir, { throwIfNoEntry: false })?.isDirectory()) {
      throw new ConfigError(`DATA_DIR ${config.dataDir} is not a readable directory`);
    }
    return config;
  } catch (err) {
    log.error(errorMessage(err));
    process.exit(2);
  }
}

async function main() {
  const config = configure();
  const store = new ModelStore(config.dataDir);
  await store.reload();
  store.watch();

  const shutdown = new AbortController();
  const app = createApp({ store, publicDir: config.publicDir, shutdown: shutdown.signal });
  const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) =>
    log.info('listening', {
      port: info.port,
      dataDir: config.dataDir,
      kuma: Boolean(config.kumaUrl),
      dozzle: Boolean(config.dozzleUrl),
    }),
  );
  const http = server as Server;
  http.headersTimeout = 15_000;
  http.requestTimeout = 0; // SSE streams are long-lived.
  http.keepAliveTimeout = 5_000;

  const stop = (signal: string) => {
    log.info('shutting down', { signal });
    shutdown.abort();
    store.close();
    const force = setTimeout(() => {
      log.warn('forced exit after shutdown timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();
    server.close(() => process.exit(0));
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}

void main();
