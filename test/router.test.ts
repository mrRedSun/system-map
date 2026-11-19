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

  it('carries the graph mode for the graph view only', () => {
    expect(parseHash('#/graph/infra')).toEqual({ view: 'graph', graph: 'infra' });
    expect(parseHash('#/graph/apps/n/wiki')).toEqual({
      view: 'graph',
      graph: 'apps',
      entity: 'wiki',
    });
    expect(parseHash('#/routes/infra')).toEqual({ view: 'routes' });
    expect(formatHash({ view: 'graph', graph: 'infra', entity: 'wiki' })).toBe(
      '#/graph/infra/n/wiki',
    );
    expect(formatHash({ view: 'routes', graph: 'infra' })).toBe('#/routes');
    const loc = { view: 'graph' as const, graph: 'apps' as const, entity: 'a b' };
    expect(parseHash(formatHash(loc))).toEqual(loc);
  });
});
