import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge as FlowEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronsDownUp, ChevronsUpDown, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HealthStatus, SystemModel } from '../../shared/model';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { displayName, exposureOf, statusOf, type ModelIndex } from '@/lib/model-index';
import { useNarrow } from '@/lib/media';
import { useAtom } from '@effect/atom-react';
import { edgeKindsAtom, showRetiredAtom } from '@/lib/prefs';
import { GROUP_ICONS, iconFor, kindLabel } from '@/lib/visuals';
import type { GraphMode } from '@/lib/router';
import { cn } from '@/lib/utils';
import { AppsGraph } from './AppsGraph';
import { EDGE_STYLE } from './edge-style';
import { layoutTopology, type Box } from './layout';
import { ContainerNode, EntityNode, type GraphNode } from './nodes';
import {
  DRAWN_EDGE_KINDS,
  GROUPS,
  ancestorsOf,
  buildTopology,
  buildTree,
  defaultExpanded,
  type DrawnEdgeKind,
  type Topology,
} from './topology';
import { ModeSwitch, ToolbarDivider } from './toolbar';
import { useTweenedNodes } from './use-tween';

export interface GraphViewProps {
  model: SystemModel;
  index: ModelIndex;
  selected?: string;
  onSelect: (id: string | undefined) => void;
  healthOf?: (id: string) => HealthStatus | undefined;
  mode: GraphMode;
  onMode: (mode: GraphMode) => void;
}

const NODE_TYPES = { entity: EntityNode, container: ContainerNode };

export function GraphView(props: GraphViewProps) {
  // Keyed by mode: each mode keeps its own viewport and fits on first layout.
  return (
    <ReactFlowProvider key={props.mode}>
      {props.mode === 'apps' ? <AppsGraph {...props} /> : <InfraGraph {...props} />}
    </ReactFlowProvider>
  );
}

