import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

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
    href ? (
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

/** Markdown from the data files. Raw HTML is never rendered. */
export function Markdown({ children, className }: { children?: string; className?: string }) {
  if (!children) return null;
  return (
    <div className={cn('markdown text-sm', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeUrl}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
