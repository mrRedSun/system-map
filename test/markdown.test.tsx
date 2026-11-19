import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown, safeUrl } from '../src/web/components/Markdown.js';

const html = (md: string) => renderToStaticMarkup(<Markdown>{md}</Markdown>);

describe('Markdown', () => {
  it('renders formatting and safe links', () => {
    const out = html('**bold** and [docs](https://example.net/a?b=1)');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('href="https://example.net/a?b=1"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it('never renders raw HTML', () => {
    const out = html('<script>alert(1)</script><img src=x onerror=alert(1)><b>x</b>');
    expect(out).not.toMatch(/<script|<img|onerror|<b>/);
  });

  it('drops non-http links and remote images', () => {
    const out = html(
      '[a](javascript:alert(1)) [b](data:text/html,x) [c](/relative) ![pic](https://tracker.example/p.png)',
    );
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('data:');
    expect(out).not.toContain('href="/relative"');
    expect(out).not.toContain('<img');
    expect(out).toContain('href="https://tracker.example/p.png"');
  });

  it('safeUrl accepts only absolute http(s)', () => {
    expect(safeUrl('https://a.example/')).toBe('https://a.example/');
    expect(safeUrl('HTTP://A.example')).toBe('http://a.example/');
    expect(safeUrl('mailto:x@example.net')).toBe('');
    expect(safeUrl('//evil.example')).toBe('');
  });
});
