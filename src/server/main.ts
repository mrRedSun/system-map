/**
 * Server entrypoint: validate configuration, load the model, serve. On SIGTERM/SIGINT the
 * long-lived streams end first, then the HTTP server drains (bounded) and the process exits.
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { NodeHttpServer, NodeRuntime, NodeServices } from '@effect/platform-node';
import { Deferred, Effect, Fiber, FileSystem, Layer, Option, Runtime } from 'effect';
import { FetchHttpClient, HttpRouter } from 'effect/http';
import * as Config from './config.js';
import { Logs } from './dozzle.js';
import * as Http from './http.js';
import { Health } from './kuma.js';
import * as Logging from './logging.js';
import { DataSource, DataStore } from './store.js';

const SHUTDOWN_TIMEOUT = '10 seconds';

const configure = Effect.gen(function* () {
  const config = yield* Config.parseEnv(
    process.env,
    fileURLToPath(new URL('./public', import.meta.url)),
  );
  const fs = yield* FileSystem.FileSystem;
  const info = yield* Effect.option(fs.stat(config.dataDir));
  if (Option.isNone(info) || info.value.type !== 'Directory') {
    return yield* new Config.ConfigError({
      message: `DATA_DIR ${config.dataDir} is not a readable directory`,
    });
  }
  return config;
}).pipe(
  Effect.catchTag('ConfigError', (err) =>
    Effect.logError(err.message).pipe(
      Effect.andThen(Effect.sync(() => process.exit(2))),
      Effect.andThen(Effect.never),
    ),
  ),
  Effect.provide([NodeServices.layer, Logging.layer('info')]),
);

const app = (config: Config.Config, shutdown: Deferred.Deferred<void>) => {
  const store = DataStore.layer().pipe(Layer.provide(DataSource.layer()));
  const services = Layer.mergeAll(Health.layer, Logs.layer).pipe(Layer.provideMerge(store));
  const listening = Layer.effectDiscard(
    Effect.logInfo('listening').pipe(
      Effect.annotateLogs({
        port: config.port,
        dataDir: config.dataDir,
        kuma: Option.isSome(config.kumaUrl),
        dozzle: Option.isSome(config.dozzleUrl),
      }),
    ),
  );
  const server = NodeHttpServer.layer(
    () => {
      const s = createServer();
      s.headersTimeout = 15_000;
      s.requestTimeout = 0; // SSE streams are long-lived.
      s.keepAliveTimeout = 5_000;
      return s;
    },
    { port: config.port, host: '0.0.0.0', gracefulShutdownTimeout: SHUTDOWN_TIMEOUT },
  );
  return HttpRouter.serve(Http.layer({ publicDir: config.publicDir }), {
    disableLogger: true,
    disableListenLog: true,
  }).pipe(
    Layer.merge(listening),
    Layer.provide(services),
    Layer.provide(Layer.succeed(Http.Shutdown, shutdown)),
    Layer.provide(server),
    Layer.provide([FetchHttpClient.layer, NodeServices.layer, Config.layer(config)]),
  );
};

const main = Effect.gen(function* () {
  const config = yield* configure;
  const shutdown = yield* Deferred.make<void>();
  const running = yield* Effect.forkChild(Layer.launch(app(config, shutdown)));
  yield* Fiber.join(running).pipe(
    Effect.onInterrupt(() =>
      Effect.logInfo('shutting down').pipe(
        // End event and log streams so the server can close its connections promptly.
        Effect.andThen(Deferred.succeed(shutdown, undefined)),
        Effect.andThen(Fiber.interrupt(running)),
      ),
    ),
  );
}).pipe(Effect.provide(Logging.layer(Config.logLevelFromEnv(process.env))));

NodeRuntime.runMain(main, {
  // A shutdown requested by a signal is a clean exit (0), not an interruption (130).
  teardown: (exit, onExit) =>
    Runtime.defaultTeardown(exit, (code) => onExit(code === 130 ? 0 : code)),
});
