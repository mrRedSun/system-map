import { useAtomValue } from '@effect/atom-react';
import { Atom } from 'effect/reactivity';

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

export const GRAPH_MODES = ['apps', 'infra'] as const;
export type GraphMode = (typeof GRAPH_MODES)[number];
export const isGraphMode = (v: unknown): v is GraphMode =>
  (GRAPH_MODES as readonly unknown[]).includes(v);

export interface Location {
  view: View;
  /** Graph mode named in the URL (graph view only); otherwise the saved preference applies. */
  graph?: GraphMode;
  /** Entity whose detail panel is open. */
  entity?: string;
}

/**
 * `#/<view>`, `#/<view>/n/<id>`, the short deep link `#/n/<id>` (graph view), and
 * `#/graph/<mode>[/n/<id>]` for a graph mode.
 */
export function parseHash(hash: string): Location {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(safeDecode);
  let view: View = 'graph';
  if (parts[0] && (VIEWS as readonly string[]).includes(parts[0])) {
    view = parts.shift() as View;
  }
  const graph =
    view === 'graph' && isGraphMode(parts[0]) ? (parts.shift() as GraphMode) : undefined;
  const entity = parts[0] === 'n' && parts[1] ? parts[1] : undefined;
  return { view, ...(graph ? { graph } : {}), ...(entity ? { entity } : {}) };
}

export function formatHash(loc: Location): string {
  const graph = loc.view === 'graph' ? loc.graph : undefined;
  const base = graph
    ? `#/graph/${graph}`
    : loc.view === 'graph' && loc.entity
      ? '#'
      : `#/${loc.view}`;
  return loc.entity ? `${base}/n/${encodeURIComponent(loc.entity)}` : base;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The current location, following `hashchange`. */
export const locationAtom = Atom.make((get) => {
  const onChange = () => get.setSelf(parseHash(window.location.hash));
  window.addEventListener('hashchange', onChange);
  get.addFinalizer(() => window.removeEventListener('hashchange', onChange));
  return parseHash(window.location.hash);
}).pipe(Atom.keepAlive);

export function navigate(next: Location): void {
  const target = formatHash(next);
  if (target !== window.location.hash) window.location.hash = target;
}

export function useLocation(): [Location, (next: Location) => void] {
  return [useAtomValue(locationAtom), navigate];
}
