import { Moon, Sun } from 'lucide-react';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { GraphView } from '@/graph/GraphView';
import { useModel, useWhoAmI } from '@/lib/api';
import { indexModel } from '@/lib/model-index';
import { useLocation } from '@/lib/router';
import { useTheme } from '@/lib/theme';

export function App() {
  const { model, error, connection } = useModel();
  const me = useWhoAmI();
  const { dark, toggle } = useTheme();
  const [location, navigate] = useLocation();
  const index = useMemo(() => (model ? indexModel(model) : undefined), [model]);
  const errors = model?.problems.filter((p) => p.severity === 'error') ?? [];

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-dvh flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
          <h1 className="truncate font-semibold">{model?.meta.title ?? 'System Map'}</h1>
          {connection !== 'live' && <Badge variant="outline">{connection}</Badge>}
          {errors.length > 0 && <Badge variant="destructive">{errors.length} errors</Badge>}
          <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            <span className="hidden truncate sm:inline">{me.name ?? me.user}</span>
            <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={toggle}>
              {dark ? <Sun /> : <Moon />}
            </Button>
          </div>
        </header>
        <main className="relative min-h-0 flex-1">
          {error && !model && <p className="p-4 text-destructive">{error}</p>}
          {model && index && (
            <GraphView
              model={model}
              index={index}
              selected={location.entity}
              onSelect={(id) => navigate({ ...location, entity: id })}
            />
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
