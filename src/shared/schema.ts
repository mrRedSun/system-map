/**
 * System Map data contract (v1), as Effect Schemas.
 *
 * One definition, built in two modes:
 * - `loose`: unknown keys are kept. Used to accept data and to type the model.
 * - `strict`: plain structs, decoded with `onExcessProperty: "error"` only to report unknown
 *   keys as warnings. Also the source of the published JSON Schema (structs stay open there).
 */
import { Schema } from 'effect';
import { STACK_COLORS } from './constants.js';

export {
  CALL_KINDS,
  EXPOSURES,
  NODE_KINDS,
  PORT_AUTH,
  ROUTE_AUTH,
  ROUTE_VIA,
  SERVICE_AUTH,
  SERVICE_KINDS,
  STATUSES,
} from './constants.js';
import {
  CALL_KINDS,
  EXPOSURES,
  NODE_KINDS,
  PORT_AUTH,
  ROUTE_AUTH,
  ROUTE_VIA,
  SERVICE_AUTH,
  SERVICE_KINDS,
  STATUSES,
} from './constants.js';

export const ID_PATTERN = '^[a-z0-9]+(?:-[a-z0-9]+)*$';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/u;

export type SchemaMode = 'strict' | 'loose';

/** Unknown keys of a loose struct. */
const Rest = Schema.Record(Schema.String, Schema.Unknown);

const isHttpUrl = (s: string) => {
  if (!URL.canParse(s)) return false;
  const { protocol } = new URL(s);
  return protocol === 'http:' || protocol === 'https:';
};

