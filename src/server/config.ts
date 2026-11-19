import { z } from 'zod';

export interface Config {
  /** Directory with the `*.yaml` data files. Read-only. */
  dataDir: string;
  port: number;
  /** Uptime Kuma base URL; health is disabled when unset. */
  kumaUrl?: URL;
  /** File holding the Kuma API key; when unset, `/metrics` is fetched without auth. */
  kumaApiKeyFile?: string;
  /** Dozzle hub base URL; logs are disabled when unset. */
  dozzleUrl?: URL;
  /** Directory with the built SPA. */
  publicDir: string;
}

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const httpUrl = z.preprocess(
  emptyToUndefined,
  z
    .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
    .transform((u) => new URL(u.endsWith('/') ? u : `${u}/`))
    .optional(),
);
const path = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const EnvSchema = z.object({
  DATA_DIR: z.preprocess(emptyToUndefined, z.string().min(1).default('/data')),
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).default(8080)),
  KUMA_URL: httpUrl,
  KUMA_API_KEY_FILE: path,
  DOZZLE_URL: httpUrl,
  PUBLIC_DIR: path,
});

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv, defaultPublicDir: string): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    dataDir: e.DATA_DIR,
    port: e.PORT,
    kumaUrl: e.KUMA_URL,
    kumaApiKeyFile: e.KUMA_API_KEY_FILE,
    dozzleUrl: e.DOZZLE_URL,
    publicDir: e.PUBLIC_DIR ?? defaultPublicDir,
  };
}
