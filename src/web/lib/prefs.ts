/**
 * Per-viewer UI preferences as atoms persisted in localStorage (JSON under `system-map:<key>`).
 * A missing, corrupt or unavailable store falls back to the default.
 */
import { Schema } from 'effect';
import { BrowserKeyValueStore } from '@effect/platform-browser';
import { Atom } from 'effect/reactivity';
import { DEFAULT_APPS_OPTIONS } from '@/graph/apps';
import { DEFAULT_EDGE_KINDS, DRAWN_EDGE_KINDS, type DrawnEdgeKind } from '@/graph/topology';
import { GRAPH_MODES, type GraphMode } from './router';

const storage = Atom.runtime(BrowserKeyValueStore.layerLocalStorage);

const persisted = <A>(key: string, schema: Schema.Codec<A, unknown>, defaultValue: A) =>
  Atom.kvs({
    runtime: storage,
    key: `system-map:${key}`,
    schema: schema as Schema.Codec<A>,
    defaultValue: () => defaultValue,
  }).pipe(Atom.keepAlive);

export const graphModeAtom = persisted<GraphMode>(
  'graph-mode',
  Schema.Literals(GRAPH_MODES),
  'apps',
);

const EdgeKinds = Schema.Struct(
  Object.fromEntries(DRAWN_EDGE_KINDS.map((k) => [k, Schema.Boolean])) as Record<
    DrawnEdgeKind,
    typeof Schema.Boolean
  >,
);
export const edgeKindsAtom = persisted<Record<DrawnEdgeKind, boolean>>(
  'edge-kinds',
  EdgeKinds as unknown as Schema.Codec<Record<DrawnEdgeKind, boolean>, unknown>,
  DEFAULT_EDGE_KINDS,
);

/** Shared by both graph modes. */
export const showRetiredAtom = persisted('show-retired', Schema.Boolean, false);
export const appsExternalsAtom = persisted(
  'apps-externals',
  Schema.Boolean,
  DEFAULT_APPS_OPTIONS.externals as boolean,
);
export const appsIngressAtom = persisted(
  'apps-ingress',
  Schema.Boolean,
  DEFAULT_APPS_OPTIONS.ingress as boolean,
);