/** Containment view: host → guests → services, plus routes, monitors and backups. */
function InfraGraph({ model, index, selected, onSelect, healthOf, mode, onMode }: GraphViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(model));
  const [edgeKinds, setEdgeKinds] = useAtom(edgeKindsAtom);
  const [showRetired, setShowRetired] = useAtom(showRetiredAtom);
  const [focus, setFocus] = useState<string | undefined>(undefined);
  const { fitView } = useReactFlow();
  const vertical = useNarrow();

  const tree = useMemo(() => buildTree(model, index, showRetired), [model, index, showRetired]);

  // A deep link or search result inside a collapsed item expands its ancestors (once per
  // selection, so the user can still collapse them afterwards).
  const [revealed, setRevealed] = useState<string | undefined>(undefined);
  if (selected !== revealed) {
    setRevealed(selected);
    const hidden = selected ? ancestorsOf(tree, selected).filter((a) => !expanded.has(a)) : [];
    if (hidden.length > 0) {
      setExpanded(new Set([...expanded, ...hidden]));
      setFocus(selected);
    }
  }

  const toggle = useCallback((id: string) => {
    setFocus(id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const topology = useMemo(
    () => buildTopology(model, index, { expanded, edgeKinds, showRetired }),
    [model, index, expanded, edgeKinds, showRetired],
  );

  const [layout, setLayout] = useState<{ topology: Topology; boxes: Map<string, Box> }>();
  useEffect(() => {
    let cancelled = false;
    layoutTopology(topology, model, index, vertical ? 'DOWN' : 'RIGHT')
      .then((boxes) => {
        if (!cancelled) setLayout({ topology, boxes });
      })
      .catch((err: unknown) => console.error('layout failed', err));
    return () => {
      cancelled = true;
    };
  }, [topology, model, index, vertical]);

  const connected = useMemo(() => {
    if (!selected || !layout) return undefined;
    const set = new Set<string>([selected]);
    for (const e of layout.topology.edges) {
      if (e.source === selected) set.add(e.target);
      if (e.target === selected) set.add(e.source);
    }
    return set;
  }, [selected, layout]);

  const nodes = useMemo<GraphNode[]>(() => {
    if (!layout) return [];
    return layout.topology.items.map((item) => {
      const ref = index.byId.get(item.id);
      const box = layout.boxes.get(item.id) ?? { x: 0, y: 0, width: 0, height: 0 };
      const group = item.id in GROUPS ? GROUPS[item.id as keyof typeof GROUPS] : undefined;
      const service =
        ref?.section === 'services' ? (ref.entity as SystemModel['services'][number]) : undefined;
      return {
        id: item.id,
        type: item.expanded ? 'container' : 'entity',
        parentId: item.parent,
        position: { x: box.x, y: box.y },
        style: { width: box.width, height: box.height },
        draggable: false,
        data: {
          label: group ? group.label : displayName(ref),
          sublabel: group ? `${item.childCount}` : ref ? kindLabel(ref) : '',
          icon: group ? GROUP_ICONS[item.id]! : iconFor(ref),
          childCount: item.childCount,
          expanded: item.expanded,
          dimmed: item.dimmed,
          depth: item.depth,
          vertical,
          selected: item.id === selected,
          faded: connected !== undefined && !connected.has(item.id) && !item.expanded,
          status: ref ? statusOf(ref.entity) : undefined,
          auth: service?.auth && service.auth !== 'none' ? service.auth : undefined,
          exposure: exposureOf(index, item.id),
          health: healthOf?.(item.id),
          onToggle: toggle,
        },
      };
    });
  }, [layout, index, selected, connected, healthOf, toggle, vertical]);

  const edges = useMemo<FlowEdge[]>(() => {
    if (!layout) return [];
    return layout.topology.edges.map((e) => {
      const style = EDGE_STYLE[e.kind];
      const active = selected !== undefined && (e.source === selected || e.target === selected);
      const faded = selected !== undefined && !active;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        animated: style.animated && !faded,
        // Labels only for the selected item's edges; elsewhere they collide with nodes.
        label: active && e.labels.length > 0 ? e.labels.slice(0, 3).join(', ') : undefined,
        labelStyle: { fill: 'var(--foreground)', fontSize: 11 },
        labelBgStyle: { fill: 'var(--background)' },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.color, width: 16, height: 16 },
        style: {
          stroke: style.color,
          // Merged edges are drawn thicker.
          strokeWidth: (active ? 2.25 : 1.5) + Math.min(e.count - 1, 3) * 0.5,
          strokeDasharray: style.dash,
          opacity: faded ? 0.15 : 0.9,
        },
        zIndex: active ? 10 : 0,
      };
    });
  }, [layout, selected]);

  const shown = useTweenedNodes(nodes);

  // First layout: fit everything. After expanding or collapsing: bring the item into view.
  const fitted = useRef(false);
  useEffect(() => {
    if (!layout) return;
    const id = focus;
    const timer = window.setTimeout(() => {
      if (!fitted.current) {
        fitted.current = true;
        // A deep link opens zoomed to its entity; otherwise show everything.
        void fitView(
          selected
            ? { nodes: [{ id: selected }], padding: 0.6, duration: 0, maxZoom: 1 }
            : { padding: 0.1, duration: 0 },
        );
      } else if (id) {
        void fitView({ nodes: [{ id }], padding: 0.25, duration: 450, maxZoom: 1.1 });
      }
    }, 340);
    return () => window.clearTimeout(timer);
    // Re-run only for a new layout; `focus` is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, fitView]);

  const allIds = useMemo(() => [...tree.children.keys()], [tree]);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={shown}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_, node) => {
          if (node.id in GROUPS) toggle(node.id);
          else onSelect(node.id);
        }}
        onNodeDoubleClick={(_, node) => toggle(node.id)}
        onPaneClick={() => onSelect(undefined)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.05}
        maxZoom={2}
        onlyRenderVisibleElements={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          className="!hidden md:!block"
          nodeColor={(n) => (n.type === 'container' ? 'var(--muted)' : 'var(--border)')}
          maskColor="color-mix(in oklch, var(--background) 70%, transparent)"
        />
        <Panel position="top-left" className="!m-2 max-w-[calc(100%-1rem)]">
          <GraphToolbar
            mode={mode}
            onMode={onMode}
            edgeKinds={edgeKinds}
            onEdgeKinds={setEdgeKinds}
            showRetired={showRetired}
            onShowRetired={setShowRetired}
            onExpandAll={() => setExpanded(new Set(allIds))}
            onCollapseAll={() => setExpanded(defaultExpanded(model))}
          />
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

interface ToolbarProps {
  mode: GraphMode;
  onMode: (mode: GraphMode) => void;
  edgeKinds: Record<DrawnEdgeKind, boolean>;
  onEdgeKinds: (v: Record<DrawnEdgeKind, boolean>) => void;
  showRetired: boolean;
  onShowRetired: (v: boolean) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

function GraphToolbar(p: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border bg-card/90 p-1 shadow-sm backdrop-blur">
      <ModeSwitch mode={p.mode} onMode={p.onMode} />
      <ToolbarDivider />
      {DRAWN_EDGE_KINDS.map((kind) => {
        const on = p.edgeKinds[kind];
        const style = EDGE_STYLE[kind];
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={on}
            onClick={() => p.onEdgeKinds({ ...p.edgeKinds, [kind]: !on })}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              on ? 'text-foreground' : 'text-muted-foreground line-through decoration-1',
            )}
            title={`${on ? 'Hide' : 'Show'} ${style.label.toLowerCase()} edges`}
            aria-label={`${style.label} edges`}
          >
            <svg width="18" height="6" aria-hidden className="shrink-0">
              <line
                x1="1"
                y1="3"
                x2="17"
                y2="3"
                stroke={style.color}
                strokeWidth="2"
                strokeDasharray={style.dash}
                opacity={on ? 1 : 0.4}
              />
            </svg>
            <span className="hidden sm:inline">{style.label}</span>
          </button>
        );
      })}
      <ToolbarDivider />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={p.onExpandAll} aria-label="Expand all">
            <ChevronsUpDown />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Expand all</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={p.onCollapseAll}
            aria-label="Collapse to guests"
          >
            <ChevronsDownUp />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Collapse to guest level</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={p.showRetired}
            onClick={() => p.onShowRetired(!p.showRetired)}
            aria-label={p.showRetired ? 'Hide retired' : 'Show retired'}
          >
            {p.showRetired ? <Eye /> : <EyeOff />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{p.showRetired ? 'Hide retired' : 'Show retired'}</TooltipContent>
      </Tooltip>
    </div>
  );
}
