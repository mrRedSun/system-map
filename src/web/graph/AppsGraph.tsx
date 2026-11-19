import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import {
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  Eye,
  EyeOff,
  LayoutGrid,
  Loader2,
  Scan,
  Waypoints,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SystemModel } from '../../shared/model';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Kbd } from '@/components/ui/kbd';
import { statusOf } from '@/lib/model-index';
import { useNarrow } from '@/lib/media';
import { usePersisted } from '@/lib/persisted';
import { iconFor, kindLabel } from '@/lib/visuals';
import { AppEdge, type AppFlowEdge } from './app-edge';
import { placeLabels, type Rect } from './edge-labels';
import { AppNode, SmallNode, StackNode, type AppGraphNode, type PortInfo } from './app-nodes';
import {
  DEFAULT_APPS_OPTIONS,
  buildApps,
  edgeLabel,
  focusGraph,
  neighbours,
  stackGroupOf,
  type AppEdgeKind,
  type AppsGraph as Graph,
} from './apps';
import type { GraphViewProps } from './GraphView';
import { layoutApps, type Box } from './layout';
import { LineSwatch, ModeSwitch, SwatchToggle, ToolbarDivider } from './toolbar';
import { useTweenedNodes } from './use-tween';

const NODE_TYPES = { app: AppNode, small: SmallNode, stack: StackNode };
const EDGE_TYPES = { app: AppEdge };
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** Below this, labels are too small to read; the first view then starts at READABLE_ZOOM. */
const MIN_READABLE_ZOOM = 0.5;
const READABLE_ZOOM = 0.75;

/** Edges between stacks are drawn lighter; they are long and cross other stacks. */
const CROSS_STACK_OPACITY = 0.4;

const EDGE: Record<AppEdgeKind, { color: string; dash?: string; opacity: number; width: number }> =
  {
    use: { color: 'var(--edge-calls)', opacity: 0.85, width: 1.5 },
    observe: { color: 'var(--edge-observes)', dash: '2 4', opacity: 0.45, width: 1 },
    ingress: { color: 'var(--edge-routes)', dash: '6 4', opacity: 0.7, width: 1.25 },
  };

/** Kinds of key events that belong to a text field, not the graph. */
function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return Boolean(t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'));
}

