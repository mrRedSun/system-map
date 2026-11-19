import { Boxes, Network } from 'lucide-react';
import type { ReactNode } from 'react';
import type { GraphMode } from '@/lib/router';
import { cn } from '@/lib/utils';

const MODES: { mode: GraphMode; label: string; icon: typeof Boxes; hint: string }[] = [
  { mode: 'apps', label: 'Apps', icon: Boxes, hint: 'Apps and the calls between them' },
  { mode: 'infra', label: 'Infrastructure', icon: Network, hint: 'Host, guests and services' },
];

/** Segmented Apps / Infrastructure switch at the start of each graph toolbar. */
export function ModeSwitch({ mode, onMode }: { mode: GraphMode; onMode: (m: GraphMode) => void }) {
  return (
    <div role="radiogroup" aria-label="Graph" className="flex rounded-lg bg-muted p-0.5">
      {MODES.map((m) => (
        <button
          key={m.mode}
          type="button"
          role="radio"
          aria-checked={mode === m.mode}
          title={m.hint}
          onClick={() => onMode(m.mode)}
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            mode === m.mode
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <m.icon className="size-3.5" />
          <span className={cn(m.mode === 'infra' && 'hidden sm:inline')}>{m.label}</span>
          {m.mode === 'infra' && <span className="sm:hidden">Infra</span>}
        </button>
      ))}
    </div>
  );
}

/** On/off toolbar button with a line swatch, like the edge-kind toggles. */
export function SwatchToggle(p: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  title: string;
  swatch: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={p.on}
      onClick={() => p.onChange(!p.on)}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        p.on ? 'text-foreground' : 'text-muted-foreground line-through decoration-1',
      )}
      title={p.title}
      aria-label={p.label}
    >
      <span className={cn('shrink-0', !p.on && 'opacity-40')}>{p.swatch}</span>
      <span className="hidden sm:inline">{p.label}</span>
    </button>
  );
}

export function LineSwatch({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg width="18" height="6" aria-hidden className="block">
      <line x1="1" y1="3" x2="17" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dash} />
    </svg>
  );
}

export const ToolbarDivider = () => <span className="mx-0.5 h-5 w-px bg-border" />;
