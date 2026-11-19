/**
 * System Map data contract (v1).
 *
 * One schema definition, built in two modes:
 * - `loose`: unknown keys are kept. Used to accept data and to publish the JSON Schema.
 * - `strict`: unknown keys fail. Used only to report unknown keys as warnings.
 */
import { z } from 'zod';

export const ID_PATTERN = '^[a-z0-9]+(?:-[a-z0-9]+)*$';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export const STATUSES = ['running', 'stopped', 'deliberately-stopped', 'retired'] as const;
export const NODE_KINDS = [
  'internet',
  'cdn',
  'router',
  'host',
  'vm',
  'lxc',
  'device',
  'external',
  'storage',
  'vpn',
] as const;
export const SERVICE_KINDS = [
  'container',
  'compose',
  'systemd',
  'native',
  'timer',
  'cron',
  'worker',
  'external',
  'vm-app',
] as const;
export const PORT_AUTH = ['none', 'own', 'token', 'authelia', 'mtls', 'key'] as const;
export const EXPOSURES = ['internal', 'lan', 'restricted', 'public'] as const;
export const SERVICE_AUTH = ['authelia', 'own', 'token', 'oidc', 'mtls', 'key', 'none'] as const;
export const ROUTE_VIA = ['traefik', 'cloudflare-worker', 'router-forward', 'plex'] as const;
export const ROUTE_AUTH = ['authelia', 'none', 'app', 'key'] as const;

export type SchemaMode = 'strict' | 'loose';

