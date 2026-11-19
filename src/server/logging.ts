/**
 * JSON-lines logging through Effect's Logger: one object per line with `time`, `level`, `msg`
 * and the log annotations as fields. Info goes to stdout, warnings and errors to stderr.
 * Never annotate logs with request headers or user data.
 */
import { Cause, Layer, Logger, References } from 'effect';

export const LOG_LEVELS = ['info', 'warn', 'error'] as const;
export type AppLogLevel = (typeof LOG_LEVELS)[number];

const MINIMUM: Record<AppLogLevel, 'Info' | 'Warn' | 'Error'> = {
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
};

const levelName = (level: string): string =>
  level === 'Warn' ? 'warn' : level === 'Error' || level === 'Fatal' ? 'error' : 'info';

export interface LogSink {
  out(line: string): void;
  err(line: string): void;
}

const processSink: LogSink = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

export const jsonLogger = (sink: LogSink = processSink) =>
  Logger.make(({ message, logLevel, date, fiber, cause }) => {
    const parts = Array.isArray(message) ? message : [message];
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fiber.getRef(References.CurrentLogAnnotations))) {
      fields[k] = v;
    }
    if (cause.reasons.length > 0) fields.cause = Cause.pretty(cause);
    const level = levelName(logLevel);
    const line = JSON.stringify({
      time: date.toISOString(),
      level,
      msg: parts.map(String).join(' '),
      ...fields,
    });
    if (level === 'info') sink.out(line);
    else sink.err(line);
  });

/** Replaces the default logger and sets the minimum level. */
export const layer = (level: AppLogLevel, sink?: LogSink) =>
  Layer.mergeAll(
    Logger.layer([jsonLogger(sink)]),
    Layer.succeed(References.MinimumLogLevel, MINIMUM[level]),
  );

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
