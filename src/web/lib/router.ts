import { useCallback, useSyncExternalStore } from 'react';

export const VIEWS = [
  'graph',
  'entities',
  'routes',
  'firewall',
  'jobs',
  'policies',
  'history',
  'questions',
  'problems',
] as const;
export type View = (typeof VIEWS)[number];

export interface Location {
  view: View;
  /** Entity whose detail panel is open. */
  entity?: string;
}

/** `#/<view>`, `#/<view>/n/<id>`, and the short deep link `#/n/<id>` (graph view). */
export function parseHash(hash: string): Location {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(safeDecode);
  let view: View = 'graph';
  if (parts[0] && (VIEWS as readonly string[]).includes(parts[0])) {
    view = parts.shift() as View;
  }
  const entity = parts[0] === 'n' && parts[1] ? parts[1] : undefined;
  return entity ? { view, entity } : { view };
}

export function formatHash(loc: Location): string {
  const base = loc.view === 'graph' && loc.entity ? '#' : `#/${loc.view}`;
  return loc.entity ? `${base}/n/${encodeURIComponent(loc.entity)}` : base;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useLocation(): [Location, (next: Location) => void] {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const navigate = useCallback((next: Location) => {
    const target = formatHash(next);
    if (target !== window.location.hash) window.location.hash = target;
  }, []);
  return [parseHash(hash), navigate];
}
