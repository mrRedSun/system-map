import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { EDGE_KINDS, type Edge, type EdgeKind, type SystemModel } from '../../shared/model';
import { useApp } from '@/app-context';
import { EntityLink } from '@/components/EntityLink';
import { Empty, FieldList, Section } from '@/components/Fields';
import { Markdown } from '@/components/Markdown';
import { Button } from '@/components/ui/button';
import { formatHash } from '@/lib/router';

const OUT_LABEL: Record<EdgeKind, string> = {
  contains: 'Contains',
  'runs-on': 'Runs on',
  calls: 'Calls',
  'routes-to': 'Routes to',
  mounts: 'Mounts',
  monitors: 'Monitors',
  'backs-up': 'Backs up',
};
const IN_LABEL: Record<EdgeKind, string> = {
  contains: 'Inside',
  'runs-on': 'Runs here',
  calls: 'Called by',
  'routes-to': 'Routed from',
  mounts: 'Mounted by',
  monitors: 'Monitored by',
  'backs-up': 'Backed up by',
};

export function EntityProblems({ id }: { id: string }) {
  const { model, location } = useApp();
  const problems = model.problems.filter((p) => p.entity === id);
  if (problems.length === 0) return null;
  return (
    <a
      href={formatHash({ view: 'problems', entity: location.entity })}
      className="block rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-sm hover:bg-destructive/10"
    >
      {problems.map((p, i) => (
        <div key={i} className="flex gap-2">
          <span className={p.severity === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
            {p.severity}
          </span>
          <span className="min-w-0 break-words">{p.message}</span>
        </div>
      ))}
    </a>
  );
}

const HEADER_KEYS = ['id', 'name', 'title', 'description', 'notes', 'question'];

export function OverviewTab({ id }: { id: string }) {
  const { index } = useApp();
  const ref = index.byId.get(id);
  if (!ref) return null;
  const e = ref.entity as Record<string, unknown>;
  return (
    <div className="flex flex-col gap-5">
      <EntityProblems id={id} />
      {typeof e.question === 'string' && <p className="text-base font-medium">{e.question}</p>}
      {typeof e.notes === 'string' && <Markdown>{e.notes}</Markdown>}
      <FieldList data={e} omit={HEADER_KEYS} />
    </div>
  );
}

function EdgeGroups({ edges, dir }: { edges: Edge[]; dir: 'out' | 'in' }) {
  const groups = EDGE_KINDS.map((kind) => [kind, edges.filter((e) => e.kind === kind)] as const);
  return (
    <>
      {groups
        .filter(([, list]) => list.length > 0)
        .map(([kind, list]) => (
          <Section key={kind} title={(dir === 'out' ? OUT_LABEL : IN_LABEL)[kind]}>
            <ul className="flex flex-col gap-1">
              {list.map((e) => (
                <li key={e.id} className="flex min-w-0 items-baseline gap-2 text-sm">
                  <EntityLink id={dir === 'out' ? e.target : e.source} showId />
                  {e.label && kind !== 'routes-to' && (
                    <span className="truncate text-xs text-muted-foreground">{e.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        ))}
    </>
  );
}

export function ConnectionsTab({ id }: { id: string }) {
  const { index, backRefs, model } = useApp();
  const out = index.outgoing.get(id) ?? [];
  const inc = index.incoming.get(id) ?? [];
  const refs = backRefs.get(id) ?? [];
  const ref = index.byId.get(id);
  const external =
    ref?.section === 'services'
      ? ((ref.entity as SystemModel['services'][number]).calls ?? []).filter(
          (c) => !index.byId.has(c.target),
        )
      : [];
  if (out.length + inc.length + refs.length + external.length === 0) {
    return <Empty>No connections.</Empty>;
  }
  return (
    <div className="flex flex-col gap-5">
      <EdgeGroups edges={out} dir="out" />
      {external.length > 0 && (
        <Section title="Calls outside the model">
          <ul className="flex flex-col gap-1 text-sm">
            {external.map((c, i) => (
              <li key={i}>
                {c.target}
                {(c.via || c.purpose) && (
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    {[c.via, c.purpose].filter(Boolean).join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <EdgeGroups edges={inc} dir="in" />
      {refs.length > 0 && (
        <Section title="Mentioned by">
          <ul className="flex flex-col gap-1">
            {refs
              .filter((r) => model.history.every((h) => h.id !== r.from))
              .map((r) => (
                <li key={`${r.from}:${r.field}`} className="text-sm">
                  <EntityLink id={r.from} showId />
                </li>
              ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export function HistoryList({ entries }: { entries: SystemModel['history'] }) {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <ol className="relative flex flex-col gap-4 border-l pl-4">
      {sorted.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-muted-foreground" />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <time className="font-mono text-xs text-muted-foreground">{h.date}</time>
            <EntityLink id={h.id} showIcon={false} className="font-medium" />
          </div>
          {h.summary && <Markdown className="mt-1">{h.summary}</Markdown>}
          {h.rollback && (
            <div className="mt-1.5 rounded-md bg-muted/50 p-2">
              <div className="text-xs font-medium text-muted-foreground">Rollback</div>
              <Markdown>{h.rollback}</Markdown>
            </div>
          )}
          {h.refs && h.refs.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {h.refs.map((r) => (
                <EntityLink key={r} id={r} />
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

export function HistoryTab({ id }: { id: string }) {
  const { model } = useApp();
  const entries = model.history.filter((h) => h.refs?.includes(id));
  if (entries.length === 0) return <Empty>No history entries mention this.</Empty>;
  return <HistoryList entries={entries} />;
}

export function RawTab({ id }: { id: string }) {
  const { model } = useApp();
  const [copied, setCopied] = useState(false);
  const source = model.sources[id];
  if (!source) return <Empty>No source available.</Empty>;
  const copy = () => {
    void navigator.clipboard?.writeText(source.raw).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">
          {source.file}:{source.line}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          onClick={copy}
          aria-label="Copy YAML"
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 font-mono text-[12.5px] leading-relaxed">
        {source.raw}
      </pre>
    </div>
  );
}
