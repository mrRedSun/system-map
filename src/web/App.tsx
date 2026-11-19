import { Moon, Sun } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useModel, useWhoAmI } from '@/lib/api';
import { useTheme } from '@/lib/theme';

export function App() {
  const { model, error, connection } = useModel();
  const me = useWhoAmI();
  const { theme, setTheme } = useTheme();
  const dark = document.documentElement.classList.contains('dark');
  const errors = model?.problems.filter((p) => p.severity === 'error') ?? [];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <h1 className="font-semibold">{model?.meta.title ?? 'System Map'}</h1>
        <Badge variant={connection === 'live' ? 'secondary' : 'outline'}>{connection}</Badge>
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          {me.name ?? me.user}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setTheme(dark ? 'light' : 'dark')}
            data-theme={theme}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>
      <main className="p-4">
        {error && <p className="text-destructive">{error}</p>}
        {model && (
          <p className="text-sm text-muted-foreground">
            {model.nodes.length} nodes, {model.services.length} services, {errors.length} errors
          </p>
        )}
      </main>
    </div>
  );
}
