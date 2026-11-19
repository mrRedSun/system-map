import { useMemo } from 'react';
import { Effect, Schedule, Stream } from 'effect';
import { AsyncResult, Atom } from 'effect/reactivity';
import type { HealthStatus, MonitorHealth, SystemModel } from '../../shared/model';
import { ApiClient, errorText } from './client';
import type { ModelIndex } from './model-index';

const POLL = '30 seconds';

export interface HealthState {
  monitors: Record<string, MonitorHealth>;
  error?: string;
  loaded: boolean;
}

const INITIAL: HealthState = { monitors: {}, loaded: false };

/** Whether the page is visible, now and on every change. */
const visibility = Stream.suspend(() =>
  Stream.concat(
    Stream.sync(() => document.visibilityState === 'visible'),
    Stream.fromEventListener(document, 'visibilitychange').pipe(
      Stream.map(() => document.visibilityState === 'visible'),
    ),
  ),
).pipe(Stream.changes);

/** Polls /api/health every 30 s while the page is visible (immediately on becoming visible). */
export const healthAtom = ApiClient.runtime
  .atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* ApiClient;
        let state = INITIAL;
        const poll = client.health().pipe(
          Effect.map(({ error, ...monitors }): HealthState => ({
            monitors: monitors as Record<string, MonitorHealth>,
            ...(typeof error === 'string' ? { error } : {}),
            loaded: true,
          })),
          Effect.catch((err) =>
            Effect.succeed<HealthState>({ ...state, error: errorText(err), loaded: true }),
          ),
          Effect.tap((next) => Effect.sync(() => (state = next))),
        );
        return visibility.pipe(
          Stream.switchMap((visible) =>
            visible ? Stream.fromEffectSchedule(poll, Schedule.spaced(POLL)) : Stream.empty,
          ),
        );
      }),
    ),
    { initialValue: INITIAL },
  )
  .pipe(Atom.keepAlive);

export const healthStateOf = (result: AsyncResult.AsyncResult<HealthState, unknown>): HealthState =>
  AsyncResult.getOrElse(result, () => INITIAL);

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
