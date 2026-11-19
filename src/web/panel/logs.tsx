import { Pause, Play, RotateCw, WrapText } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SseParser } from '../../shared/sse';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Line {
  key: number;
  ts: number;
  level: string;
  stream: string;
  text: string;
  note?: boolean;
}

const MAX_LINES = 2000;
const LEVEL_CLASS: Record<string, string> = {
  error: 'text-[var(--health-down)]',
  fatal: 'text-[var(--health-down)] font-semibold',
  warn: 'text-[color-mix(in_oklch,var(--health-pending),var(--foreground)_30%)]',
  debug: 'text-muted-foreground',
  trace: 'text-muted-foreground',
};

type State = 'connecting' | 'live' | 'paused' | 'ended' | 'error';

function useLogStream(host: string, container: string) {
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState<State>('connecting');
  const [message, setMessage] = useState<string>();
  const [run, setRun] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const ctrl = new AbortController();
    let key = 0;
    let pending: Line[] = [];
    let frame = 0;
    const flush = () => {
      frame = 0;
      const batch = pending;
      pending = [];
      setLines((prev) => [...prev, ...batch].slice(-MAX_LINES));
    };
    const add = (l: Omit<Line, 'key'>) => {
      pending.push({ ...l, key: Date.now() * 1000 + (key++ % 1000) });
      frame ||= requestAnimationFrame(flush);
    };
    (async () => {
      const res = await fetch(
        `/api/logs/${encodeURIComponent(host)}/${encodeURIComponent(container)}?tail=200`,
        { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } },
      );
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setState('live');
      const parser = new SseParser();
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const msg of parser.push(value)) {
          const data = JSON.parse(msg.data) as Record<string, unknown>;
          if (msg.event === 'line') add(data as unknown as Line);
          else if (msg.event === 'dropped') {
            add({
              ts: Date.now(),
              level: 'warn',
              stream: '',
              text: `… ${String(data.count)} lines skipped (rate limit)`,
              note: true,
            });
          } else if (msg.event === 'status') {
            if (data.message !== 'live')
              add({
                ts: Date.now(),
                level: 'info',
                stream: '',
                text: `— ${String(data.message)} —`,
                note: true,
              });
          } else if (msg.event === 'error' || msg.event === 'end') {
            setMessage(String(data.message));
            setState(msg.event === 'error' ? 'error' : 'ended');
          }
        }
      }
      setState((s) => (s === 'live' ? 'ended' : s));
    })().catch((err: unknown) => {
      if (ctrl.signal.aborted) return;
      setMessage(err instanceof Error ? err.message : String(err));
      setState('error');
    });

    return () => {
      ctrl.abort();
      cancelAnimationFrame(frame);
    };
  }, [host, container, run, paused]);

  // Each (re)connect replays the tail, so it starts from an empty buffer.
  const restart = useCallback(() => {
    setLines([]);
    setState('connecting');
    setMessage(undefined);
  }, []);

  return {
    lines,
    state: paused ? ('paused' as const) : state,
    message,
    paused,
    togglePause: useCallback(() => {
      if (paused) restart();
      setPaused(!paused);
    }, [paused, restart]),
    reconnect: useCallback(() => {
      restart();
      setPaused(false);
      setRun((r) => r + 1);
    }, [restart]),
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
