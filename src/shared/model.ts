/** Types of the API payloads shared by server and client. */
import type {
  Backup,
  HistoryEntry,
  Job,
  Meta,
  Monitor,
  Network,
  OpenQuestion,
  Policy,
  Procedure,
  Route,
  SectionKey,
  Service,
  SystemNode,
  Zone,
} from './schema.js';

/** Singular entity kind for each top-level section. */
export const SECTION_KIND = {
  policies: 'policy',
  procedures: 'procedure',
  zones: 'zone',
  networks: 'network',
  nodes: 'node',
  services: 'service',
  routes: 'route',
  monitors: 'monitor',
  jobs: 'job',
  backups: 'backup',
  history: 'history',
  open_questions: 'question',
} as const satisfies Record<SectionKey, string>;

export type EntityKind = (typeof SECTION_KIND)[SectionKey];

/** Section names in display order. Kept here (not in schema.ts) so the client does not bundle zod. */
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

export interface Edge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
  /** Purpose, protocol, or mount path, when known. */
  label?: string;
}

export type ProblemCode =
  'yaml' | 'file' | 'schema' | 'unknown-key' | 'duplicate-id' | 'dangling-ref' | 'merge-conflict';

export interface Problem {
  severity: 'error' | 'warning';
  code: ProblemCode;
  message: string;
  file?: string;
  line?: number;
  /** Path inside the merged model, e.g. `services[3].ports[0].port`. */
  path?: string;
  entity?: string;
}

export interface SourceRef {
  file: string;
  line: number;
  /** The entity's YAML text as written in the file. */
  raw: string;
}

export interface SystemModel {
  version: 1;
  meta: Meta;
  policies: Policy[];
  procedures: Procedure[];
  zones: Zone[];
  networks: Network[];
  nodes: SystemNode[];
  services: Service[];
  routes: Route[];
  monitors: Monitor[];
  jobs: Job[];
  backups: Backup[];
  history: HistoryEntry[];
  open_questions: OpenQuestion[];
  /** Relationships derived from references. */
  edges: Edge[];
  problems: Problem[];
  /** Where each entity is defined, keyed by id. */
  sources: Record<string, SourceRef>;
  files: string[];
  loadedAt: string;
  /**
   * True when the current files could not be parsed and this is the last good model.
   * The parse errors are in `problems`.
   */
  stale: boolean;
}

export type HealthStatus = 'up' | 'down' | 'pending' | 'maintenance' | 'unknown';

export interface MonitorHealth {
  status: HealthStatus;
  name: string;
  msg?: string;
  ping?: number;
}

/**
 * `/api/health` body: monitor health keyed by Uptime Kuma monitor id (`kuma_id`, as a
 * string), plus an `error` string when Kuma could not be read. Monitor ids are numeric,
 * so they never collide with `error`.
 */
export type HealthResponse = { error?: string } & Record<string, MonitorHealth | string>;

export interface WhoAmI {
  user?: string;
  name?: string;
}