export function AppsGraph({
  model,
  index,
  selected,
  onSelect,
  healthOf,
  mode,
  onMode,
}: GraphViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [showRetired, setShowRetired] = usePersisted('show-retired', false, isBool);
  const [externals, setExternals] = usePersisted(
    'apps-externals',
    DEFAULT_APPS_OPTIONS.externals,
    isBool,
  );
  const [ingress, setIngress] = usePersisted('apps-ingress', DEFAULT_APPS_OPTIONS.ingress, isBool);
  const [focusMode, setFocusMode] = useState(false);
  /** Highlight for items without an entity (externals, the Other stack). */
  const [local, setLocal] = useState<string | undefined>(undefined);
  const [hovered, setHovered] = useState<string | undefined>(undefined);
  const [fitTarget, setFitTarget] = useState<string | undefined>(undefined);
  const { fitView, setViewport } = useReactFlow();
  const vertical = useNarrow();

  // A deep link or search result inside a collapsed stack expands it (once per selection).
  const [revealed, setRevealed] = useState<string | undefined>(undefined);
  if (selected !== revealed) {
    setRevealed(selected);
    const group = selected ? stackGroupOf(model, selected) : undefined;
    if (group && collapsed.has(group)) {
      setCollapsed(new Set([...collapsed].filter((g) => g !== group)));
      setFitTarget(selected);
    }
  }

  const full = useMemo(
    () => buildApps(model, index, { collapsed, showRetired, externals, ingress }),
    [model, index, collapsed, showRetired, externals, ingress],
  );
  const ids = useMemo(() => new Set(full.items.map((i) => i.id)), [full]);
  // Only cards can be highlighted; an expanded stack box has no edges of its own.
  const cards = useMemo(
    () => new Set(full.items.filter((i) => !i.expanded).map((i) => i.id)),
    [full],
  );
  const highlight =
    selected && cards.has(selected) ? selected : local && cards.has(local) ? local : undefined;
  if (focusMode && !highlight) setFocusMode(false);
  const graph = useMemo(
    () => (focusMode && highlight ? focusGraph(full, highlight) : full),
    [full, focusMode, highlight],
  );

  const toggle = useCallback((id: string) => {
    setFitTarget(id);
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleFocus = useCallback(() => {
    if (!highlight) return;
    setFitTarget(undefined);
    setFocusMode((f) => !f);
  }, [highlight]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' || e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
      e.preventDefault();
      toggleFocus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFocus]);

  const container = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ graph: Graph; boxes: Map<string, Box> }>();
  useEffect(() => {
    let cancelled = false;
    const el = container.current;
    const aspect = el && el.clientHeight > 0 ? el.clientWidth / el.clientHeight : 1.6;
    layoutApps(graph, vertical ? 'DOWN' : 'RIGHT', aspect, graph !== full)
      .then((boxes) => {
        if (!cancelled) setLayout({ graph, boxes });
      })
      .catch((err: unknown) => console.error('layout failed', err));
    return () => {
      cancelled = true;
    };
  }, [graph, full, vertical]);

  const near = useMemo(
    () => (highlight && layout ? neighbours(layout.graph, highlight) : undefined),
    [highlight, layout],
  );

  const open = useCallback((id: string) => onSelect(id), [onSelect]);

  const nodes = useMemo<AppGraphNode[]>(() => {
    if (!layout) return [];
    return layout.graph.items.map((item) => {
      const ref = item.entity ? index.byId.get(item.entity) : undefined;
      const box = layout.boxes.get(item.id) ?? { x: 0, y: 0, width: 0, height: 0 };
      const service =
        item.kind === 'app' ? (ref?.entity as SystemModel['services'][number]) : undefined;
      const ports: PortInfo[] = (service?.ports ?? []).map((p) => ({
        port: `${p.port}/${p.proto ?? 'tcp'}`,
        purpose: p.purpose,
        exposure: p.exposure,
      }));
      const icon =
        item.kind === 'stack'
          ? LayoutGrid
          : item.kind === 'external'
            ? ExternalLink
            : item.kind === 'ingress'
              ? Waypoints
              : iconFor(ref);
      const sublabel =
        item.kind === 'app'
          ? item.host
          : item.kind === 'stack'
            ? `${item.childCount} apps`
            : item.kind === 'device' && ref
              ? kindLabel(ref)
              : item.kind;
      return {
        id: item.id,
        type: item.expanded
          ? 'stack'
          : item.kind === 'app' || item.kind === 'stack'
            ? 'app'
            : 'small',
        parentId: item.parent,
        position: { x: box.x, y: box.y },
        style: { width: box.width, height: box.height },
        draggable: false,
        data: {
          kind: item.kind,
          label: item.label,
          icon,
          sublabel,
          public: item.public,
          ports,
          status: ref ? statusOf(ref.entity) : undefined,
          dimmed: item.dimmed,
          vertical,
          selected: item.id === highlight || item.id === selected,
          faded: near !== undefined && !near.has(item.id) && !item.expanded,
          health: item.entity && item.kind !== 'stack' ? healthOf?.(item.entity) : undefined,
          color: item.color,
          childCount: item.childCount,
          expanded: item.expanded,
          entity: item.entity,
          onToggle: toggle,
          onOpen: open,
        },
      };
    });
  }, [layout, index, highlight, selected, near, healthOf, toggle, open, vertical]);

  const edges = useMemo<AppFlowEdge[]>(() => {
    if (!layout) return [];
    const byId = new Map(layout.graph.items.map((i) => [i.id, i]));
    // Absolute rectangles, for label placement.
    const rects = new Map<string, Rect>();
    const rectOf = (id: string): Rect | undefined => {
      const known = rects.get(id);
      if (known) return known;
      const box = layout.boxes.get(id);
      if (!box) return undefined;
      const parent = byId.get(id)?.parent;
      const origin = parent ? rectOf(parent) : undefined;
      const rect = { ...box, x: box.x + (origin?.x ?? 0), y: box.y + (origin?.y ?? 0) };
      rects.set(id, rect);
      return rect;
    };
    const wanted = layout.graph.edges.filter(
      (e) =>
        e.id === hovered ||
        (highlight !== undefined && (e.source === highlight || e.target === highlight)),
    );
    const spots = placeLabels(
      wanted.flatMap((e) => {
        const source = rectOf(e.source);
        const target = rectOf(e.target);
        const text = edgeLabel(e);
        return source && target && text
          ? [{ id: e.id, text, source, target, pinned: e.id === hovered }]
          : [];
      }),
      layout.graph.items.filter((i) => !i.expanded).flatMap((i) => rectOf(i.id) ?? []),
      vertical,
    );
    return layout.graph.edges.map((e) => {
      const style = EDGE[e.kind];
      const active = highlight !== undefined && (e.source === highlight || e.target === highlight);
      const faded = highlight !== undefined && !active;
      const cross = byId.get(e.source)?.parent !== byId.get(e.target)?.parent;
      const base = cross ? Math.min(style.opacity, CROSS_STACK_OPACITY) : style.opacity;
      return {
        id: e.id,
        type: 'app' as const,
        source: e.source,
        target: e.target,
        data: { label: edgeLabel(e), labelAt: spots.get(e.id) },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.color, width: 14, height: 14 },
        style: {
          stroke: style.color,
          strokeWidth: (active ? style.width + 0.75 : style.width) + Math.min(e.count - 1, 3) * 0.5,
          strokeDasharray: style.dash,
          opacity: faded ? 0.08 : active || e.id === hovered ? 1 : base,
        },
        // Highlighted edges above the cards; the rest under them, so lines never cross a label.
        zIndex: active || e.id === hovered ? 20 : 0,
      };
    });
  }, [layout, highlight, hovered, vertical]);

  const shown = useTweenedNodes(nodes);

  // First layout: fit everything. After a toggle: bring that item into view. Focus: fit all.
  // When everything would be too small to read (phones, very large maps), start at the
  // top-left corner at a readable zoom instead.
  const fitted = useRef(false);
  const toolbar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!layout) return;
    const id = fitTarget;
    const showAll = (duration: number) => {
      const el = container.current;
      const top = (toolbar.current?.offsetHeight ?? 40) + 20;
      // The detail panel covers the right side on wider screens (`min(34rem, 100%)`).
      const panel = selected && !vertical && el ? Math.min(544, el.clientWidth) : 0;
      let right = 0;
      let bottom = 0;
      for (const item of layout.graph.items) {
        const b = layout.boxes.get(item.id);
        if (item.parent || !b) continue;
        right = Math.max(right, b.x + b.width);
        bottom = Math.max(bottom, b.y + b.height);
      }
      const fit = el
        ? Math.min((el.clientWidth - panel - 32) / right, (el.clientHeight - top - 16) / bottom)
        : 1;
      if (fit >= MIN_READABLE_ZOOM) {
        const padding = {
          top: `${top}px`,
          left: '16px',
          right: `${panel + 16}px`,
          bottom: '16px',
        } as const;
        void fitView({ padding, duration, maxZoom: 1.2 });
      } else {
        // Layout starts at a 24 px margin.
        const zoom = READABLE_ZOOM;
        void setViewport({ x: 16 - 24 * zoom, y: top - 24 * zoom, zoom }, { duration });
      }
    };
    const timer = window.setTimeout(() => {
      if (!fitted.current) {
        fitted.current = true;
        if (selected && ids.has(selected)) {
          void fitView({ nodes: [{ id: selected }], padding: 0.6, duration: 0, maxZoom: 1 });
        } else showAll(0);
      } else if (id) {
        void fitView({ nodes: [{ id }], padding: 0.25, duration: 450, maxZoom: 1.1 });
      } else {
        showAll(450);
      }
    }, 340);
    return () => window.clearTimeout(timer);
    // Re-run only for a new layout; the fit target is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, fitView, setViewport]);

  const stackIds = useMemo(
    () => full.items.filter((i) => i.kind === 'stack').map((i) => i.id),
    [full],
  );

  return (
    <div ref={container} className="relative h-full w-full">
      <ReactFlow
        nodes={shown}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodeClick={(_, node) => {
          const data = node.data as AppGraphNode['data'];
          if (node.type === 'stack') {
            setLocal(undefined);
            onSelect(undefined);
          } else if (data.entity) {
            setLocal(undefined);
            onSelect(data.entity);
          } else {
            setLocal(node.id);
            onSelect(undefined);
          }
        }}
        onNodeDoubleClick={(_, node) => {
          if ((node.data as AppGraphNode['data']).kind === 'stack') toggle(node.id);
        }}
        onEdgeMouseEnter={(_, e) => setHovered(e.id)}
        onEdgeMouseLeave={() => setHovered(undefined)}
        onPaneClick={() => {
          setLocal(undefined);
          onSelect(undefined);
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.05}
        maxZoom={2}
        onlyRenderVisibleElements={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} position="bottom-left" />

        <Panel position="top-left" className="!m-2 max-w-[calc(100%-1rem)]">
          <div
            ref={toolbar}
            className="flex flex-wrap items-center gap-1 rounded-xl border bg-card/90 p-1 shadow-sm backdrop-blur"
          >
            <ModeSwitch mode={mode} onMode={onMode} />
            <ToolbarDivider />
            <SwatchToggle
              on={externals}
              onChange={setExternals}
              label="External"
              title={`${externals ? 'Hide' : 'Show'} things outside the model (APIs, the internet)`}
              swatch={<ExternalLink className="size-3.5" />}
            />
            <SwatchToggle
              on={ingress}
              onChange={setIngress}
              label="Ingress edges"
              title={`${ingress ? 'Hide' : 'Show'} edges from the reverse proxy to public apps`}
              swatch={<LineSwatch color={EDGE.ingress.color} dash={EDGE.ingress.dash} />}
            />
            <ToolbarDivider />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={focusMode ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  aria-pressed={focusMode}
                  disabled={!highlight}
                  onClick={toggleFocus}
                >
                  <Scan />
                  <span className="hidden sm:inline">Focus</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {highlight
                  ? 'Show only the selected app and its neighbours'
                  : 'Select an app first'}{' '}
                <Kbd>F</Kbd>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setFitTarget(undefined);
                    setCollapsed(new Set());
                  }}
                  aria-label="Expand all stacks"
                >
                  <ChevronsUpDown />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Expand all stacks</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setFitTarget(undefined);
                    setCollapsed(new Set(stackIds));
                  }}
                  aria-label="Collapse all stacks"
                >
                  <ChevronsDownUp />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Collapse all stacks</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-pressed={showRetired}
                  onClick={() => setShowRetired(!showRetired)}
                  aria-label={showRetired ? 'Hide retired' : 'Show retired'}
                >
                  {showRetired ? <Eye /> : <EyeOff />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{showRetired ? 'Hide retired' : 'Show retired'}</TooltipContent>
            </Tooltip>
          </div>
        </Panel>
      </ReactFlow>
      {!layout && (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-label="Laying out" />
        </div>
      )}
    </div>
  );
}
