import { useApp } from '@/app-context';
import { EntityIcon } from '@/components/EntityIcon';
import { HealthDot } from '@/graph/nodes';
import { displayName, isDimmed } from '@/lib/model-index';
import { cn } from '@/lib/utils';

/** Inline link to an entity's detail panel; unknown ids render as plain text. */
export function EntityLink({
  id,
  className,
  showIcon = true,
  showId = false,
}: {
  id: string;
  className?: string;
  showIcon?: boolean;
  showId?: boolean;
}) {
  const { index, hrefFor, healthOf } = useApp();
  const ref = index.byId.get(id);
  if (!ref) return <span className={cn('font-mono text-muted-foreground', className)}>{id}</span>;
  const name = displayName(ref);
  return (
    <a
      href={hrefFor(id)}
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md align-middle hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        isDimmed(ref.entity) && 'opacity-60',
        className,
      )}
    >
      {showIcon && <EntityIcon entity={ref} className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="truncate">{name}</span>
      {showId && name !== id && (
        <span className="truncate font-mono text-xs text-muted-foreground">{id}</span>
      )}
      <HealthDot status={healthOf(id)} />
    </a>
  );
}
