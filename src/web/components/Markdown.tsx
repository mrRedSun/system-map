import { useContext } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { WIKILINK } from '../../shared/wikilinks';
import { AppContext } from '@/app-context';
import { EntityLink } from '@/components/EntityLink';
import { cn } from '@/lib/utils';

const ENTITY_SCHEME = 'entity:';

/** `[[id]]` as an entity link (name, icon, health); plain text outside the app. */
function EntityRef({ id }: { id: string }) {
  const app = useContext(AppContext);
  if (!app) return <span className="font-mono">{id}</span>;
  return <EntityLink id={id} showIcon={false} />;
}

/** Only absolute http(s) links survive; everything else (javascript:, data:, relative) is dropped. */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

const components: Components = {
  a: ({ href, children }) =>
    href?.startsWith(ENTITY_SCHEME) ? (
      <EntityRef id={href.slice(ENTITY_SCHEME.length)} />
    ) : href ? (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // No remote images: they would be third-party requests. Show the link instead.
  img: ({ src, alt }) => {
    const href = typeof src === 'string' ? safeUrl(src) : '';
    return href ? (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {alt || href}
      </a>
    ) : (
      <span>{alt}</span>
    );
  },
};

/** Entity links survive as `entity:<id>`; other links must be absolute http(s). */
const transformUrl = (url: string) =>
  url.startsWith(ENTITY_SCHEME) && /^entity:[a-z0-9-]+$/.test(url) ? url : safeUrl(url);

/** Markdown from the data files. Raw HTML is never rendered; `[[id]]` links to an entity. */
export function Markdown({ children, className }: { children?: string; className?: string }) {
  if (!children) return null;
  const text = children.replace(WIKILINK, (_, id: string) => `[${id}](${ENTITY_SCHEME}${id})`);
  return (
    <div className={cn('markdown text-sm', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={transformUrl}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
