import { Moon, Sun } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/app-context';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { HealthDot } from '@/graph/nodes';
import type { View } from '@/lib/router';
import { iconFor } from '@/lib/visuals';
import { VIEW_META } from '@/views/meta';
import { buildSearchIndex, search } from './search';

export function useCommandShortcut(setOpen: (fn: (open: boolean) => boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
}

export function CommandPalette({
  open,
  onOpenChange,
  dark,
  onToggleTheme,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dark: boolean;
  onToggleTheme: () => void;
}) {
  const { index, location, navigate, healthOf } = useApp();
  const [query, setQuery] = useState('');
  const docs = useMemo(() => buildSearchIndex(index), [index]);
  const hits = useMemo(() => search(docs, query, 40), [docs, query]);
  const q = query.trim().toLowerCase();
  const views = (Object.entries(VIEW_META) as [View, (typeof VIEW_META)[View]][]).filter(
    ([, m]) => !q || m.label.toLowerCase().includes(q),
  );

  const close = () => {
    onOpenChange(false);
    setQuery('');
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title="Search"
      description="Search entities by id, name, IP, port, hostname, path or notes"
      className="sm:max-w-xl"
    >
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search ids, names, IPs, ports, hostnames, paths, notes…"
        />
        <CommandList className="max-h-[min(60vh,28rem)]">
          <CommandEmpty>No matches.</CommandEmpty>
          {hits.length > 0 && (
            <CommandGroup heading="Entities">
              {hits.map(({ doc, snippet }) => {
                const Icon = iconFor(index.byId.get(doc.id));
                return (
                  <CommandItem
                    key={doc.id}
                    value={doc.id}
                    onSelect={() => {
                      navigate({ ...location, entity: doc.id });
                      close();
                    }}
                    className="flex items-start gap-2"
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate">{doc.name}</span>
                        <HealthDot status={healthOf(doc.id)} />
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          {doc.id !== doc.name ? doc.id : ''}
                        </span>
                      </span>
                      {snippet && (
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          {snippet}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{doc.kind}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
          {views.length > 0 && (
            <CommandGroup heading="Views">
              {views.map(([view, meta]) => (
                <CommandItem
                  key={view}
                  value={`view:${view}`}
                  onSelect={() => {
                    navigate({ view });
                    close();
                  }}
                >
                  <meta.icon className="text-muted-foreground" />
                  {meta.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {(!q || 'theme'.includes(q) || 'dark light'.includes(q)) && (
            <CommandGroup heading="Settings">
              <CommandItem
                value="toggle-theme"
                onSelect={() => {
                  onToggleTheme();
                  close();
                }}
              >
                {dark ? <Sun /> : <Moon />}
                {dark ? 'Light theme' : 'Dark theme'}
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
