import { AlertTriangle, CircleAlert, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SECTION_KIND, SECTIONS, type Problem } from '../../shared/model';
import type { SectionKey } from '../../shared/schema';
import { useApp } from '@/app-context';
import { EntityLink } from '@/components/EntityLink';
import { Empty, Section, Value } from '@/components/Fields';
import { Markdown } from '@/components/Markdown';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Cell, FirewallTable, RouteCard, Table } from '@/panel/network';
import { HistoryList } from '@/panel/tabs';
import { displayName, statusOf } from '@/lib/model-index';
import { cn } from '@/lib/utils';
import { kindLabel } from '@/lib/visuals';

export function Page({
  title,
  count,
  children,
  actions,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          {count !== undefined && <Badge variant="secondary">{count}</Badge>}
          <div className="ml-auto">{actions}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border bg-card p-4', className)}>{children}</div>;
}

/** One line summarising where an entity lives or points to. */
function placeOf(section: SectionKey, e: Record<string, unknown>) {
  if (section === 'nodes') return e.parent as string | undefined;
  if (section === 'services' || section === 'jobs') return e.node as string | undefined;
  if (section === 'routes' || section === 'monitors') return (e.target ?? e.service) as string;
  return undefined;
}

function summaryOf(section: SectionKey, e: Record<string, unknown>): string {
  if (section === 'nodes') return ((e.ips as string[] | undefined) ?? []).join(', ');
  if (section === 'services') {
    const ports = (e.ports as { port: unknown; proto?: string }[] | undefined) ?? [];
    return ports.map((p) => `${String(p.port)}/${p.proto ?? 'tcp'}`).join(', ');
  }
  if (section === 'routes') return String(e.host ?? '');
  if (section === 'networks') return String(e.cidr ?? '');
  if (section === 'zones') return String(e.domain ?? '');
  if (section === 'jobs') return String(e.schedule ?? '');
  if (section === 'history') return String(e.date ?? '');
  return '';
}

export function EntitiesView() {
  const { model, index } = useApp();
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<Set<SectionKey>>(new Set());
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...index.byId.values()].filter((r) => {
      if (kinds.size > 0 && !kinds.has(r.section)) return false;
      if (!q) return true;
      return `${r.id} ${displayName(r)} ${kindLabel(r)} ${summaryOf(r.section, r.entity as Record<string, unknown>)}`
        .toLowerCase()
        .includes(q);
    });
  }, [index, query, kinds]);

  return (
    <Page title="All entities" count={rows.length}>
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by id, name, kind, IP, port…"
            className="pl-8"
            aria-label="Filter entities"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SECTIONS.filter((s) => model[s].length > 0).map((s) => {
            const on = kinds.has(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = new Set(kinds);
                  if (on) next.delete(s);
                  else next.add(s);
                  setKinds(next);
                }}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
              >
                {SECTION_KIND[s]} <span className="opacity-60">{model[s].length}</span>
              </button>
            );
          })}
        </div>
      </div>
      <Table head={['Name', 'Kind', 'Where', 'Summary', 'Status']}>
        {rows.map((r) => {
          const e = r.entity as Record<string, unknown>;
          const place = placeOf(r.section, e);
          return (
            <tr key={r.id} className="hover:bg-muted/40">
              <Cell>
                <EntityLink id={r.id} showId />
              </Cell>
              <Cell>{kindLabel(r)}</Cell>
              <Cell>{place ? <EntityLink id={place} /> : undefined}</Cell>
              <Cell mono>{summaryOf(r.section, e) || undefined}</Cell>
              <Cell>{statusOf(r.entity)}</Cell>
            </tr>
          );
        })}
      </Table>
    </Page>
  );
}

