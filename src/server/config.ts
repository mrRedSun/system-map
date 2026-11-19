/** Runtime configuration from the environment, validated once at startup. */
import { Context, Effect, Layer, Option, Schema } from 'effect';
import { LOG_LEVELS, type AppLogLevel } from './logging.js';

export interface Config {
  /** Directory with the `*.yaml` data files. Read-only. */
  readonly dataDir: string;
  readonly port: number;
  /** Uptime Kuma base URL; health is disabled when unset. */
  readonly kumaUrl: Option.Option<URL>;
  /** File holding the Kuma API key; when unset, `/metrics` is fetched without auth. */
  readonly kumaApiKeyFile: Option.Option<string>;
  /** Dozzle hub base URL; logs are disabled when unset. */
  readonly dozzleUrl: Option.Option<URL>;
  /** Directory with the built SPA. */
  readonly publicDir: string;
  readonly logLevel: AppLogLevel;
}

export class AppConfig extends Context.Service<AppConfig, Config>()('system-map/AppConfig') {}

export class ConfigError extends Schema.TaggedError<ConfigError>()('ConfigError', {
  message: Schema.String,
}) {}

const blankToUndefined = (v: string | undefined) =>
  v === undefined || v.trim() === '' ? undefined : v;

const isHttpUrl = (v: string) => URL.canParse(v) && /^https?:$/.test(new URL(v).protocol);

/** Parse the environment; every problem is reported at once. */
export function parseEnv(
  env: Readonly<Record<string, string | undefined>>,
  defaultPublicDir: string,
): Effect.Effect<Config, ConfigError> {
  const issues: string[] = [];
  const url = (key: string): Option.Option<URL> => {
    const v = blankToUndefined(env[key]);
    if (v === undefined) return Option.none();
    if (!isHttpUrl(v)) {
      issues.push(`  ${key}: must be an http(s) URL`);
      return Option.none();
    }
    return Option.some(new URL(v.endsWith('/') ? v : `${v}/`));
  };
  const portRaw = blankToUndefined(env.PORT);
  const port = portRaw === undefined ? 8080 : Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push('  PORT: must be an integer from 1 to 65535');
  }
  const logLevel = blankToUndefined(env.LOG_LEVEL) ?? 'info';
  if (!(LOG_LEVELS as readonly string[]).includes(logLevel)) {
    issues.push(`  LOG_LEVEL: ${JSON.stringify(logLevel)} is not one of info, warn, error`);
  }
  const config: Config = {
    dataDir: blankToUndefined(env.DATA_DIR) ?? '/data',
    port,
    kumaUrl: url('KUMA_URL'),
    kumaApiKeyFile: Option.fromNullishOr(blankToUndefined(env.KUMA_API_KEY_FILE)),
    dozzleUrl: url('DOZZLE_URL'),
    publicDir: blankToUndefined(env.PUBLIC_DIR) ?? defaultPublicDir,
    logLevel: logLevel as AppLogLevel,
  };
  return issues.length > 0
    ? Effect.fail(new ConfigError({ message: `Invalid configuration:\n${issues.join('\n')}` }))
    : Effect.succeed(config);
}

export const layer = (config: Config) => Layer.succeed(AppConfig, config);

/** The log level to start with; an invalid value is reported by `parseEnv`. */
export const logLevelFromEnv = (env: Readonly<Record<string, string | undefined>>): AppLogLevel => {
  const v = blankToUndefined(env.LOG_LEVEL);
  return (LOG_LEVELS as readonly string[]).includes(v ?? '') ? (v as AppLogLevel) : 'info';
};
