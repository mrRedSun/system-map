import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight, Globe, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { HealthStatus } from '../../shared/model';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { AppItemKind, StackColor } from './apps';
import { HealthDot } from './nodes';

export interface PortInfo {
  port: string;
  purpose?: string;
  exposure?: string;
}

export interface AppNodeData extends Record<string, unknown> {
  kind: AppItemKind;
  label: string;
  icon: LucideIcon;
  /** Apps: host chip; devices: kind; stacks: app count. */
  sublabel?: string;
  public: string[];
  ports: PortInfo[];
  status?: string;
  dimmed: boolean;
  vertical: boolean;
  selected: boolean;
  /** Something is highlighted and this item is not next to it. */
  faded: boolean;
  health?: HealthStatus;
  color?: StackColor;
  childCount: number;
  expanded: boolean;
  /** Stacks backed by a `stacks` entity open its details from the header. */
  entity?: string;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}

export type AppGraphNode = Node<AppNodeData>;

const HANDLE = '!pointer-events-none !size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent';

const HUES: Record<StackColor, number | null> = {
  gray: null,
  red: 25,
  orange: 55,
  amber: 80,
  lime: 130,
  green: 150,
  teal: 185,
  cyan: 210,
  blue: 255,
  indigo: 275,
  violet: 300,
  pink: 350,
};

/** Theme-aware tint; lightness and chroma come from `--stack-l` / `--stack-c`. */
export function stackColor(color: StackColor | undefined, mix: number): string {
  const hue = HUES[color ?? 'gray'];
  const base =
    hue === null ? 'oklch(var(--stack-l) 0 0)' : `oklch(var(--stack-l) var(--stack-c) ${hue})`;
  return mix >= 100 ? base : `color-mix(in oklch, ${base} ${mix}%, transparent)`;
}

function Handles({ vertical }: { vertical: boolean }) {
  return (
    <>
      <Handle
        type="target"
        position={vertical ? Position.Top : Position.Left}
        className={HANDLE}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={vertical ? Position.Bottom : Position.Right}
        className={HANDLE}
        isConnectable={false}
      />
    </>
  );
}

