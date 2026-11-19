/**
 * Wiki: readable pages generated from the model (home, stacks, apps, nodes, articles, indexes).
 * Everything here is derived from the same data as the graph; nothing is stored separately.
 */
import { useAtomValue } from '@effect/atom-react';
import { BookText, ChevronRight, Menu, Network, Printer, ScrollText } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SystemModel } from '../../shared/model';
import { useApp } from '@/app-context';
import { EntityIcon } from '@/components/EntityIcon';
import { EntityLink } from '@/components/EntityLink';
import { Markdown } from '@/components/Markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GraphView } from '@/graph/GraphView';
import { hostLabel } from '@/graph/apps';
import { HealthDot } from '@/graph/nodes';
import { healthAtom, healthStateOf } from '@/lib/health';
import { displayName, indexModel } from '@/lib/model-index';
import { formatHash, WIKI_INDEXES, type WikiIndex } from '@/lib/router';
import { cn } from '@/lib/utils';
import { HealthTab } from '@/panel/health';
import { PortsTable, RouteCard } from '@/panel/network';
import { HistoryList, OverviewTab } from '@/panel/tabs';
import {
  OTHER,
  coverage,
  coverageRatio,
  glance,
  healthSummary,
  isRetired,
  jobsNear,
  mentions,
  nodeTree,
  sortedArticles,
  stackGroups,
  stackModel,
  type StackGroup,
} from './data';

type Service = SystemModel['services'][number];
type Node = SystemModel['nodes'][number];

const INDEX_TITLES: Record<WikiIndex, string> = {
  articles: 'Articles',
  policies: 'Policies',
  procedures: 'Procedures',
  history: 'History',
  questions: 'Open questions',
  coverage: 'Documentation coverage',
};

const wikiHref = (page?: string) => formatHash({ view: 'wiki', ...(page ? { page } : {}) });
const OTHER_PAGE = 'ref/other';

export function WikiView({ page }: { page?: string }) {
  const [navOpen, setNavOpen] = useState(false);
  const article = useRef<HTMLElement>(null);
  return (
    <div className="flex h-full print:block print:h-auto">
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r bg-muted/20 lg:block print:hidden">
        <WikiNav page={page} />
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto print:overflow-visible" key={page ?? ''}>
        <div className="mx-auto flex max-w-5xl gap-8 px-4 py-5 sm:px-8 sm:py-8">
          <article ref={article} className="wiki min-w-0 flex-1">
            <div className="mb-4 flex items-center gap-2 lg:hidden print:hidden">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNavOpen(!navOpen)}
                aria-expanded={navOpen}
              >
                <Menu /> Contents
              </Button>
            </div>
            {navOpen && (
              <div className="mb-6 rounded-xl border lg:hidden print:hidden">
                <WikiNav page={page} onNavigate={() => setNavOpen(false)} />
              </div>
            )}
            <WikiPage page={page} />
          </article>
          <Toc container={article} page={page} />
        </div>
      </div>
    </div>
  );
}

function WikiPage({ page }: { page?: string }) {
  const { index } = useApp();
  if (!page) return <HomePage />;
  if (page === OTHER_PAGE) return <StackPage id={OTHER} />;
  if (page.startsWith('ref/')) {
    const name = page.slice(4) as WikiIndex;
    return WIKI_INDEXES.includes(name) ? <IndexPage name={name} /> : <NotFound page={page} />;
  }
  const ref = index.byId.get(page);
  if (!ref) return <NotFound page={page} />;
  switch (ref.section) {
    case 'stacks':
      return <StackPage id={page} />;
    case 'services':
      return <ServicePage service={ref.entity as Service} />;
    case 'nodes':
      return <NodePage node={ref.entity as Node} />;
    case 'articles':
      return <ArticlePage article={ref.entity as SystemModel['articles'][number]} />;
    default:
      return <EntityPage id={page} />;
  }
}

// ---------------------------------------------------------------------------------------------
// Layout pieces

