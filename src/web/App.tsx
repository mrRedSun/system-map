import { AlertTriangle, Menu, Moon, Search, Sun, WifiOff } from 'lucide-react';
import { useAtom, useAtomValue } from '@effect/atom-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SystemModel, WhoAmI } from '../shared/model';
import { AppContext, type AppContextValue } from '@/app-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { GraphView } from '@/graph/GraphView';
import { modelAtom, modelStateOf, whoAmIAtom } from '@/lib/api';
import { backRefs, indexModel } from '@/lib/model-index';
import { graphModeAtom } from '@/lib/prefs';
import { AsyncResult } from 'effect/reactivity';
import { VIEWS, formatHash, useLocation, type GraphMode, type View } from '@/lib/router';
import { healthAtom, healthStateOf, useEntityHealth } from '@/lib/health';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { BASE_TABS, DetailPanel, type PanelTab } from '@/panel/DetailPanel';
import { HealthTab } from '@/panel/health';
import { LogsTab } from '@/panel/logs';
import { CommandPalette, useCommandShortcut } from '@/search/CommandPalette';
import { VIEW_META } from '@/views/meta';
import {
  EntitiesView,
  FirewallView,
  HistoryView,
  JobsView,
  PoliciesView,
  ProblemsView,
  QuestionsView,
  RoutesView,
} from '@/views/views';

const PAGES: Record<Exclude<View, 'graph'>, () => React.ReactNode> = {
  entities: () => <EntitiesView />,
  routes: () => <RoutesView />,
  firewall: () => <FirewallView />,
  jobs: () => <JobsView />,
  policies: () => <PoliciesView />,
  history: () => <HistoryView />,
  questions: () => <QuestionsView />,
  problems: () => <ProblemsView />,
};

