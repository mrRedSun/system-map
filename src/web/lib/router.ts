import { useAtomValue } from '@effect/atom-react';
import { Atom } from 'effect/reactivity';

export const VIEWS = [
  'graph',
  'wiki',
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
  /**
   * Wiki page (wiki view only): an entity id, or `ref/<index>` for a generated index page.
   * Absent for the wiki home.
   */
  page?: string;
  /** Entity whose detail panel is open. */
  entity?: string;
}

/** Generated wiki index pages, at `#/wiki/ref/<name>`. */
export const WIKI_INDEXES = [
  'articles',
  'policies',
  'procedures',
  'history',
  'questions',
  'coverage',
] as const;
export type WikiIndex = (typeof WIKI_INDEXES)[number];

/**
 * `#/<view>`, `#/<view>/n/<id>`, the short deep link `#/n/<id>` (graph view),
 * `#/graph/<mode>[/n/<id>]` for a graph mode, and `#/wiki[/<id> | /ref/<index>][/n/<id>]`.
 */
export function parseHash(hash: string): Location {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(safeDecode);
  let view: View = 'graph';
  if (parts[0] && (VIEWS as readonly string[]).includes(parts[0])) {
    view = parts.shift() as View;
  }
  const graph =
    view === 'graph' && isGraphMode(parts[0]) ? (parts.shift() as GraphMode) : undefined;
  let page: string | undefined;
  if (view === 'wiki' && parts[0] && parts[0] !== 'n') {
    // Ids are kebab-case, so `ref` followed by a second segment is always an index page.
    if (parts[0] === 'ref' && parts[1] && parts[1] !== 'n') page = `ref/${parts.splice(0, 2)[1]}`;
    else page = parts.shift();
  }
  const entity = parts[0] === 'n' && parts[1] ? parts[1] : undefined;
  return {
    view,
    ...(graph ? { graph } : {}),
    ...(page ? { page } : {}),
    ...(entity ? { entity } : {}),
  };
}

export function formatHash(loc: Location): string {
  const graph = loc.view === 'graph' ? loc.graph : undefined;
  const page = loc.view === 'wiki' ? loc.page : undefined;
  const base = graph
    ? `#/graph/${graph}`
    : page
      ? `#/wiki/${page.split('/').map(encodeURIComponent).join('/')}`
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
