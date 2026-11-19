import { AlertTriangle, Menu, Moon, Search, Sun, WifiOff } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { HealthStatus } from '../shared/model';
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
import { useModel, useWhoAmI } from '@/lib/api';
import { backRefs, indexModel } from '@/lib/model-index';
import { VIEWS, formatHash, useLocation, type View } from '@/lib/router';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { DetailPanel } from '@/panel/DetailPanel';
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

const noHealth = (): HealthStatus | undefined => undefined;

export function App() {
  const { model, error, connection } = useModel();
  const me = useWhoAmI();
  const { dark, toggle } = useTheme();
  const [location, navigate] = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  useCommandShortcut(setSearchOpen);

  const ctx = useMemo<AppContextValue | undefined>(() => {
    if (!model) return undefined;
    return {
      model,
      index: indexModel(model),
      backRefs: backRefs(model),
      location,
      navigate,
      hrefFor: (id) => formatHash({ view: location.view, entity: id }),
      healthOf: noHealth,
    };
  }, [model, location, navigate]);

  const closePanel = useCallback(
    () => navigate({ view: location.view }),
    [navigate, location.view],
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
                  onSelect={(id) => navigate({ view: 'graph', entity: id })}
                  healthOf={ctx.healthOf}
                />
              ) : (
                PAGES[location.view]()
              )}
              {location.entity && <DetailPanel id={location.entity} onClose={closePanel} />}
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