export function App() {
  const { model, error, connection } = modelStateOf(useAtomValue(modelAtom));
  const me: WhoAmI = AsyncResult.getOrElse(useAtomValue(whoAmIAtom), (): WhoAmI => ({}));
  const { dark, toggle } = useTheme();
  const [location, navigate] = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  useCommandShortcut(setSearchOpen);
  const health = healthStateOf(useAtomValue(healthAtom));
  const index = useMemo(() => (model ? indexModel(model) : undefined), [model]);
  const statuses = useEntityHealth(model, index, health);

  // Graph mode: the URL wins and is remembered; otherwise the saved preference (Apps by default).
  const [savedMode, setSavedMode] = useAtom(graphModeAtom);
  const graphMode = location.graph ?? savedMode;
  useEffect(() => {
    if (location.graph) setSavedMode(location.graph);
  }, [location.graph, setSavedMode]);
  const setGraphMode = useCallback(
    (mode: GraphMode) => {
      setSavedMode(mode);
      navigate({ ...location, view: 'graph', graph: mode });
    },
    [location, navigate, setSavedMode],
  );

  const ctx = useMemo<AppContextValue | undefined>(() => {
    if (!model || !index) return undefined;
    return {
      model,
      index,
      backRefs: backRefs(model),
      location,
      navigate,
      hrefFor: (id) => formatHash({ view: location.view, graph: location.graph, entity: id }),
      healthOf: (id) => statuses.get(id),
    };
  }, [model, index, location, navigate, statuses]);

  const tabs = useMemo<PanelTab[]>(() => {
    const healthTab: PanelTab = {
      id: 'health',
      label: 'Health',
      render: (id) => <HealthTab id={id} monitors={health.monitors} error={health.error} />,
    };
    const logsTab: PanelTab = {
      id: 'logs',
      label: 'Logs',
      render: (id) => {
        const s = model?.services.find((x) => x.id === id) as SystemModel['services'][number];
        const d = s.logs!.dozzle!;
        return <LogsTab key={id} host={d.host} container={d.container} />;
      },
      show: (id) => Boolean(model?.services.find((x) => x.id === id)?.logs?.dozzle),
    };
    return [...BASE_TABS.slice(0, 3), healthTab, logsTab, ...BASE_TABS.slice(3)];
  }, [health, model]);

  const closePanel = useCallback(
    () => navigate({ view: location.view, graph: location.graph }),
    [navigate, location.view, location.graph],
  );

  const errors = model?.problems.filter((p) => p.severity === 'error').length ?? 0;
  const warnings = (model?.problems.length ?? 0) - errors;
  const who = me.name ?? me.user;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-dvh flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Views">
                <Menu />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {VIEWS.map((v) => {
                const M = VIEW_META[v];
                return (
                  <DropdownMenuItem key={v} onSelect={() => navigate({ view: v })}>
                    <M.icon />
                    {M.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <a href="#/" className="flex min-w-0 items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="size-6 shrink-0" />
            <span className="truncate">{model?.meta.title ?? 'System Map'}</span>
          </a>
          <nav className="ml-2 hidden items-center gap-0.5 lg:flex" aria-label="Views">
            {VIEWS.map((v) => {
              const M = VIEW_META[v];
              const active = location.view === v;
              return (
                <Tooltip key={v}>
                  <TooltipTrigger asChild>
                    <a
                      href={formatHash({ view: v })}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                        active && 'bg-muted text-foreground',
                      )}
                    >
                      <M.icon className="size-4" />
                      <span className="hidden 2xl:inline">{M.label}</span>
                    </a>
                  </TooltipTrigger>
                  <TooltipContent className="2xl:hidden">{M.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchOpen(true)}
              className="gap-2 text-muted-foreground"
              aria-label="Search"
            >
              <Search />
              <span className="hidden md:inline">Search</span>
              <Kbd className="hidden md:inline-flex">⌘K</Kbd>
            </Button>
            {(errors > 0 || warnings > 0) && (
              <a href={formatHash({ view: 'problems' })} aria-label="Validation problems">
                <Badge variant={errors > 0 ? 'destructive' : 'outline'} className="gap-1">
                  <AlertTriangle className="size-3" />
                  {errors > 0 ? errors : warnings}
                  <span className="hidden sm:inline">
                    {errors > 0 ? (errors === 1 ? 'error' : 'errors') : 'warnings'}
                  </span>
                </Badge>
              </a>
            )}
            {connection === 'reconnecting' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground" aria-label="Live updates disconnected">
                    <WifiOff className="size-4" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>Live updates disconnected; reconnecting</TooltipContent>
              </Tooltip>
            )}
            {who && (
              <span className="hidden max-w-40 truncate text-sm text-muted-foreground md:inline">
                {who}
              </span>
            )}
            <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={toggle}>
              {dark ? <Sun /> : <Moon />}
            </Button>
          </div>
        </header>
        {model?.stale && (
          <a
            href={formatHash({ view: 'problems' })}
            className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-sm"
          >
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
            The data files have YAML errors. Showing the last good version. See problems.
          </a>
        )}
        <main className="relative min-h-0 flex-1">
          {!model && (
            <div className="grid h-full place-items-center p-4 text-sm text-muted-foreground">
              {error ?? 'Loading…'}
            </div>
          )}
          {ctx && (
            <AppContext.Provider value={ctx}>
              {location.view === 'graph' ? (
                <GraphView
                  model={ctx.model}
                  index={ctx.index}
                  selected={location.entity}
                  onSelect={(id) => navigate({ view: 'graph', graph: location.graph, entity: id })}
                  healthOf={ctx.healthOf}
                  mode={graphMode}
                  onMode={setGraphMode}
                />
              ) : (
                PAGES[location.view]()
              )}
              {location.entity && (
                <DetailPanel id={location.entity} onClose={closePanel} tabs={tabs} />
              )}
              <CommandPalette
                open={searchOpen}
                onOpenChange={setSearchOpen}
                dark={dark}
                onToggleTheme={toggle}
              />
            </AppContext.Provider>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
