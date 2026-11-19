/** Schemas and types of the API payloads shared by server and client. */
import { Schema } from 'effect';
import { looseSchemas, type SectionKey } from './schema.js';

export { STACK_COLORS } from './constants.js';

/** Singular entity kind for each top-level section. */
export const SECTION_KIND = {
  policies: 'policy',
  procedures: 'procedure',
  zones: 'zone',
  networks: 'network',
  nodes: 'node',
  services: 'service',
  stacks: 'stack',
  routes: 'route',
  monitors: 'monitor',
  jobs: 'job',
  backups: 'backup',
  history: 'history',
  open_questions: 'question',
} as const satisfies Record<SectionKey, string>;

export type EntityKind = (typeof SECTION_KIND)[SectionKey];

/** Section names in display order. */
export const SECTIONS = Object.keys(SECTION_KIND) as SectionKey[];

export const EDGE_KINDS = [
  'contains',
  'runs-on',
  'calls',
  'routes-to',
  'mounts',
  'monitors',
  'backs-up',
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const Edge = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(EDGE_KINDS),
  source: Schema.String,
  target: Schema.String,
  /** Purpose, protocol, or mount path, when known. */
  label: Schema.optionalKey(Schema.String),
});
export type Edge = typeof Edge.Type;

export const PROBLEM_CODES = [
  'yaml',
  'file',
  'schema',
  'unknown-key',
  'duplicate-id',
  'dangling-ref',
  'merge-conflict',
] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number];

export const Problem = Schema.Struct({
  severity: Schema.Literals(['error', 'warning']),
  code: Schema.Literals(PROBLEM_CODES),
  message: Schema.String,
  file: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Number),
  /** Path inside the merged model, e.g. `services[3].ports[0].port`. */
  path: Schema.optionalKey(Schema.String),
  entity: Schema.optionalKey(Schema.String),
});
export type Problem = typeof Problem.Type;

export const SourceRef = Schema.Struct({
  file: Schema.String,
  line: Schema.Number,
  /** The entity's YAML text as written in the file. */
  raw: Schema.String,
});
export type SourceRef = typeof SourceRef.Type;

const s = looseSchemas.sections;
export const SystemModel = Schema.Struct({
  version: Schema.Literal(1),
  meta: looseSchemas.meta,
  policies: Schema.Array(s.policies),
  procedures: Schema.Array(s.procedures),
  zones: Schema.Array(s.zones),
  networks: Schema.Array(s.networks),
  nodes: Schema.Array(s.nodes),
  services: Schema.Array(s.services),
  stacks: Schema.Array(s.stacks),
  routes: Schema.Array(s.routes),
  monitors: Schema.Array(s.monitors),
  jobs: Schema.Array(s.jobs),
  backups: Schema.Array(s.backups),
  history: Schema.Array(s.history),
  open_questions: Schema.Array(s.open_questions),
  /** Relationships derived from references. */
  edges: Schema.Array(Edge),
  problems: Schema.Array(Problem),
  /** Where each entity is defined, keyed by id. */
  sources: Schema.Record(Schema.String, SourceRef),
  files: Schema.Array(Schema.String),
  loadedAt: Schema.String,
  /**
   * True when the current files could not be parsed and this is the last good model.
   * The parse errors are in `problems`.
   */
  stale: Schema.Boolean,
});
export type SystemModel = typeof SystemModel.Type;

export const HEALTH_STATUSES = ['up', 'down', 'pending', 'maintenance', 'unknown'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const MonitorHealth = Schema.Struct({
  status: Schema.Literals(HEALTH_STATUSES),
  name: Schema.String,
  msg: Schema.optionalKey(Schema.String),
  /** Last response time in ms. */
  ping: Schema.optionalKey(Schema.Number),
  /** Uptime ratio (0 to 1) per window, e.g. `{ "1d": 0.998 }` (Kuma 2.x). */
  uptime: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
});
export type MonitorHealth = typeof MonitorHealth.Type;

/**
 * `/api/health` body: monitor health keyed by Uptime Kuma monitor id (`kuma_id`, as a
 * string), plus an `error` string when Kuma could not be read. Monitor ids are numeric,
 * so they never collide with `error`.
 */
export const HealthResponse = Schema.Record(
  Schema.String,
  Schema.Union([MonitorHealth, Schema.String]),
);
export type HealthResponse = { readonly error?: string } & {
  readonly [id: string]: MonitorHealth | string;
};

export const WhoAmI = Schema.Struct({
  user: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
});
export type WhoAmI = typeof WhoAmI.Type;

/** `/api/events` SSE `model` event data. */
export const ModelChanged = Schema.Struct({ etag: Schema.String });

/** `/api/logs` SSE events: `line`, `dropped`, `status`, `error`, `end`. */
export const LogLine = Schema.Struct({
  ts: Schema.Number,
  level: Schema.String,
  stream: Schema.String,
  text: Schema.String,
});
export type LogLine = typeof LogLine.Type;
export const LogDropped = Schema.Struct({ count: Schema.Number });
export const LogMessage = Schema.Struct({ message: Schema.String });

/** Error body of the JSON API. */
export const ApiErrorBody = Schema.Struct({ error: Schema.String });
