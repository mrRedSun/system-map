import { describe, expect, it } from 'vitest';
import { formatHash, parseHash } from '../src/web/lib/router.js';

describe('hash routes', () => {
  it('parses views and entity deep links', () => {
    expect(parseHash('')).toEqual({ view: 'graph' });
    expect(parseHash('#/routes')).toEqual({ view: 'routes' });
    expect(parseHash('#/n/vm-docker')).toEqual({ view: 'graph', entity: 'vm-docker' });
    expect(parseHash('#/entities/n/wiki')).toEqual({ view: 'entities', entity: 'wiki' });
    expect(parseHash('#/nope')).toEqual({ view: 'graph' });
    expect(parseHash('#/n/%E0%A4%A')).toEqual({ view: 'graph', entity: '%E0%A4%A' });
  });

  it('formats round-trippable hashes', () => {
    for (const loc of [
      { view: 'graph' as const },
      { view: 'graph' as const, entity: 'wiki' },
      { view: 'problems' as const, entity: 'a b' },
    ]) {
      expect(parseHash(formatHash(loc))).toEqual(loc);
    }
    expect(formatHash({ view: 'graph', entity: 'wiki' })).toBe('#/n/wiki');
  });
});