export function RoutesView() {
  const { model } = useApp();
  const byHost = [...model.routes].sort((a, b) => a.host.localeCompare(b.host));
  return (
    <Page title="Routes" count={model.routes.length}>
      {byHost.length === 0 ? (
        <Empty>No routes.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {byHost.map((r) => (
            <div key={r.id} className="flex flex-col gap-1">
              <RouteCard route={r} />
              <div className="flex items-center gap-1.5 pl-2.5 text-xs text-muted-foreground">
                → <EntityLink id={r.target} />
              </div>
            </div>
          ))}
        </div>
      )}
      {model.zones.map((z) => (
        <Card key={z.id} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <EntityLink id={z.id} className="font-semibold" />
            <span className="font-mono text-sm text-muted-foreground">{z.domain}</span>
            {z.provider && <Badge variant="outline">{z.provider}</Badge>}
            {z.plan && <Badge variant="outline">{z.plan}</Badge>}
          </div>
          {z.records && z.records.length > 0 && (
            <Section title="DNS records">
              <Table head={['Name', 'Type', 'Value', 'Proxied']}>
                {z.records.map((rec, i) => (
                  <tr key={i}>
                    <Cell mono>{rec.name}</Cell>
                    <Cell>{rec.type}</Cell>
                    <Cell mono>{rec.value}</Cell>
                    <Cell>
                      {rec.proxied === undefined ? undefined : rec.proxied ? 'yes' : 'no'}
                    </Cell>
                  </tr>
                ))}
              </Table>
            </Section>
          )}
          {z.rules && z.rules.length > 0 && (
            <Section title="Rules">
              <Value value={z.rules} />
            </Section>
          )}
          {z.workers && z.workers.length > 0 && (
            <Section title="Workers">
              <Value value={z.workers} />
            </Section>
          )}
          {z.settings && (
            <Section title="Settings">
              <Value value={z.settings} />
            </Section>
          )}
        </Card>
      ))}
    </Page>
  );
}

export function FirewallView() {
  const { model } = useApp();
  const nodes = model.nodes.filter((n) => n.firewall);
  return (
    <Page title="Firewall" count={nodes.length}>
      {nodes.length === 0 && <Empty>No firewall configuration in the data.</Empty>}
      {nodes.map((n) => (
        <Card key={n.id} className="flex flex-col gap-3">
          <EntityLink id={n.id} showId className="font-semibold" />
          <FirewallTable firewall={n.firewall!} />
        </Card>
      ))}
      {model.zones.some((z) => z.rules?.length) && (
        <Section title="Edge rules (DNS/CDN)">
          {model.zones
            .filter((z) => z.rules?.length)
            .map((z) => (
              <Card key={z.id} className="flex flex-col gap-2">
                <EntityLink id={z.id} />
                <Value value={z.rules} />
              </Card>
            ))}
        </Section>
      )}
    </Page>
  );
}

export function JobsView() {
  const { model } = useApp();
  return (
    <Page title="Jobs & backups" count={model.jobs.length + model.backups.length}>
      <Section title="Scheduled jobs">
        {model.jobs.length === 0 ? (
          <Empty>No jobs.</Empty>
        ) : (
          <Table head={['Job', 'Node', 'Schedule', 'Command', 'Notifies']}>
            {model.jobs.map((j) => (
              <tr key={j.id}>
                <Cell>
                  <EntityLink id={j.id} showIcon={false} />
                  {j.purpose && <div className="text-xs text-muted-foreground">{j.purpose}</div>}
                </Cell>
                <Cell>
                  <EntityLink id={j.node} />
                </Cell>
                <Cell mono>{j.schedule}</Cell>
                <Cell mono>{j.command}</Cell>
                <Cell>{j.notifies === undefined ? undefined : <Value value={j.notifies} />}</Cell>
              </tr>
            ))}
          </Table>
        )}
      </Section>
      <Section title="Backups">
        {model.backups.length === 0 && <Empty>No backups.</Empty>}
        <div className="grid gap-3 md:grid-cols-2">
          {model.backups.map((b) => (
            <Card key={b.id} className="flex flex-col gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <EntityLink id={b.id} showIcon={false} className="font-semibold" />
                {b.offsite && <Badge variant="secondary">offsite</Badge>}
                {b.encrypted && <Badge variant="secondary">encrypted</Badge>}
                {b.offsite === false && <Badge variant="outline">local only</Badge>}
              </div>
              <div>{b.what}</div>
              <div className="font-mono text-xs text-muted-foreground">
                → {b.to}
                {b.schedule && ` · ${b.schedule}`}
                {b.retention && ` · ${b.retention}`}
              </div>
              {b.from && b.from.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {b.from.map((f) => (
                    <EntityLink key={f} id={f} />
                  ))}
                </div>
              )}
              {b.restore && (
                <div className="rounded-md bg-muted/50 p-2">
                  <div className="text-xs font-medium text-muted-foreground">Restore</div>
                  <Markdown>{b.restore}</Markdown>
                </div>
              )}
            </Card>
          ))}
        </div>
      </Section>
    </Page>
  );
}

