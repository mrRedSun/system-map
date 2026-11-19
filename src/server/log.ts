/** Minimal JSON-lines logger. Never pass request headers or user data here. */
type Fields = Record<string, unknown>;
type Level = 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { info: 0, warn: 1, error: 2 };
const configured = process.env.LOG_LEVEL ?? 'info';
if (!(configured in LEVELS)) {
  process.stderr.write(
    `Invalid LOG_LEVEL ${JSON.stringify(configured)}; use info, warn or error\n`,
  );
  process.exit(2);
}
const threshold = LEVELS[configured as Level];

function write(level: Level, msg: string, fields?: Fields) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  (level === 'info' ? process.stdout : process.stderr).write(`${line}\n`);
}

export const log = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
