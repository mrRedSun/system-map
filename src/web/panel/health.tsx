import type { HealthStatus, MonitorHealth, SystemModel } from '../../shared/model';
import { useApp } from '@/app-context';
import { EntityLink } from '@/components/EntityLink';
import { Empty } from '@/components/Fields';
import { Badge } from '@/components/ui/badge';
import { HealthDot } from '@/graph/nodes';
import { hostChain } from '@/lib/model-index';

/** Monitors that describe an entity: itself, its service's, or those of services inside a node. */
export function monitorsFor(
  model: SystemModel,
  index: ReturnType<typeof useApp>['index'],
  id: string,
) {
  const ref = index.byId.get(id);
  if (ref?.section === 'monitors') return [id];
  if (ref?.section === 'services') return index.monitorsOf.get(id) ?? [];
  if (ref?.section === 'nodes') {
    // The node's own monitors (pings) first, then those of services running inside it.
    return [
      ...(index.monitorsOf.get(id) ?? []),
      ...model.services
        .filter((s) => hostChain(index, s.id).includes(id))
        .flatMap((s) => index.monitorsOf.get(s.id) ?? []),
    ];
  }
  return [];
}

const pct = (v: number) => `${(v * 100).toFixed(v >= 0.9995 ? 1 : 2)}%`;

export function HealthTab({
  id,
  monitors,
  error,
}: {
  id: string;
  monitors: Record<string, MonitorHealth>;
  error?: string;
}) {
  const { model, index } = useApp();
  const ids = [...new Set(monitorsFor(model, index, id))];
  const service = index.byId.get(id)?.section === 'services';
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-sm">
          Uptime Kuma: {error}
        </p>
      )}
      {ids.length === 0 && (
        <Empty>
          {service ? 'No Uptime Kuma monitor is linked to this service.' : 'No monitors.'}
        </Empty>
      )}
      {ids.map((mid) => {
        const m = index.byId.get(mid)?.entity as SystemModel['monitors'][number] | undefined;
        if (!m) return null;
        const h = monitors[String(m.kuma_id)];
        const status: HealthStatus | undefined =
          m.active === false ? undefined : (h?.status ?? 'unknown');
        return (
          <div key={mid} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <HealthDot status={status} />
              <EntityLink id={mid} showIcon={false} className="font-medium" />
              <span className="text-xs text-muted-foreground">Kuma #{m.kuma_id}</span>
              <span className="ml-auto text-xs font-medium capitalize">
                {m.active === false ? 'paused' : (h?.status ?? 'no data')}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {m.type && <Badge variant="outline">{m.type}</Badge>}
              {m.group && <Badge variant="outline">{m.group}</Badge>}
              {m.interval_s && <Badge variant="outline">every {m.interval_s}s</Badge>}
              {h?.ping !== undefined && <Badge variant="secondary">{Math.round(h.ping)} ms</Badge>}
              {Object.entries(h?.uptime ?? {}).map(([w, v]) => (
                <Badge key={w} variant="secondary">
                  {w}: {pct(v)}
                </Badge>
              ))}
            </div>
            {m.target && (
              <div className="font-mono text-xs break-all text-muted-foreground">{m.target}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