export function buildSchemas(mode: SchemaMode) {
  // Both modes share one static type (the loose one); only runtime behaviour differs.
  const obj = <F extends Schema.Struct.Fields>(fields: F) =>
    (mode === 'strict'
      ? Schema.Struct(fields)
      : Schema.StructWithRest(Schema.Struct(fields), [Rest])) as unknown as Schema.StructWithRest<
      Schema.Struct<F>,
      readonly [typeof Rest]
    >;
  const opt = Schema.optionalKey;

  const str = Schema.String;
  const md = Schema.String.annotate({ description: 'Markdown' });
  const pattern = (re: RegExp, message: string) =>
    Schema.String.check(Schema.isPattern(re, { message }));
  const id = pattern(new RegExp(ID_PATTERN, 'u'), 'must be kebab-case (a-z, 0-9, -)');
  const nonEmpty = Schema.String.check(Schema.isMinLength(1));
  const ref = nonEmpty.annotate({ description: 'Entity id' });
  const refs = Schema.Array(ref);
  const date = pattern(DATE_PATTERN, 'must be a YYYY-MM-DD date');
  const isoDate = pattern(ISO_DATE_PATTERN, 'must be an ISO date');
  const httpUrl = Schema.String.check(
    Schema.makeFilter(isHttpUrl, {
      message: 'must be an http(s) URL',
      toJsonSchema: () => ({ format: 'uri' }),
    }),
  );
  const int = Schema.Int;
  const num = Schema.Finite;
  const bool = Schema.Boolean;
  const portNumber = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65535 }));
  const portSpec = Schema.Union([
    portNumber,
    pattern(/^\d{1,5}(?:-\d{1,5})?$/u, 'must be a port or range'),
  ]);
  const status = Schema.Literals(STATUSES);
  const stringMap = Schema.Record(Schema.String, Schema.String);
  const secrets = Schema.Array(obj({ path: str, purpose: opt(str) })).annotate({
    description: 'Secret locations only, never values',
  });

  const base = {
    id,
    name: opt(str),
    description: opt(str),
    notes: opt(md),
    tags: opt(Schema.Array(str)),
    links: opt(Schema.Array(obj({ label: opt(str), url: httpUrl }))),
  };

  const meta = obj({
    title: opt(str),
    owner: opt(str),
    domain: opt(str),
    timezone: opt(str),
    updated: opt(isoDate),
    description: opt(str),
    conventions: opt(
      Schema.String.annotate({ description: 'Markdown: conventions for editing this data' }),
    ),
  });

  const policy = obj({
    ...base,
    title: str,
    rule: md,
    why: opt(md),
    since: opt(date),
    scope: opt(refs),
  });

  const procedure = obj({ ...base, title: str, applies_to: opt(refs), body: md });

  const zone = obj({
    ...base,
    domain: str,
    provider: opt(str),
    plan: opt(str),
    records: opt(Schema.Array(obj({ name: str, type: str, value: opt(str), proxied: opt(bool) }))),
    settings: opt(Schema.Record(Schema.String, Schema.Union([str, num, bool]))),
    rules: opt(
      Schema.Array(obj({ kind: opt(str), expression: opt(str), action: opt(str), note: opt(str) })),
    ),
    workers: opt(Schema.Array(obj({ route: opt(str), script: opt(str), purpose: opt(str) }))),
  });

  const network = obj({
    ...base,
    cidr: opt(str),
    gateway: opt(str),
    dns: opt(Schema.Array(str)),
    dhcp: opt(Schema.Union([bool, str])),
    vlan: opt(int),
  });

  const firewallRule = obj({
    action: opt(str),
    direction: opt(str),
    source: opt(str),
    dest: opt(str),
    proto: opt(str),
    port: opt(Schema.Union([portNumber, str])),
    comment: opt(str),
  });

  const summary = Schema.String.annotate({
    description: 'One or two plain-language sentences: what it is for (shown in the wiki)',
  });

  const node = obj({
    ...base,
    summary: opt(summary),
    kind: Schema.Literals(NODE_KINDS),
    parent: opt(ref),
    vmid: opt(int),
    status: opt(status),
    os: opt(str),
    hostname: opt(str),
    ips: opt(Schema.Array(str)),
    mac: opt(str),
    network: opt(ref),
    resources: opt(
      obj({
        cores: opt(num),
        memory_mib: opt(int),
        swap_mib: opt(int),
        disk_gib: opt(num),
        disk_storage: opt(str),
      }),
    ),
    privileged: opt(bool),
    autostart: opt(bool),
    features: opt(Schema.Array(str)),
    mounts: opt(
      Schema.Array(
        obj({
          source: opt(str),
          target: opt(str),
          readonly: opt(bool),
          backup: opt(bool),
          purpose: opt(str),
          storage: opt(ref),
        }),
      ),
    ),
    devices: opt(Schema.Array(obj({ source: opt(str), target: opt(str), purpose: opt(str) }))),
    backup: opt(obj({ included: opt(bool), job: opt(str), notes: opt(md) })),
    firewall: opt(
      obj({
        enabled: opt(bool),
        nic_flag: opt(bool),
        policy_in: opt(str),
        policy_out: opt(str),
        rules: opt(Schema.Array(firewallRule)),
        file: opt(str),
        notes: opt(md),
      }),
    ),
    update: opt(obj({ command: opt(str), source: opt(str), notes: opt(md) })),
    hardware: opt(
      obj({
        cpu: opt(str),
        ram: opt(str),
        disks: opt(
          Schema.Array(obj({ device: opt(str), model: opt(str), size: opt(str), role: opt(str) })),
        ),
      }),
    ),
    paths: opt(stringMap),
    secrets: opt(secrets),
  });

  const service = obj({
    ...base,
    summary: opt(summary),
    name: str,
    node: ref,
    kind: Schema.Literals(SERVICE_KINDS),
    status: opt(status),
    image: opt(str),
    version: opt(Schema.Union([str, num])),
    pin: opt(str),
    ports: opt(
      Schema.Array(
        obj({
          port: portSpec,
          proto: opt(Schema.Literals(['tcp', 'udp'])),
          bind: opt(str),
          auth: opt(Schema.Literals(PORT_AUTH)),
          exposure: opt(Schema.Literals(EXPOSURES)),
          purpose: opt(str),
        }),
      ),
    ),
    urls: opt(Schema.Array(obj({ label: opt(str), url: httpUrl, internal: opt(bool) }))),
    auth: opt(Schema.Literals(SERVICE_AUTH)),
    stack: opt(ref.annotate({ description: 'Stack id (`stacks[].id`), groups apps in the graph' })),
    calls: opt(
      Schema.Array(
        obj({
          target: nonEmpty.annotate({ description: 'Entity id or an external label' }),
          via: opt(str),
          port: opt(portSpec),
          purpose: opt(str),
          kind: opt(
            Schema.Literals(CALL_KINDS).annotate({
              description:
                'use (default) or observe: a dashboard or monitor reading the target; drawn faint and ignored for layout',
            }),
          ),
        }),
      ),
    ),
    health: opt(obj({ kuma: opt(refs), push: opt(bool) })),
    logs: opt(
      obj({
        dozzle: opt(
          obj({
            host: nonEmpty.annotate({ description: 'Dozzle agent/host name' }),
            container: nonEmpty.annotate({ description: 'Container name' }),
          }),
        ),
      }),
    ),
    paths: opt(stringMap),
    secrets: opt(secrets),
    schedule: opt(str),
    backup: opt(obj({ how: opt(str), where: opt(str) })),
    update: opt(obj({ command: opt(str), notes: opt(md) })),
  });

  const stack = obj({
    ...base,
    summary: opt(summary),
    description: opt(
      Schema.String.annotate({ description: 'Markdown: how the stack works, end to end' }),
    ),
    color: opt(Schema.Literals(STACK_COLORS).annotate({ description: 'Tint of the group box' })),
    order: opt(int.annotate({ description: 'Sort key for stacks; lower first, then file order' })),
  });

  const route = obj({
    ...base,
    host: nonEmpty,
    paths: opt(
      Schema.Array(str).annotate({
        description: 'Path prefixes or Traefik rule strings, e.g. HostRegexp(...)',
      }),
    ),
    via: Schema.Literals(ROUTE_VIA),
    target: ref,
    upstream: opt(str),
    auth: opt(Schema.Literals(ROUTE_AUTH)),
    middlewares: opt(Schema.Array(str)),
  });

  const monitor = obj({
    ...base,
    kuma_id: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    name: str,
    type: opt(str),
    target: opt(str),
    service: opt(ref),
    node: opt(
      ref.annotate({ description: 'Node id, for host ping monitors (instead of service)' }),
    ),
    group: opt(str),
    active: opt(bool.annotate({ description: 'Defaults to true' })),
    interval_s: opt(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  }).check(
    Schema.makeFilter(
      (m: { service?: string; node?: string }) =>
        m.service === undefined || m.node === undefined
          ? undefined
          : { path: ['node'], issue: 'set either `service` or `node`, not both' },
      { toJsonSchema: () => ({ not: { required: ['service', 'node'] } }) },
    ),
  );

  const job = obj({
    ...base,
    node: ref,
    schedule: nonEmpty,
    command: opt(str),
    source: opt(str),
    purpose: opt(str),
    notifies: opt(Schema.Union([bool, str])),
  });

  const backup = obj({
    ...base,
    what: nonEmpty,
    from: opt(refs),
    to: nonEmpty,
    schedule: opt(str),
    retention: opt(str),
    offsite: opt(bool),
    encrypted: opt(bool),
    restore: opt(md),
  });

  const history = obj({
    ...base,
    date,
    title: str,
    summary: opt(md),
    refs: opt(refs),
    rollback: opt(md),
  });

  const openQuestion = obj({ ...base, question: nonEmpty, refs: opt(refs) });

  const article = obj({
    ...base,
    title: nonEmpty,
    order: opt(int.annotate({ description: 'Sort key; lower first, then file order' })),
    refs: opt(refs.annotate({ description: 'Entities the article is about' })),
    body: md.annotate({ description: 'Markdown; `[[id]]` links to an entity' }),
  });

  const sections = {
    policies: policy,
    procedures: procedure,
    zones: zone,
    networks: network,
    nodes: node,
    services: service,
    stacks: stack,
    routes: route,
    monitors: monitor,
    jobs: job,
    backups: backup,
    history,
    open_questions: openQuestion,
    articles: article,
  };

  /** Shape of one data file. One file (normally the one with `meta`) declares `version: 1`. */
  const file = obj({
    version: opt(
      Schema.Literal(1).annotate({
        description: 'Required in at least one file (normally the one with meta)',
      }),
    ),
    meta: opt(meta),
    policies: opt(Schema.Array(policy)),
    procedures: opt(Schema.Array(procedure)),
    zones: opt(Schema.Array(zone)),
    networks: opt(Schema.Array(network)),
    nodes: opt(Schema.Array(node)),
    services: opt(Schema.Array(service)),
    stacks: opt(Schema.Array(stack)),
    routes: opt(Schema.Array(route)),
    monitors: opt(Schema.Array(monitor)),
    jobs: opt(Schema.Array(job)),
    backups: opt(Schema.Array(backup)),
    history: opt(Schema.Array(history)),
    open_questions: opt(Schema.Array(openQuestion)),
    articles: opt(Schema.Array(article)),
  });

  return { meta, sections, file };
}