function WikiNav({ page, onNavigate }: { page?: string; onNavigate?: () => void }) {
  const { model } = useApp();
  const groups = useMemo(() => stackGroups(model), [model]);
  const nodes = useMemo(() => nodeTree(model), [model]);
  const articles = useMemo(() => sortedArticles(model), [model]);
  const item = (href: string, label: React.ReactNode, active: boolean, depth = 0) => (
    <a
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
        active && 'bg-muted font-medium text-foreground',
      )}
      style={depth ? { paddingLeft: `${0.5 + depth * 0.75}rem` } : undefined}
    >
      {label}
    </a>
  );
  return (
    <nav className="flex flex-col gap-4 p-3" aria-label="Wiki">
      <div>
        {item(
          wikiHref(),
          <>
            <BookText className="size-4" /> System at a glance
          </>,
          !page,
        )}
      </div>
      <NavGroup title="Stacks">
        {groups.map((g) => (
          <StackNav key={g.id} group={g} page={page} item={item} />
        ))}
      </NavGroup>
      <NavGroup title="Machines">
        {nodes.map(({ node, depth }) => (
          <div key={node.id}>
            {item(
              wikiHref(node.id),
              <span className={cn('truncate', node.status === 'retired' && 'line-through')}>
                {node.name ?? node.id}
              </span>,
              page === node.id,
              depth,
            )}
          </div>
        ))}
      </NavGroup>
      {articles.length > 0 && (
        <NavGroup title="Articles">
          {articles.map((a) => (
            <div key={a.id}>
              {item(wikiHref(a.id), <span className="truncate">{a.title}</span>, page === a.id)}
            </div>
          ))}
        </NavGroup>
      )}
      <NavGroup title="Reference">
        {WIKI_INDEXES.filter((n) => n !== 'articles').map((n) => (
          <div key={n}>{item(wikiHref(`ref/${n}`), INDEX_TITLES[n], page === `ref/${n}`)}</div>
        ))}
      </NavGroup>
    </nav>
  );
}

function NavGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function StackNav({
  group,
  page,
  item,
}: {
  group: StackGroup;
  page?: string;
  item: (href: string, label: React.ReactNode, active: boolean, depth?: number) => React.ReactNode;
}) {
  const href = group.stack ? group.id : OTHER_PAGE;
  const inside = page === href || group.apps.some((a) => a.id === page);
  const [open, setOpen] = useState(inside);
  if (inside && !open) setOpen(true);
  return (
    <div>
      <div className="flex items-center">
        <button
          type="button"
          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Collapse' : 'Expand'}
          aria-expanded={open}
        >
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </button>
        <div className="min-w-0 flex-1">
          {item(
            wikiHref(href),
            <span className="truncate">{group.stack?.name ?? group.stack?.id ?? 'Other'}</span>,
            page === href,
          )}
        </div>
      </div>
      {open &&
        group.apps.map((a) => (
          <div key={a.id}>
            {item(wikiHref(a.id), <span className="truncate">{a.name}</span>, page === a.id, 2)}
          </div>
        ))}
    </div>
  );
}

