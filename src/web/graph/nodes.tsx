import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight, Lock } from 'lucide-react';
import type { HealthStatus } from '../../shared/model';
import { cn } from '@/lib/utils';
import type { Exposure } from '@/lib/model-index';
import type { LucideIcon } from 'lucide-react';

export interface GraphNodeData extends Record<string, unknown> {
  label: string;
  sublabel: string;
  icon: LucideIcon;
  childCount: number;
  expanded: boolean;
  dimmed: boolean;
  depth: number;
  /** Graph flows top to bottom (narrow screens). */
  vertical: boolean;
  selected: boolean;
  /** Another node is selected and this one is not connected to it. */
  faded: boolean;
  status?: string;
  auth?: string;
  exposure?: Exposure;
  health?: HealthStatus;
  onToggle: (id: string) => void;
}

export type GraphNode = Node<GraphNodeData>;

const HANDLE = '!pointer-events-none !size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent';

export function HealthDot({ status, className }: { status?: HealthStatus; className?: string }) {
  if (!status) return null;
  return (
    <span
      role="img"
      aria-label={`health: ${status}`}
      title={`Health: ${status}`}
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ background: `var(--health-${status === 'unknown' ? 'pending' : status})` }}
    />
  );
}

const EXPOSURE_CLASS: Record<Exposure, string> = {
  public: 'bg-[color-mix(in_oklch,var(--health-down)_16%,transparent)] text-[var(--health-down)]',
  restricted:
    'bg-[color-mix(in_oklch,var(--health-pending)_20%,transparent)] text-[color-mix(in_oklch,var(--health-pending),var(--foreground)_35%)]',
  lan: 'bg-[color-mix(in_oklch,var(--edge-calls)_14%,transparent)] text-[var(--edge-calls)]',
  internal: 'bg-muted text-muted-foreground',
};

function Badges({ data }: { data: GraphNodeData }) {
  const stopped = data.status && data.status !== 'running' ? data.status.replace('-', ' ') : null;
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      {data.exposure && (
        <span
          className={cn(
            'rounded px-1 py-px text-[10px] leading-none',
            EXPOSURE_CLASS[data.exposure],
          )}
        >
          {data.exposure}
        </span>
      )}
      {data.auth && (
        <span
          className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-px text-[10px] leading-none text-muted-foreground"
          title={`Auth: ${data.auth}`}
        >
          <Lock className="size-2.5" />
          {data.auth}
        </span>
      )}
      {stopped && (
        <span className="rounded border border-dashed px-1 text-[10px] leading-none">
          {stopped}
        </span>
      )}
    </span>
  );
}

function ToggleButton({ id, data }: { id: string; data: GraphNodeData }) {
  if (data.childCount === 0) return null;
  const Chevron = data.expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      className="nodrag nopan inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-xs text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={`${data.expanded ? 'Collapse' : 'Expand'} ${data.label} (${data.childCount} inside)`}
      aria-expanded={data.expanded}
      onClick={(e) => {
        e.stopPropagation();
        data.onToggle(id);
      }}
    >
      <Chevron className="size-3.5" />
      {data.childCount}
    </button>
  );
}

export function EntityNode({ id, data }: NodeProps<GraphNode>) {
  const Icon = data.icon;
  return (
    <div
      className={cn(
        'flex h-full w-full animate-in items-center gap-2.5 rounded-xl border bg-card px-2.5 text-card-foreground shadow-xs transition-[opacity,box-shadow,border-color] duration-200 fade-in-0 hover:border-ring/60',
        data.selected && 'border-ring ring-2 ring-ring/40',
        data.dimmed && 'border-dashed opacity-55',
        data.faded && 'opacity-35',
        data.childCount > 0 && 'shadow-[3px_3px_0_-1px_var(--card),3px_3px_0_0_var(--border)]',
      )}
    >
      <Handle
        type="target"
        position={data.vertical ? Position.Top : Position.Left}
        className={HANDLE}
        isConnectable={false}
      />
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm leading-tight font-medium">{data.label}</span>
          <HealthDot status={data.health} />
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
          <span className="shrink-0 font-mono">{data.sublabel}</span>
          <Badges data={data} />
        </span>
      </span>
      <ToggleButton id={id} data={data} />
      <Handle
        type="source"
        position={data.vertical ? Position.Bottom : Position.Right}
        className={HANDLE}
        isConnectable={false}
      />
    </div>
  );
}

export function ContainerNode({ id, data }: NodeProps<GraphNode>) {
  const Icon = data.icon;
  return (
    <div
      className={cn(
        'h-full w-full animate-in rounded-2xl border fade-in-0',
        data.depth === 0 ? 'bg-muted/40' : 'bg-card/70',
        data.selected && 'border-ring ring-2 ring-ring/40',
        data.dimmed && 'border-dashed opacity-60',
        data.faded && 'opacity-60',
      )}
    >
      <Handle
        type="target"
        position={data.vertical ? Position.Top : Position.Left}
        className={HANDLE}
        isConnectable={false}
      />
      <div className="flex h-11 items-center gap-2 px-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-semibold">{data.label}</span>
        <HealthDot status={data.health} />
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {data.sublabel}
        </span>
        <span className="ml-auto">
          <ToggleButton id={id} data={data} />
        </span>
      </div>
      <Handle
        type="source"
        position={data.vertical ? Position.Bottom : Position.Right}
        className={HANDLE}
        isConnectable={false}
      />
    </div>
  );
}