export function PoliciesView() {
  const { model } = useApp();
  return (
    <Page title="Policies & procedures" count={model.policies.length + model.procedures.length}>
      <Section title="Policies">
        {model.policies.length === 0 && <Empty>No policies.</Empty>}
        {model.policies.map((p) => (
          <Card key={p.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <EntityLink id={p.id} showIcon={false} className="font-semibold" />
              {p.since && <span className="text-xs text-muted-foreground">since {p.since}</span>}
            </div>
            <Markdown>{p.rule}</Markdown>
            {p.why && (
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">Why: </span>
                {p.why}
              </div>
            )}
            {p.scope && p.scope.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {p.scope.map((s) => (
                  <EntityLink key={s} id={s} />
                ))}
              </div>
            )}
          </Card>
        ))}
      </Section>
      <Section title="Procedures">
        {model.procedures.length === 0 && <Empty>No procedures.</Empty>}
        {model.procedures.map((p) => (
          <Card key={p.id} className="flex flex-col gap-2">
            <EntityLink id={p.id} showIcon={false} className="font-semibold" />
            <Markdown>{p.body}</Markdown>
            {p.applies_to && p.applies_to.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                <span className="text-muted-foreground">Applies to</span>
                {p.applies_to.map((s) => (
                  <EntityLink key={s} id={s} />
                ))}
              </div>
            )}
          </Card>
        ))}
      </Section>
    </Page>
  );
}

export function HistoryView() {
  const { model } = useApp();
  return (
    <Page title="History" count={model.history.length}>
      {model.history.length === 0 ? (
        <Empty>No history yet.</Empty>
      ) : (
        <HistoryList entries={model.history} />
      )}
    </Page>
  );
}

export function QuestionsView() {
  const { model, hrefFor } = useApp();
  return (
    <Page title="Open questions" count={model.open_questions.length}>
      {model.open_questions.length === 0 && <Empty>No open questions.</Empty>}
      {model.open_questions.map((q) => (
        <Card key={q.id} className="flex flex-col gap-2">
          <a href={hrefFor(q.id)} className="font-medium hover:underline">
            {q.question}
          </a>
          {q.notes && <Markdown>{q.notes}</Markdown>}
          {q.refs && q.refs.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {q.refs.map((r) => (
                <EntityLink key={r} id={r} />
              ))}
            </div>
          )}
        </Card>
      ))}
    </Page>
  );
}

export function ProblemList({ problems }: { problems: Problem[] }) {
  return (
    <ul className="divide-y rounded-xl border">
      {problems.map((p, i) => {
        const Icon = p.severity === 'error' ? CircleAlert : AlertTriangle;
        return (
          <li key={i} className="flex gap-3 p-3 text-sm">
            <Icon
              className={cn(
                'mt-0.5 size-4 shrink-0',
                p.severity === 'error' ? 'text-destructive' : 'text-[var(--health-pending)]',
              )}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="break-words">{p.message}</span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {p.file && (
                  <span className="font-mono">
                    {p.file}
                    {p.line ? `:${p.line}` : ''}
                  </span>
                )}
                {p.path && <span className="font-mono">{p.path}</span>}
                <Badge variant="outline">{p.code}</Badge>
                {p.entity && <EntityLink id={p.entity} />}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ProblemsView() {
  const { model } = useApp();
  const errors = model.problems.filter((p) => p.severity === 'error');
  const warnings = model.problems.filter((p) => p.severity === 'warning');
  return (
    <Page title="Validation problems" count={model.problems.length}>
      {model.stale && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-3 text-sm">
          The data files currently fail to parse. The map shows the last good version from{' '}
          <span className="font-mono">{model.loadedAt}</span>.
        </div>
      )}
      {model.problems.length === 0 && (
        <Empty>
          No problems in {model.files.length} files ({Object.keys(model.sources).length} entities).
        </Empty>
      )}
      {errors.length > 0 && (
        <Section title={`Errors (${errors.length})`}>
          <ProblemList problems={errors} />
        </Section>
      )}
      {warnings.length > 0 && (
        <Section title={`Warnings (${warnings.length})`}>
          <ProblemList problems={warnings} />
        </Section>
      )}
    </Page>
  );
}