/** "On this page": the h2/h3 headings of the article, after it rendered. */
function Toc({
  container,
  page,
}: {
  container: React.RefObject<HTMLElement | null>;
  page?: string;
}) {
  const { model } = useApp();
  const [items, setItems] = useState<{ id: string; text: string; level: number }[]>([]);
  useEffect(() => {
    // Read the headings once the page has rendered (sections depend on data and health).
    const frame = requestAnimationFrame(() => {
      const el = container.current;
      if (!el) return;
      const found = [...el.querySelectorAll<HTMLHeadingElement>('h2, h3')].map((h, i) => {
        if (!h.id) h.id = `wiki-h-${i}`;
        return { id: h.id, text: h.textContent ?? '', level: h.tagName === 'H2' ? 2 : 3 };
      });
      setItems(found);
    });
    return () => cancelAnimationFrame(frame);
  }, [container, page, model]);
  if (items.length < 3) return null;
  return (
    <nav
      className="sticky top-8 hidden max-h-[calc(100dvh-8rem)] w-48 shrink-0 self-start overflow-y-auto xl:block print:hidden"
      aria-label="On this page"
    >
      <div className="pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        On this page
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((t) => (
          <li key={t.id} className={cn(t.level === 3 && 'pl-3')}>
            <button
              type="button"
              className="text-left text-muted-foreground hover:text-foreground"
              onClick={() =>
                document
                  .getElementById(t.id)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              {t.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Crumbs({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground print:hidden"
    >
      <a href={wikiHref()} className="hover:text-foreground">
        Wiki
      </a>
      {trail.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRight className="size-3" />
          {c.href ? (
            <a href={c.href} className="hover:text-foreground">
              {c.label}
            </a>
          ) : (
            <span className="text-foreground">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function Title({
  id,
  children,
  actions,
  sub,
}: {
  id?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  sub?: React.ReactNode;
}) {
  const { index, healthOf } = useApp();
  const ref = id ? index.byId.get(id) : undefined;
  return (
    <header className="mb-6 flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-3">
        {ref && (
          <EntityIcon entity={ref} className="mt-1.5 size-6 shrink-0 text-muted-foreground" />
        )}
        <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          {children}
          {id && <HealthDot status={healthOf(id)} className="ml-2 align-middle" />}
        </h1>
        <div className="flex items-center gap-1 print:hidden">
          {actions}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => window.print()}
            aria-label="Print"
            title="Print"
          >
            <Printer />
          </Button>
        </div>
      </div>
      {sub}
    </header>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-9 mb-3 scroll-mt-4 border-b pb-1.5 text-lg font-semibold tracking-tight">
      {children}
    </h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-5 mb-2 scroll-mt-4 text-base font-semibold">{children}</h3>;
}

/** A visible gap in the documentation, with the field that would fill it. */
function Gap({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground italic">
      {children}
    </p>
  );
}

function Lead({ text, field }: { text?: string; field: string }) {
  if (!text)
    return (
      <Gap>
        No summary yet. Add <code>{field}</code> to say in a sentence what this is for.
      </Gap>
    );
  return <Markdown className="text-base leading-relaxed [&_p]:my-0">{text}</Markdown>;
}

function Prose({ children }: { children?: string }) {
  return <Markdown className="wiki-prose text-[15px] leading-relaxed">{children}</Markdown>;
}

function SimpleTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t align-top">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GraphLink({ id, mode }: { id: string; mode: 'apps' | 'infra' }) {
  return (
    <Button variant="ghost" size="sm" asChild>
      <a href={formatHash({ view: 'graph', graph: mode, entity: id })}>
        <Network /> <span className="hidden sm:inline">Open in graph</span>
      </a>
    </Button>
  );
}

function NotFound({ page }: { page: string }) {
  return (
    <>
      <Crumbs trail={[{ label: page }]} />
      <Gap>
        No page called <code>{page}</code>.
      </Gap>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Pages

function HomePage() {
  const { model, healthOf } = useApp();
  const health = healthStateOf(useAtomValue(healthAtom));
  const counts = glance(model);
  const groups = stackGroups(model);
  const summary = healthSummary(model, healthOf);
  const articles = sortedArticles(model);
  const history = [...model.history].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const ratio = coverageRatio(model);
  return (
    <>
      <Title
        sub={
          model.meta.description ? (
            <p className="text-muted-foreground">{model.meta.description}</p>
          ) : undefined
        }
      >
        {model.meta.title ?? 'System'} at a glance
      </Title>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(
          [
            ['Guests', counts.guests],
            ['Apps', counts.apps],
            ['Public routes', counts.publicRoutes],
            ['Monitors', counts.monitors],
            ['Jobs', counts.jobs],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="rounded-xl border bg-card px-3 py-2.5">
            <div className="text-2xl font-semibold tabular-nums">{n}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <H2>Health</H2>
      {health.error && !health.loaded ? null : health.error ? (
        <Gap>Uptime Kuma: {health.error}</Gap>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            {summary.down.length === 0 && summary.pending.length === 0
              ? `All monitored apps are up (${summary.up}).`
              : `${summary.up} up, ${summary.down.length} down, ${summary.pending.length} pending.`}{' '}
            {summary.unknown > 0 && (
              <span className="text-muted-foreground">{summary.unknown} apps have no monitor.</span>
            )}
          </p>
          {[...summary.down, ...summary.pending].length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {[...summary.down, ...summary.pending].map((id) => (
                <EntityLink key={id} id={id} />
              ))}
            </div>
          )}
        </div>
      )}

      <H2>Stacks</H2>
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((g) => (
          <a
            key={g.id}
            href={wikiHref(g.stack ? g.id : OTHER_PAGE)}
            className="flex flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{g.stack?.name ?? g.stack?.id ?? 'Other'}</span>
              <Badge variant="secondary">{g.apps.length}</Badge>
            </div>
            {g.stack?.summary ? (
              <p className="text-sm text-muted-foreground">{g.stack.summary}</p>
            ) : g.stack ? (
              <p className="text-sm text-muted-foreground italic">No summary yet.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Apps without a stack.</p>
            )}
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {g.apps.slice(0, 10).map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1">
                  {a.name}
                  <HealthDot status={healthOf(a.id)} />
                </span>
              ))}
              {g.apps.length > 10 && <span>+{g.apps.length - 10} more</span>}
            </div>
          </a>
        ))}
      </div>

      <H2>Articles</H2>
      {articles.length === 0 ? (
        <Gap>
          No articles yet. Add an <code>articles:</code> list to explain how things work.
        </Gap>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {articles.map((a) => (
            <li key={a.id}>
              <a href={wikiHref(a.id)} className="inline-flex items-center gap-1.5 hover:underline">
                <ScrollText className="size-4 text-muted-foreground" /> {a.title}
              </a>
            </li>
          ))}
        </ul>
      )}

      {model.open_questions.length > 0 && (
        <>
          <H2>Open questions</H2>
          <QuestionList questions={model.open_questions} />
        </>
      )}

      <H2>Recent changes</H2>
      {history.length === 0 ? (
        <Gap>No history entries yet.</Gap>
      ) : (
        <HistoryList entries={history} />
      )}
      <p className="mt-3 text-sm">
        <a href={wikiHref('ref/history')} className="text-muted-foreground hover:text-foreground">
          All history →
        </a>
      </p>

      <p className="mt-10 text-sm text-muted-foreground">
        {ratio.documented} of {ratio.total} apps, machines and stacks have a summary.{' '}
        <a href={wikiHref('ref/coverage')} className="underline">
          See what is missing
        </a>
        .
      </p>
    </>
  );
}

function StackPage({ id }: { id: string }) {
  const { model, index, healthOf } = useApp();
  const group = stackGroups(model).find((g) => g.id === id);
  const sub = useMemo(() => stackModel(model, index, id), [model, index, id]);
  const subIndex = useMemo(() => indexModel(sub), [sub]);
  if (!group) return <NotFound page={id} />;
  const stack = group.stack;
  const name = stack?.name ?? stack?.id ?? 'Other apps';
  return (
    <>
      <Crumbs trail={[{ label: 'Stacks' }, { label: name }]} />
      <Title id={stack?.id}>{name}</Title>
      {stack ? (
        <Lead text={stack.summary} field="summary" />
      ) : (
        <p className="text-muted-foreground">Apps that do not belong to a stack.</p>
      )}
      {stack && (
        <>
          <H2>How it works</H2>
          {stack.description ? (
            <Prose>{stack.description}</Prose>
          ) : (
            <Gap>
              Not documented yet. Add <code>description</code> (markdown) to this stack to explain
              how it fits together.
            </Gap>
          )}
        </>
      )}
      {group.apps.length > 0 && (
        <>
          <H2>Map</H2>
          <div className="h-96 overflow-hidden rounded-xl border sm:h-[30rem] print:hidden">
            <GraphView
              model={sub}
              index={subIndex}
              onSelect={(sel) => sel && (window.location.hash = wikiHref(sel))}
              healthOf={healthOf}
              mode="apps"
              onMode={() => undefined}
              embedded
            />
          </div>
        </>
      )}
      <H2>Apps</H2>
      {group.apps.length === 0 ? (
        <Gap>No apps in this stack.</Gap>
      ) : (
        <SimpleTable
          head={['App', 'What it does', 'Runs on', 'Open']}
          rows={group.apps.map((a) => {
            const node = index.byId.get(a.node)?.entity as Node | undefined;
            const url = a.urls?.find((u) => !u.internal) ?? a.urls?.[0];
            return [
              <EntityLink key="n" id={a.id} />,
              a.summary ?? <span className="text-muted-foreground italic">No summary yet</span>,
              <span key="h" className="font-mono text-xs whitespace-nowrap">
                {hostLabel(node) ?? a.node}
              </span>,
              url ? (
                <a
                  key="u"
                  href={url.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs break-all underline"
                >
                  {url.label ?? new URL(url.url).host}
                </a>
              ) : null,
            ];
          })}
        />
      )}
    </>
  );
}

function ServicePage({ service: s }: { service: Service }) {
  const { model, index } = useApp();
  const health = healthStateOf(useAtomValue(healthAtom));
  const node = index.byId.get(s.node)?.entity as Node | undefined;
  const stack = s.stack ? model.stacks.find((x) => x.id === s.stack) : undefined;
  const routes = model.routes.filter((r) => r.target === s.id);
  const routeIds = new Set(routes.map((r) => r.id));
  const callers = model.services.flatMap((o) =>
    (o.calls ?? [])
      .filter((c) => c.target === s.id || routeIds.has(c.target))
      .map((c) => ({ from: o, call: c })),
  );
  const m = mentions(model, s.id);
  const jobs = jobsNear(model, index, s.id);
  const retired = isRetired(index, s.id);
  return (
    <>
      <Crumbs
        trail={[
          { label: 'Stacks' },
          stack
            ? { label: stack.name ?? stack.id, href: wikiHref(stack.id) }
            : { label: 'Other', href: wikiHref(OTHER_PAGE) },
          { label: s.name },
        ]}
      />
      <Title
        id={s.id}
        actions={<GraphLink id={s.id} mode="apps" />}
        sub={
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{s.kind}</Badge>
            {s.status && s.status !== 'running' && (
              <Badge variant={retired ? 'secondary' : 'outline'}>{s.status}</Badge>
            )}
            {s.auth && <Badge variant="outline">auth: {s.auth}</Badge>}
            {routes.length > 0 && <Badge variant="outline">public</Badge>}
          </div>
        }
      >
        {s.name}
      </Title>
      <Lead text={s.summary} field="summary" />
      {s.description && <p className="mt-3 text-sm text-muted-foreground">{s.description}</p>}

      <H2>Where it runs</H2>
      <p className="text-sm">
        On <EntityLink id={s.node} />
        {node && hostLabel(node) !== (node.name ?? node.id) && (
          <span className="text-muted-foreground"> ({hostLabel(node)})</span>
        )}
        {s.image && (
          <>
            {' '}
            from image <code className="break-all">{s.image}</code>
          </>
        )}
        {s.version !== undefined && (
          <>
            {' '}
            at version <code>{String(s.version)}</code>
          </>
        )}
        {s.pin && <span className="text-muted-foreground"> (pinned: {s.pin})</span>}.
      </p>
      {s.paths && Object.keys(s.paths).length > 0 && (
        <SimpleTable
          head={['Path', 'Location']}
          rows={Object.entries(s.paths).map(([k, v]) => [
            k,
            <code key="v" className="break-all">
              {v}
            </code>,
          ])}
        />
      )}
      {s.update?.command && (
        <>
          <H3>Updating</H3>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
            <code>{s.update.command}</code>
          </pre>
          {s.update.notes && <Prose>{s.update.notes}</Prose>}
        </>
      )}

      <H2>How to reach it</H2>
      {!s.urls?.length && !routes.length && !s.ports?.length && (
        <Gap>No URLs, routes or ports documented.</Gap>
      )}
      {s.urls && s.urls.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1 text-sm">
          {s.urls.map((u) => (
            <li key={u.url}>
              <a
                href={u.url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all underline"
              >
                {u.label ?? u.url}
              </a>
              {u.internal && <span className="text-muted-foreground"> (internal)</span>}
            </li>
          ))}
        </ul>
      )}
      {routes.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {routes.map((r) => (
            <RouteCard key={r.id} route={r} />
          ))}
        </div>
      )}
      {s.ports && s.ports.length > 0 && <PortsTable ports={s.ports} />}

      <H2>What it talks to</H2>
      {!s.calls?.length ? (
        <Gap>No calls documented.</Gap>
      ) : (
        <SimpleTable
          head={['Target', 'Why', 'How']}
          rows={s.calls.map((c) => [
            index.byId.has(c.target) ? (
              <EntityLink key="t" id={c.target} />
            ) : (
              <span key="t">{c.target}</span>
            ),
            c.purpose ?? <span className="text-muted-foreground">—</span>,
            <span key="v" className="text-xs text-muted-foreground">
              {[
                c.via,
                c.port !== undefined ? `:${c.port}` : '',
                c.kind === 'observe' ? 'observes' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            </span>,
          ])}
        />
      )}

      <H2>What uses it</H2>
      {callers.length === 0 ? (
        <Gap>Nothing in the data calls this app.</Gap>
      ) : (
        <SimpleTable
          head={['App', 'Why']}
          rows={callers.map(({ from, call }) => [
            <EntityLink key="f" id={from.id} />,
            call.purpose ?? <span className="text-muted-foreground">—</span>,
          ])}
        />
      )}

      <H2>Health</H2>
      <HealthTab id={s.id} monitors={health.monitors} error={health.error} />

      <H2>Logs</H2>
      {s.logs?.dozzle ? (
        <p className="text-sm">
          Container <code>{s.logs.dozzle.container}</code> on Dozzle host{' '}
          <code>{s.logs.dozzle.host}</code>.{' '}
          <a className="underline" href={formatHash({ view: 'wiki', page: s.id, entity: s.id })}>
            Open the live tail
          </a>{' '}
          (Logs tab).
        </p>
      ) : (
        <Gap>
          No log source. Add <code>logs.dozzle</code> to stream this app's logs.
        </Gap>
      )}

      <BackupsAndJobs backups={m.backups} jobs={jobs} serviceBackup={s.backup} />
      <Secrets secrets={s.secrets} />
      <RulesAndHowTos policies={m.policies} procedures={m.procedures} articles={m.articles} />
      <Timeline history={m.history} />
      <Questions questions={m.questions} />
    </>
  );
}

function NodePage({ node: n }: { node: Node }) {
  const { model, index } = useApp();
  const chain: string[] = [];
  for (let p = n.parent; p && !chain.includes(p) && index.byId.has(p);) {
    chain.unshift(p);
    p = (index.byId.get(p)?.entity as Node | undefined)?.parent;
  }
  const children = model.nodes.filter((c) => c.parent === n.id);
  const apps = model.services.filter((s) => s.node === n.id);
  const m = mentions(model, n.id);
  const jobs = jobsNear(model, index, n.id);
  const res = n.resources;
  return (
    <>
      <Crumbs
        trail={[
          { label: 'Machines' },
          ...chain.map((id) => ({ label: displayName(index.byId.get(id)), href: wikiHref(id) })),
          { label: n.name ?? n.id },
        ]}
      />
      <Title
        id={n.id}
        actions={<GraphLink id={n.id} mode="infra" />}
        sub={
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{n.vmid !== undefined ? `${n.kind} ${n.vmid}` : n.kind}</Badge>
            {n.status && n.status !== 'running' && <Badge variant="outline">{n.status}</Badge>}
            {n.os && <Badge variant="outline">{n.os}</Badge>}
          </div>
        }
      >
        {n.name ?? n.id}
      </Title>
      <Lead text={n.summary} field="summary" />
      {n.description && <p className="mt-3 text-sm text-muted-foreground">{n.description}</p>}

      <H2>Facts</H2>
      <SimpleTable
        head={['', '']}
        rows={[
          ...(n.parent ? [['Inside', <EntityLink key="p" id={n.parent} />]] : []),
          ...(n.hostname ? [['Hostname', <code key="h">{n.hostname}</code>]] : []),
          ...(n.ips?.length ? [['Addresses', <code key="i">{n.ips.join(', ')}</code>]] : []),
          ...(res
            ? [
                [
                  'Resources',
                  [
                    res.cores !== undefined ? `${res.cores} cores` : '',
                    res.memory_mib !== undefined
                      ? `${Math.round(res.memory_mib / 1024)} GiB RAM`
                      : '',
                    res.disk_gib !== undefined ? `${res.disk_gib} GiB disk` : '',
                  ]
                    .filter(Boolean)
                    .join(', '),
                ],
              ]
            : []),
          ...(n.autostart !== undefined ? [['Starts on boot', n.autostart ? 'yes' : 'no']] : []),
          ...(n.backup
            ? [
                [
                  'Backed up',
                  n.backup.included ? `yes${n.backup.job ? ` (${n.backup.job})` : ''}` : 'no',
                ],
              ]
            : []),
        ]}
      />

      <H2>What runs here</H2>
      {children.length === 0 && apps.length === 0 && <Gap>Nothing documented runs here.</Gap>}
      {children.length > 0 && (
        <SimpleTable
          head={['Machine', 'What it is for']}
          rows={children.map((c) => [
            <EntityLink key="c" id={c.id} />,
            c.summary ?? <span className="text-muted-foreground italic">No summary yet</span>,
          ])}
        />
      )}
      {apps.length > 0 && (
        <div className={cn(children.length > 0 && 'mt-3')}>
          <SimpleTable
            head={['App', 'What it does']}
            rows={apps.map((a) => [
              <EntityLink key="a" id={a.id} />,
              a.summary ?? <span className="text-muted-foreground italic">No summary yet</span>,
            ])}
          />
        </div>
      )}

      {n.mounts && n.mounts.length > 0 && (
        <>
          <H2>Storage</H2>
          <SimpleTable
            head={['Source', 'Mounted at', 'Purpose']}
            rows={n.mounts.map((mt) => [
              mt.storage ? (
                <EntityLink key="s" id={mt.storage} />
              ) : (
                <code key="s" className="break-all">
                  {mt.source}
                </code>
              ),
              <code key="t" className="break-all">
                {mt.target}
              </code>,
              [mt.purpose, mt.readonly ? 'read-only' : ''].filter(Boolean).join(', '),
            ])}
          />
        </>
      )}

      <H2>Health</H2>
      <HealthTab id={n.id} monitors={healthStateOf(useAtomValue(healthAtom)).monitors} />

      {n.update?.command && (
        <>
          <H2>Updating</H2>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
            <code>{n.update.command}</code>
          </pre>
          {n.update.notes && <Prose>{n.update.notes}</Prose>}
        </>
      )}
      <BackupsAndJobs backups={m.backups} jobs={jobs} />
      <Secrets secrets={n.secrets} />
      <RulesAndHowTos policies={m.policies} procedures={m.procedures} articles={m.articles} />
      <Timeline history={m.history} />
      <Questions questions={m.questions} />
    </>
  );
}

function ArticlePage({ article: a }: { article: SystemModel['articles'][number] }) {
  return (
    <>
      <Crumbs trail={[{ label: 'Articles', href: wikiHref('ref/articles') }, { label: a.title }]} />
      <Title>{a.title}</Title>
      {a.refs && a.refs.length > 0 && (
        <p className="-mt-3 mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          About:{' '}
          {a.refs.map((r) => (
            <EntityLink key={r} id={r} />
          ))}
        </p>
      )}
      <Prose>{a.body}</Prose>
    </>
  );
}

function EntityPage({ id }: { id: string }) {
  const { index } = useApp();
  const ref = index.byId.get(id)!;
  return (
    <>
      <Crumbs trail={[{ label: displayName(ref) }]} />
      <Title id={id} actions={<GraphLink id={id} mode="infra" />}>
        {displayName(ref)}
      </Title>
      <OverviewTab id={id} />
    </>
  );
}

function IndexPage({ name }: { name: WikiIndex }) {
  const { model } = useApp();
  const title = INDEX_TITLES[name];
  return (
    <>
      <Crumbs trail={[{ label: 'Reference' }, { label: title }]} />
      <Title>{title}</Title>
      {name === 'articles' &&
        (model.articles.length === 0 ? (
          <Gap>No articles yet.</Gap>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sortedArticles(model).map((a) => (
              <li key={a.id}>
                <a href={wikiHref(a.id)} className="hover:underline">
                  {a.title}
                </a>
              </li>
            ))}
          </ul>
        ))}
      {name === 'policies' &&
        (model.policies.length === 0 ? (
          <Gap>No policies yet.</Gap>
        ) : (
          model.policies.map((p) => (
            <section key={p.id}>
              <H2>{p.title}</H2>
              <Prose>{p.rule}</Prose>
              {p.why && (
                <div className="mt-2 text-sm text-muted-foreground">
                  <span className="font-medium">Why: </span>
                  <Markdown className="inline [&_p]:inline">{p.why}</Markdown>
                </div>
              )}
              {p.scope && p.scope.length > 0 && (
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {p.scope.map((r) => (
                    <EntityLink key={r} id={r} />
                  ))}
                </p>
              )}
            </section>
          ))
        ))}
      {name === 'procedures' &&
        (model.procedures.length === 0 ? (
          <Gap>No procedures yet.</Gap>
        ) : (
          model.procedures.map((p) => (
            <section key={p.id}>
              <H2>{p.title}</H2>
              {p.applies_to && p.applies_to.length > 0 && (
                <p className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  For:{' '}
                  {p.applies_to.map((r) => (
                    <EntityLink key={r} id={r} />
                  ))}
                </p>
              )}
              <Prose>{p.body}</Prose>
            </section>
          ))
        ))}
      {name === 'history' &&
        (model.history.length === 0 ? (
          <Gap>No history entries yet.</Gap>
        ) : (
          <HistoryList entries={model.history} />
        ))}
      {name === 'questions' &&
        (model.open_questions.length === 0 ? (
          <Gap>No open questions.</Gap>
        ) : (
          <QuestionList questions={model.open_questions} />
        ))}
      {name === 'coverage' && <CoverageList />}
    </>
  );
}

function CoverageList() {
  const { model } = useApp();
  const gaps = coverage(model);
  const ratio = coverageRatio(model);
  const sections = [
    ['stacks', 'Stacks'],
    ['services', 'Apps'],
    ['nodes', 'Machines'],
  ] as const;
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {ratio.documented} of {ratio.total} have a <code>summary</code>. The wiki leads with it, so
        these pages start with a gap until it is filled.
      </p>
      {gaps.length === 0 && <p className="mt-4 text-sm">Everything has a summary.</p>}
      {sections.map(([section, label]) => {
        const list = gaps.filter((g) => g.section === section);
        if (list.length === 0) return null;
        return (
          <section key={section}>
            <H2>
              {label}{' '}
              <span className="text-sm font-normal text-muted-foreground">({list.length})</span>
            </H2>
            <ul className="flex flex-col gap-1 text-sm">
              {list.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-2">
                  <EntityLink id={g.id} />
                  <span className="text-xs text-muted-foreground">
                    missing {g.missing.join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Shared sections

function BackupsAndJobs({
  backups,
  jobs,
  serviceBackup,
}: {
  backups: SystemModel['backups'];
  jobs: SystemModel['jobs'];
  serviceBackup?: Service['backup'];
}) {
  return (
    <>
      <H2>Backups and jobs</H2>
      {backups.length === 0 && jobs.length === 0 && !serviceBackup && (
        <Gap>No backups or scheduled jobs documented.</Gap>
      )}
      {serviceBackup && (
        <p className="mb-3 text-sm">
          {serviceBackup.how}
          {serviceBackup.where && <> → {serviceBackup.where}</>}
        </p>
      )}
      {backups.length > 0 && (
        <SimpleTable
          head={['Backup', 'To', 'When', 'Offsite']}
          rows={backups.map((b) => [
            <EntityLink key="b" id={b.id} />,
            b.to,
            b.schedule ?? '—',
            b.offsite ? 'yes' : 'no',
          ])}
        />
      )}
      {jobs.length > 0 && (
        <div className={cn(backups.length > 0 && 'mt-3')}>
          <SimpleTable
            head={['Job', 'When', 'Purpose']}
            rows={jobs.map((j) => [
              <EntityLink key="j" id={j.id} />,
              <code key="s">{j.schedule}</code>,
              j.purpose ?? '—',
            ])}
          />
        </div>
      )}
    </>
  );
}

function Secrets({ secrets }: { secrets?: readonly { path: string; purpose?: string }[] }) {
  if (!secrets?.length) return null;
  return (
    <>
      <H2>Secrets (locations only)</H2>
      <SimpleTable
        head={['Path', 'Purpose']}
        rows={secrets.map((x) => [
          <code key="p" className="break-all">
            {x.path}
          </code>,
          x.purpose ?? '—',
        ])}
      />
    </>
  );
}

function RulesAndHowTos({
  policies,
  procedures,
  articles,
}: {
  policies: SystemModel['policies'];
  procedures: SystemModel['procedures'];
  articles: SystemModel['articles'];
}) {
  if (policies.length + procedures.length + articles.length === 0) return null;
  return (
    <>
      <H2>Rules and how-tos</H2>
      <ul className="flex flex-col gap-1.5 text-sm">
        {policies.map((p) => (
          <li key={p.id}>
            Policy:{' '}
            <a className="underline" href={wikiHref('ref/policies')}>
              {p.title}
            </a>
          </li>
        ))}
        {procedures.map((p) => (
          <li key={p.id}>
            How-to:{' '}
            <a className="underline" href={wikiHref('ref/procedures')}>
              {p.title}
            </a>
          </li>
        ))}
        {articles.map((a) => (
          <li key={a.id}>
            Article:{' '}
            <a className="underline" href={wikiHref(a.id)}>
              {a.title}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

function Timeline({ history }: { history: SystemModel['history'] }) {
  if (history.length === 0) return null;
  return (
    <>
      <H2>History</H2>
      <HistoryList entries={history} />
    </>
  );
}

function Questions({ questions }: { questions: SystemModel['open_questions'] }) {
  if (questions.length === 0) return null;
  return (
    <>
      <H2>Open questions</H2>
      <QuestionList questions={questions} />
    </>
  );
}

function QuestionList({ questions }: { questions: SystemModel['open_questions'] }) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {questions.map((q) => (
        <li key={q.id} className="rounded-lg border px-3 py-2">
          <Markdown className="[&_p]:my-0">{q.question}</Markdown>
          {q.refs && q.refs.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
              {q.refs.map((r) => (
                <EntityLink key={r} id={r} />
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
