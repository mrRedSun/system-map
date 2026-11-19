import { ExternalLink } from 'lucide-react';
import { useApp } from '@/app-context';
import { EntityLink } from '@/components/EntityLink';
import { Markdown, safeUrl } from '@/components/Markdown';

/** Keys whose string values are markdown. */
const MARKDOWN_KEYS = new Set([
  'notes',
  'rule',
  'why',
  'body',
  'summary',
  'restore',
  'rollback',
  'conventions',
]);

/** Keys whose values are entity ids (the data contract's references). */
const REF_KEYS = new Set([
  'parent',
  'network',
  'storage',
  'node',
  'target',
  'service',
  'kuma',
  'scope',
  'applies_to',
  'from',
  'refs',
]);

const label = (key: string) => key.replace(/_/g, ' ');

/** Generic, read-only rendering of any data value, with ids turned into links. */
export function Value({ value, field }: { value: unknown; field?: string }) {
  const { index } = useApp();
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>;
  if (typeof value === 'boolean') {
    return <span className={value ? '' : 'text-muted-foreground'}>{value ? 'yes' : 'no'}</span>;
  }
  if (typeof value === 'number') return <span className="font-mono tabular-nums">{value}</span>;
  if (typeof value === 'string') {
    if (field && MARKDOWN_KEYS.has(field)) return <Markdown>{value}</Markdown>;
    if (field && REF_KEYS.has(field) && index.byId.has(value)) return <EntityLink id={value} />;
    if (field === 'url' || /^https?:\/\//.test(value)) {
      const href = safeUrl(value);
      if (href) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1 break-all text-[var(--edge-calls)] hover:underline"
          >
            {value}
            <ExternalLink className="size-3 shrink-0" />
          </a>
        );
      }
    }
    const mono = /[/:.=]|^\d/.test(value) && !value.includes(' ');
    return (
      <span className={mono ? 'font-mono text-[13px] break-all' : 'break-words'}>{value}</span>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">none</span>;
    if (value.every((v) => typeof v !== 'object' || v === null)) {
      return (
        <span className="flex flex-wrap gap-1">
          {value.map((v, i) => (
            <span key={i} className="rounded-md bg-muted px-1.5 py-0.5 text-[13px]">
              <Value value={v} field={field} />
            </span>
          ))}
        </span>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        {value.map((v, i) => (
          <div key={i} className="rounded-lg border bg-muted/30 p-2">
            <Value value={v} field={field} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === 'object')
    return <FieldList data={value as Record<string, unknown>} nested />;
  return <span>{String(value)}</span>;
}

export function FieldList({
  data,
  omit = [],
  nested = false,
}: {
  data: Record<string, unknown>;
  omit?: string[];
  nested?: boolean;
}) {
  const entries = Object.entries(data).filter(([k, v]) => !omit.includes(k) && v !== undefined);
  if (entries.length === 0) return null;
  return (
    <dl
      className={
        nested
          ? 'grid grid-cols-[minmax(4.5rem,auto)_1fr] gap-x-3 gap-y-1 text-sm'
          : 'grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-[9rem_1fr]'
      }
    >
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="pt-0.5 text-xs font-medium text-muted-foreground capitalize">
            {label(k)}
          </dt>
          <dd className="min-w-0">
            <Value value={v} field={k} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
