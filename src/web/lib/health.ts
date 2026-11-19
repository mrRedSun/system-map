import { useEffect, useMemo, useState } from 'react';
import type { HealthResponse, HealthStatus, MonitorHealth, SystemModel } from '../../shared/model';
import type { ModelIndex } from './model-index';

const POLL_MS = 30_000;

export interface HealthState {
  monitors: Record<string, MonitorHealth>;
  error?: string;
  loaded: boolean;
}

/** Polls /api/health every 30 s while the page is visible. */
export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ monitors: {}, loaded: false });
  useEffect(() => {
    let timer: number | undefined;
    let ctrl: AbortController | undefined;
    const load = async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await fetch('/api/health', { cache: 'no-store', signal: ctrl.signal });
        const body = (await res.json()) as HealthResponse;
        const { error, ...rest } = body;
        setState({ monitors: rest as Record<string, MonitorHealth>, error, loaded: true });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setState((s) => ({
          ...s,
          error: err instanceof Error ? err.message : String(err),
          loaded: true,
        }));
      }
    };
    const schedule = () => {
      window.clearInterval(timer);
      if (document.visibilityState === 'visible') {
        void load();
        timer = window.setInterval(() => void load(), POLL_MS);
      }
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => {
      window.clearInterval(timer);
      ctrl?.abort();
      document.removeEventListener('visibilitychange', schedule);
    };
  }, []);
  return state;
}

const SEVERITY: Record<HealthStatus, number> = {
  unknown: 0,
  up: 1,
  maintenance: 2,
  pending: 3,
  down: 4,
};

function worst(a: HealthStatus | undefined, b: HealthStatus | undefined) {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

/**
 * Health per entity id: monitors from Kuma; services from their monitors; nodes from their own
 * monitors (pings) plus everything inside them. Worst status wins; inactive monitors are ignored.
 */
export function entityHealth(
  model: SystemModel,
  index: ModelIndex,
  monitors: Record<string, MonitorHealth>,
): Map<string, HealthStatus> {
  const out = new Map<string, HealthStatus>();
  for (const m of model.monitors) {
    const h = monitors[String(m.kuma_id)];
    if (h && m.active !== false) out.set(m.id, h.status);
  }
  for (const s of model.services) {
    let status: HealthStatus | undefined;
    for (const m of index.monitorsOf.get(s.id) ?? []) status = worst(status, out.get(m));
    if (status) out.set(s.id, status);
  }
  const parentOf = new Map(model.nodes.map((n) => [n.id, n.parent]));
  const bubble = (start: string | undefined, status: HealthStatus) => {
    const seen = new Set<string>();
    for (let cur = start; cur && !seen.has(cur); cur = parentOf.get(cur)) {
      seen.add(cur);
      out.set(cur, worst(out.get(cur), status)!);
    }
  };
  for (const s of model.services) {
    const status = out.get(s.id);
    if (status) bubble(s.node, status);
  }
  for (const m of model.monitors) {
    const status = out.get(m.id);
    if (m.node && status) bubble(m.node, status);
  }
  return out;
}

export function useEntityHealth(
  model: SystemModel | undefined,
  index: ModelIndex | undefined,
  health: HealthState,
) {
  return useMemo(
    () =>
      model && index
        ? entityHealth(model, index, health.monitors)
        : new Map<string, HealthStatus>(),
    [model, index, health.monitors],
  );
}