export function buildSchemas(mode: SchemaMode) {
  // Both modes share one static type (the loose one); only runtime behaviour differs.
  const obj = <S extends z.ZodRawShape>(shape: S) =>
    (mode === 'strict' ? z.strictObject(shape) : z.looseObject(shape)) as unknown as z.ZodObject<
      S,
      z.core.$loose
    >;

  const str = z.string();
  const md = z.string().meta({ description: 'Markdown' });
  const id = z.string().regex(new RegExp(ID_PATTERN), 'must be kebab-case (a-z, 0-9, -)');
  const ref = z.string().min(1).meta({ description: 'Entity id' });
  const refs = z.array(ref);
  const date = z.string().regex(DATE_PATTERN, 'must be a YYYY-MM-DD date');
  const isoDate = z.string().regex(ISO_DATE_PATTERN, 'must be an ISO date');
  const httpUrl = z.url({ protocol: /^https?$/, error: 'must be an http(s) URL' });
  const portNumber = z.int().min(0).max(65535);
  const portSpec = z.union([portNumber, z.string().regex(/^\d{1,5}(?:-\d{1,5})?$/)]);
  const status = z.enum(STATUSES);
  const stringMap = z.record(z.string(), z.string());
  const secrets = z.array(obj({ path: str, purpose: str.optional() })).meta({
    description: 'Secret locations only, never values',
  });

  const base = {
    id,
    name: str.optional(),
    description: str.optional(),
    notes: md.optional(),
    tags: z.array(str).optional(),
    links: z.array(obj({ label: str.optional(), url: httpUrl })).optional(),
  };

  const meta = obj({
    title: str.optional(),
    owner: str.optional(),
    domain: str.optional(),
    timezone: str.optional(),
    updated: isoDate.optional(),
    description: str.optional(),
    conventions: md.optional().meta({ description: 'Markdown: conventions for editing this data' }),
  });

  const policy = obj({
    ...base,
    title: str,
    rule: md,
    why: md.optional(),
    since: date.optional(),
    scope: refs.optional(),
  });

  const procedure = obj({ ...base, title: str, applies_to: refs.optional(), body: md });

  const zone = obj({
    ...base,
    domain: str,
    provider: str.optional(),
    plan: str.optional(),
    records: z
      .array(
        obj({
          name: str,
          type: str,
          value: str.optional(),
          proxied: z.boolean().optional(),
        }),
      )
      .optional(),
    settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    rules: z
      .array(
        obj({
          kind: str.optional(),
          expression: str.optional(),
          action: str.optional(),
          note: str.optional(),
        }),
      )
      .optional(),
    workers: z
      .array(obj({ route: str.optional(), script: str.optional(), purpose: str.optional() }))
      .optional(),
  });

  const network = obj({
    ...base,
    cidr: str.optional(),
    gateway: str.optional(),
    dns: z.array(str).optional(),
    dhcp: z.union([z.boolean(), str]).optional(),
    vlan: z.int().optional(),
  });

  const firewallRule = obj({
    action: str.optional(),
    direction: str.optional(),
    source: str.optional(),
    dest: str.optional(),
    proto: str.optional(),
    port: z.union([portNumber, str]).optional(),
    comment: str.optional(),
  });

  const node = obj({
    ...base,
    kind: z.enum(NODE_KINDS),
    parent: ref.optional(),
    vmid: z.int().optional(),
    status: status.optional(),
    os: str.optional(),
    hostname: str.optional(),
    ips: z.array(str).optional(),
    mac: str.optional(),
    network: ref.optional(),
    resources: obj({
      cores: z.number().optional(),
      memory_mib: z.int().optional(),
      swap_mib: z.int().optional(),
      disk_gib: z.number().optional(),
      disk_storage: str.optional(),
    }).optional(),
    privileged: z.boolean().optional(),
    autostart: z.boolean().optional(),
    features: z.array(str).optional(),
    mounts: z
      .array(
        obj({
          source: str.optional(),
          target: str.optional(),
          readonly: z.boolean().optional(),
          backup: z.boolean().optional(),
          purpose: str.optional(),
          storage: ref.optional(),
        }),
      )
      .optional(),
    devices: z
      .array(obj({ source: str.optional(), target: str.optional(), purpose: str.optional() }))
      .optional(),
    backup: obj({
      included: z.boolean().optional(),
      job: str.optional(),
      notes: md.optional(),
    }).optional(),
    firewall: obj({
      enabled: z.boolean().optional(),
      nic_flag: z.boolean().optional(),
      policy_in: str.optional(),
      policy_out: str.optional(),
      rules: z.array(firewallRule).optional(),
      file: str.optional(),
      notes: md.optional(),
    }).optional(),
    update: obj({
      command: str.optional(),
      source: str.optional(),
      notes: md.optional(),
    }).optional(),
    hardware: obj({
      cpu: str.optional(),
      ram: str.optional(),
      disks: z
        .array(
          obj({
            device: str.optional(),
            model: str.optional(),
            size: str.optional(),
            role: str.optional(),
          }),
        )
        .optional(),
    }).optional(),
    paths: stringMap.optional(),
    secrets: secrets.optional(),
  });

  const service = obj({
    ...base,
    name: str,
    node: ref,
    kind: z.enum(SERVICE_KINDS),
    status: status.optional(),
    image: str.optional(),
    version: z.union([str, z.number()]).optional(),
    pin: str.optional(),
    ports: z
      .array(
        obj({
          port: portSpec,
          proto: z.enum(['tcp', 'udp']).optional(),
          bind: str.optional(),
          auth: z.enum(PORT_AUTH).optional(),
          exposure: z.enum(EXPOSURES).optional(),
          purpose: str.optional(),
        }),
      )
      .optional(),
    urls: z
      .array(obj({ label: str.optional(), url: httpUrl, internal: z.boolean().optional() }))
      .optional(),
    auth: z.enum(SERVICE_AUTH).optional(),
    calls: z
      .array(
        obj({
          target: str.min(1).meta({ description: 'Entity id or an external label' }),
          via: str.optional(),
          port: portSpec.optional(),
          purpose: str.optional(),
        }),
      )
      .optional(),
    health: obj({ kuma: refs.optional(), push: z.boolean().optional() }).optional(),
    logs: obj({
      dozzle: obj({
        host: str.min(1).meta({ description: 'Dozzle agent/host name' }),
        container: str.min(1).meta({ description: 'Container name' }),
      }).optional(),
    }).optional(),
    paths: stringMap.optional(),
    secrets: secrets.optional(),
    schedule: str.optional(),
    backup: obj({ how: str.optional(), where: str.optional() }).optional(),
    update: obj({ command: str.optional(), notes: md.optional() }).optional(),
  });

  const route = obj({
    ...base,
    host: str.min(1),
    paths: z
      .array(str)
      .optional()
      .meta({ description: 'Path prefixes or Traefik rule strings, e.g. HostRegexp(...)' }),
    via: z.enum(ROUTE_VIA),
    target: ref,
    upstream: str.optional(),
    auth: z.enum(ROUTE_AUTH).optional(),
    middlewares: z.array(str).optional(),
  });

  const monitor = obj({
    ...base,
    kuma_id: z.int().min(0),
    name: str,
    type: str.optional(),
    target: str.optional(),
    service: ref.optional(),
    node: ref
      .optional()
      .meta({ description: 'Node id, for host ping monitors (instead of service)' }),
    group: str.optional(),
    active: z.boolean().optional().meta({ description: 'Defaults to true' }),
    interval_s: z.int().min(1).optional(),
  })
    .refine((m) => m.service === undefined || m.node === undefined, {
      message: 'set either `service` or `node`, not both',
      path: ['node'],
    })
    // Same rule for editors (zod refinements do not reach the JSON Schema).
    .meta({ not: { required: ['service', 'node'] } });

  const job = obj({
    ...base,
    node: ref,
    schedule: str.min(1),
    command: str.optional(),
    source: str.optional(),
    purpose: str.optional(),
    notifies: z.union([z.boolean(), str]).optional(),
  });

  const backup = obj({
    ...base,
    what: str.min(1),
    from: refs.optional(),
    to: str.min(1),
    schedule: str.optional(),
    retention: str.optional(),
    offsite: z.boolean().optional(),
    encrypted: z.boolean().optional(),
    restore: md.optional(),
  });

  const history = obj({
    ...base,
    date,
    title: str,
    summary: md.optional(),
    refs: refs.optional(),
    rollback: md.optional(),
  });

  const openQuestion = obj({ ...base, question: str.min(1), refs: refs.optional() });

  const sections = {
    policies: policy,
    procedures: procedure,
    zones: zone,
    networks: network,
    nodes: node,
    services: service,
    routes: route,
    monitors: monitor,
    jobs: job,
    backups: backup,
    history,
    open_questions: openQuestion,
  };

  /** Shape of one data file. One file (normally the one with `meta`) declares `version: 1`. */
  const file = obj({
    version: z
      .literal(1)
      .optional()
      .meta({ description: 'Required in at least one file (normally the one with meta)' }),
    meta: meta.optional(),
    policies: z.array(policy).optional(),
    procedures: z.array(procedure).optional(),
    zones: z.array(zone).optional(),
    networks: z.array(network).optional(),
    nodes: z.array(node).optional(),
    services: z.array(service).optional(),
    routes: z.array(route).optional(),
    monitors: z.array(monitor).optional(),
    jobs: z.array(job).optional(),
    backups: z.array(backup).optional(),
    history: z.array(history).optional(),
    open_questions: z.array(openQuestion).optional(),
  });

  return { meta, sections, file };
}