export const looseSchemas = buildSchemas('loose');
export const strictSchemas = buildSchemas('strict');

type Sections = typeof looseSchemas.sections;
export type SectionKey = keyof Sections;
export const SECTION_KEYS = Object.keys(looseSchemas.sections) as SectionKey[];

export type Meta = typeof looseSchemas.meta.Type;
export type Policy = Sections['policies']['Type'];
export type Procedure = Sections['procedures']['Type'];
export type Zone = Sections['zones']['Type'];
export type Network = Sections['networks']['Type'];
export type SystemNode = Sections['nodes']['Type'];
export type Service = Sections['services']['Type'];
export type Stack = Sections['stacks']['Type'];
export type Route = Sections['routes']['Type'];
export type Monitor = Sections['monitors']['Type'];
export type Job = Sections['jobs']['Type'];
export type Backup = Sections['backups']['Type'];
export type HistoryEntry = Sections['history']['Type'];
export type OpenQuestion = Sections['open_questions']['Type'];
export type Article = Sections['articles']['Type'];
export type SectionItem<K extends SectionKey> = Sections[K]['Type'];
export type AnyEntity = SectionItem<SectionKey>;

export const SCHEMA_ID =
  'https://github.com/mrRedSun/system-map/blob/main/schema/system-map.schema.json';

/** The published JSON Schema (draft 2020-12) of one data file; open to unknown keys. */
export function toJsonSchema(): Record<string, unknown> {
  const doc = Schema.toJsonSchemaDocument(strictSchemas.file);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...doc.schema,
    ...(Object.keys(doc.definitions).length > 0 ? { $defs: doc.definitions } : {}),
    $id: SCHEMA_ID,
    title: 'System Map data file (v1)',
  };
}