function Toggle({ id, data }: { id: string; data: AppNodeData }) {
  const Chevron = data.expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      className="nodrag nopan inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1 text-xs text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={`${data.expanded ? 'Collapse' : 'Expand'} ${data.label} (${data.childCount} apps)`}
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

function Details({ data }: { data: AppNodeData }) {
  const stopped = data.status && data.status !== 'running' ? data.status.replace('-', ' ') : null;
  return (
    <div className="flex max-w-72 flex-col gap-1 text-xs">
      <div className="font-medium">
        {data.label}
        {data.sublabel && <span className="ml-1.5 font-mono opacity-70">{data.sublabel}</span>}
        {stopped && <span className="ml-1.5 opacity-70">({stopped})</span>}
      </div>
      {data.ports.length > 0 && (
        <ul className="font-mono">
          {data.ports.map((p, i) => (
            <li key={i}>
              {p.port}
              {p.exposure && <span className="opacity-70"> {p.exposure}</span>}
              {p.purpose && <span className="font-sans opacity-70"> · {p.purpose}</span>}
            </li>
          ))}
        </ul>
      )}
      {data.public.length > 0 && (
        <ul>
          {data.public.map((h) => (
            <li key={h} className="flex items-center gap-1">
              <Globe className="size-3 shrink-0" />
              <span className="font-mono">{h}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** An app, or a collapsed stack (tinted, with an expand toggle). */
export function AppNode({ id, data }: NodeProps<AppGraphNode>) {
  const Icon = data.icon;
  const stack = data.kind === 'stack';
  const stopped = data.status && data.status !== 'running' ? data.status.replace('-', ' ') : null;
  const tint: CSSProperties | undefined = stack
    ? { background: stackColor(data.color, 12), borderColor: stackColor(data.color, 55) }
    : undefined;
  const body = (
    <div
      style={tint}
      className={cn(
        'flex h-full w-full animate-in items-center gap-2 rounded-xl border bg-card px-2 text-card-foreground shadow-xs transition-[opacity,box-shadow,border-color] duration-200 fade-in-0 hover:border-ring/60',
        data.selected && 'border-ring ring-2 ring-ring/40',
        data.dimmed && 'border-dashed opacity-55',
        data.faded && 'opacity-30',
        stack && 'shadow-[3px_3px_0_-1px_var(--card),3px_3px_0_0_var(--border)]',
      )}
    >
      <Handles vertical={data.vertical} />
      <span
        className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
        style={stack ? { color: stackColor(data.color, 100) } : undefined}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] leading-tight font-medium">{data.label}</span>
          <HealthDot status={data.health} />
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
          {data.sublabel && <span className="shrink-0 font-mono">{data.sublabel}</span>}
          {stopped && (
            <span className="truncate rounded border border-dashed px-1 text-[10px]">
              {stopped}
            </span>
          )}
        </span>
      </span>
      {data.public.length > 0 && (
        <span
          className="grid size-5 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklch,var(--edge-routes)_18%,transparent)] text-[var(--edge-routes)]"
          aria-label={`Public: ${data.public.join(', ')}`}
        >
          <Globe className="size-3" />
        </span>
      )}
      {stack && <Toggle id={id} data={data} />}
    </div>
  );
  if (stack) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent side="bottom" align="start">
        <Details data={data} />
      </TooltipContent>
    </Tooltip>
  );
}

/** Devices, externals and ingress points: small and, for things outside the model, dashed. */
export function SmallNode({ data }: NodeProps<AppGraphNode>) {
  const Icon = data.icon;
  const outside = data.kind !== 'device';
  return (
    <div
      title={data.sublabel ? `${data.label} (${data.sublabel})` : data.label}
      className={cn(
        'flex h-full w-full animate-in items-center gap-1.5 rounded-lg border px-2 text-xs transition-opacity duration-200 fade-in-0 hover:border-ring/60',
        outside ? 'border-dashed bg-background/80 text-muted-foreground' : 'bg-card shadow-xs',
        data.selected && 'border-ring ring-2 ring-ring/40',
        data.dimmed && 'opacity-55',
        data.faded && 'opacity-30',
      )}
    >
      <Handles vertical={data.vertical} />
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{data.label}</span>
      <HealthDot status={data.health} />
      {data.sublabel && !outside && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {data.sublabel}
        </span>
      )}
    </div>
  );
}

/** An expanded stack: a lightly tinted, labelled box around its apps. */
export function StackNode({ id, data }: NodeProps<AppGraphNode>) {
  return (
    <div
      style={{ background: stackColor(data.color, 7), borderColor: stackColor(data.color, 40) }}
      className={cn(
        'h-full w-full animate-in rounded-2xl border fade-in-0',
        data.selected && 'ring-2 ring-ring/40',
        data.dimmed && 'border-dashed opacity-60',
      )}
    >
      <Handles vertical={data.vertical} />
      <div className="flex h-8 items-center gap-1.5 pr-1 pl-3">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: stackColor(data.color, 100) }}
        />
        {data.entity ? (
          <button
            type="button"
            className="nodrag nopan truncate rounded text-left text-xs font-semibold tracking-wide uppercase hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            style={{ color: stackColor(data.color, 100) }}
            onClick={(e) => {
              e.stopPropagation();
              data.onOpen(data.entity!);
            }}
          >
            {data.label}
          </button>
        ) : (
          <span
            className="truncate text-xs font-semibold tracking-wide uppercase"
            style={{ color: stackColor(data.color, 100) }}
          >
            {data.label}
          </span>
        )}
        <span className="ml-auto">
          <Toggle id={id} data={data} />
        </span>
      </div>
    </div>
  );
}
