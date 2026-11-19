import { Pause, Play, RotateCw, WrapText } from 'lucide-react';
import { useAtomValue } from '@effect/atom-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AsyncResult, Atom } from 'effect/reactivity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { INITIAL, logKey, logStreamAtom, type LogState } from './log-stream';

const LEVEL_CLASS: Record<string, string> = {
  error: 'text-[var(--health-down)]',
  fatal: 'text-[var(--health-down)] font-semibold',
  warn: 'text-[color-mix(in_oklch,var(--health-pending),var(--foreground)_30%)]',
  debug: 'text-muted-foreground',
  trace: 'text-muted-foreground',
};

const idleAtom = Atom.make(AsyncResult.success<LogState>(INITIAL));

function useLogStream(host: string, container: string) {
  const [run, setRun] = useState(0);
  const [paused, setPaused] = useState(false);
  // Paused: nothing reads the stream atom, so its request is aborted. Each (re)connect is a
  // new run, which replays the tail into an empty buffer.
  const live = AsyncResult.getOrElse(
    useAtomValue(paused ? idleAtom : logStreamAtom(logKey(host, container, run))),
    () => INITIAL,
  );
  // While paused, the lines received so far stay on screen.
  const [frozen, setFrozen] = useState<LogState>(INITIAL);
  const { lines, message } = paused ? frozen : live;
  const state = paused ? ('paused' as const) : live.state;

  return {
    lines,
    state,
    message,
    paused,
    togglePause: useCallback(() => {
      if (paused) setRun((r) => r + 1);
      else setFrozen(live);
      setPaused(!paused);
    }, [paused, live]),
    reconnect: useCallback(() => {
      setPaused(false);
      setRun((r) => r + 1);
    }, []),
  };
}

const time = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export function LogsTab({ host, container }: { host: string; container: string }) {
  const { lines, state, message, paused, togglePause, reconnect } = useLogStream(host, container);
  const [filter, setFilter] = useState('');
  const [wrap, setWrap] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const q = filter.trim().toLowerCase();
  const shown = q ? lines.filter((l) => l.note || l.text.toLowerCase().includes(q)) : lines;

  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-64 flex-col gap-2 sm:h-[calc(100dvh-15rem)]">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            state === 'live'
              ? 'animate-pulse bg-[var(--health-up)]'
              : state === 'error'
                ? 'bg-[var(--health-down)]'
                : 'bg-muted-foreground',
          )}
          aria-hidden
        />
        <span className="text-xs text-muted-foreground">
          {state} ·{' '}
          <span className="font-mono">
            {host}/{container}
          </span>
        </span>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter"
          className="ml-auto h-7 w-28 text-xs sm:w-40"
          aria-label="Filter log lines"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={wrap}
          onClick={() => setWrap(!wrap)}
          aria-label="Wrap lines"
          title="Wrap lines"
        >
          <WrapText />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={togglePause}
          aria-label={paused ? 'Resume' : 'Pause'}
          title={paused ? 'Resume' : 'Pause'}
        >
          {paused ? <Play /> : <Pause />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={reconnect}
          aria-label="Reconnect"
          title="Reconnect"
        >
          <RotateCw />
        </Button>
      </div>
      {message && (
        <p
          className={cn(
            'rounded-md p-2 text-xs',
            state === 'error'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {message}
        </p>
      )}
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/30 p-2 font-mono text-[12px] leading-[1.45]"
        role="log"
        aria-live="off"
      >
        {shown.length === 0 && state !== 'error' && (
          <div className="text-muted-foreground">
            {state === 'connecting' ? 'Connecting…' : 'No lines yet.'}
          </div>
        )}
        {shown.map((l) => (
          <div key={l.key} className={cn('flex gap-2', l.note && 'text-muted-foreground italic')}>
            <span className="shrink-0 text-muted-foreground select-none">{time(l.ts)}</span>
            <span
              className={cn(
                'min-w-0',
                wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre',
                LEVEL_CLASS[l.level],
                l.stream === 'stderr' && !LEVEL_CLASS[l.level] && 'text-[var(--edge-routes)]',
              )}
            >
              {l.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
