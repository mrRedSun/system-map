/** Literal sets of the data contract, shared by the schemas and the UI. */

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
/** `observe`: dashboards and monitors reading another app; drawn faint in the Apps graph. */
export const CALL_KINDS = ['use', 'observe'] as const;

/** Named tints for stack group boxes; the app maps them to theme-aware colors. */
export const STACK_COLORS = [
  'gray',
  'red',
  'orange',
  'amber',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'pink',
] as const;
