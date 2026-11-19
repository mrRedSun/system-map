import type { DrawnEdgeKind } from './topology';

export const EDGE_STYLE: Record<
  DrawnEdgeKind,
  { label: string; color: string; dash?: string; animated?: boolean }
> = {
  calls: { label: 'Calls', color: 'var(--edge-calls)' },
  'routes-to': { label: 'Routes', color: 'var(--edge-routes)', dash: '6 4', animated: true },
  mounts: { label: 'Mounts', color: 'var(--edge-mounts)', dash: '2 4' },
  monitors: { label: 'Monitors', color: 'var(--edge-monitors)', dash: '1 5' },
  'backs-up': { label: 'Backups', color: 'var(--edge-backups)', dash: '8 3 2 3' },
};
