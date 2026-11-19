import { ArrowLeft, Link2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '@/app-context';
import { EntityIcon } from '@/components/EntityIcon';
import { HealthDot } from '@/graph/nodes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { displayName, exposureOf, statusOf } from '@/lib/model-index';
import { kindLabel } from '@/lib/visuals';
import { NetworkTab } from './network';
import { ConnectionsTab, HistoryTab, OverviewTab, RawTab } from './tabs';

export interface PanelTab {
  id: string;
  label: string;
  render: (id: string) => React.ReactNode;
  /** Whether the tab applies to this entity (default: always). */
  show?: (id: string) => boolean;
}

export const BASE_TABS: PanelTab[] = [
  { id: 'overview', label: 'Overview', render: (id) => <OverviewTab id={id} /> },
  { id: 'connections', label: 'Connections', render: (id) => <ConnectionsTab id={id} /> },
  { id: 'network', label: 'Network', render: (id) => <NetworkTab id={id} /> },
  { id: 'history', label: 'History', render: (id) => <HistoryTab id={id} /> },
  { id: 'raw', label: 'Raw', render: (id) => <RawTab id={id} /> },
];

/** Side panel on wide screens, full page on phones. */
export function DetailPanel({
  id,
  onClose,
  tabs = BASE_TABS,
}: {
  id: string;
  onClose: () => void;
  tabs?: PanelTab[];
}) {
  const { index, healthOf } = useApp();
  const [tab, setTab] = useState('overview');
  const ref = index.byId.get(id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const status = ref ? statusOf(ref.entity) : undefined;
  const exposure = exposureOf(index, id);
  const description = (ref?.entity as { description?: string } | undefined)?.description;
  const visibleTabs = tabs.filter(
    (t) => (t.show?.(id) ?? true) && (t.id !== 'network' || ref?.section !== 'history'),
  );
  // A tab that does not apply to the newly selected entity falls back to Overview.
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : 'overview';

  return (
    <aside
      aria-label="Details"
      className="fixed inset-0 z-40 flex animate-in flex-col bg-background duration-200 fade-in-0 slide-in-from-bottom-4 sm:absolute sm:inset-y-0 sm:right-0 sm:left-auto sm:z-20 sm:w-[min(34rem,100%)] sm:border-l sm:shadow-xl sm:slide-in-from-right-8 sm:slide-in-from-bottom-0"
    >
      <header className="flex items-start gap-3 border-b p-4">
        <Button
          variant="ghost"
          size="icon-sm"
          className="-ml-1 sm:hidden"
          onClick={onClose}
          aria-label="Back"
        >
          <ArrowLeft />
        </Button>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <EntityIcon entity={ref} className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="flex items-center gap-2 text-base leading-tight font-semibold">
            <span className="truncate">{ref ? displayName(ref) : id}</span>
            <HealthDot status={healthOf(id)} />
          </h2>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-mono">{id}</span>
            {ref && <Badge variant="secondary">{kindLabel(ref)}</Badge>}
            {status && status !== 'running' && <Badge variant="outline">{status}</Badge>}
            {exposure && <Badge variant="outline">{exposure}</Badge>}
          </div>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Copy link"
          title="Copy link"
          onClick={() =>
            void navigator.clipboard?.writeText(
              `${window.location.origin}${window.location.pathname}#/n/${encodeURIComponent(id)}`,
            )
          }
        >
          <Link2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="hidden sm:inline-flex"
          onClick={onClose}
          aria-label="Close"
        >
          <X />
        </Button>
      </header>
      {!ref ? (
        <p className="p-4 text-sm text-muted-foreground">
          No entity with id <span className="font-mono">{id}</span>.
        </p>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="overflow-x-auto border-b px-3 py-2">
            <TabsList>
              {visibleTabs.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {visibleTabs.map((t) => (
              <TabsContent key={t.id} value={t.id} className="p-4">
                {t.render(id)}
              </TabsContent>
            ))}
          </div>
        </Tabs>
      )}
    </aside>
  );
}