export const looseSchemas = buildSchemas('loose');
export const strictSchemas = buildSchemas('strict');

type Sections = typeof looseSchemas.sections;
export type SectionKey = keyof Sections;
export const SECTION_KEYS = Object.keys(looseSchemas.sections) as SectionKey[];

export type Meta = z.infer<typeof looseSchemas.meta>;
export type Policy = z.infer<Sections['policies']>;
export type Procedure = z.infer<Sections['procedures']>;
export type Zone = z.infer<Sections['zones']>;
export type Network = z.infer<Sections['networks']>;
export type SystemNode = z.infer<Sections['nodes']>;
export type Service = z.infer<Sections['services']>;
export type Route = z.infer<Sections['routes']>;
export type Monitor = z.infer<Sections['monitors']>;
export type Job = z.infer<Sections['jobs']>;
export type Backup = z.infer<Sections['backups']>;
export type HistoryEntry = z.infer<Sections['history']>;
export type OpenQuestion = z.infer<Sections['open_questions']>;
export type SectionItem<K extends SectionKey> = z.infer<Sections[K]>;
export type AnyEntity = SectionItem<SectionKey>;

export function toJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(looseSchemas.file, { target: 'draft-2020-12', unrepresentable: 'any' }),
    $id: 'https://github.com/mrRedSun/system-map/blob/main/schema/system-map.schema.json',
    title: 'System Map data file (v1)',
  };
}
