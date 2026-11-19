import { describe, expect, it } from 'vitest';
import { bezierAt, labelSize, placeLabels, type Rect } from '../src/web/graph/edge-labels.js';

const box = (x: number, y: number, width = 100, height = 40): Rect => ({ x, y, width, height });

describe('edge labels', () => {
  it('follows the bezier: ends at the handles, middle between them', () => {
    expect(bezierAt(0, 0, 200, 100, false, 0)).toEqual({ x: 0, y: 0 });
    expect(bezierAt(0, 0, 200, 100, false, 1)).toEqual({ x: 200, y: 100 });
    expect(bezierAt(0, 0, 200, 100, false, 0.5)).toEqual({ x: 100, y: 50 });
    // Backwards edges bow outwards instead of crossing straight back.
    expect(bezierAt(200, 0, 0, 0, false, 0.25).x).toBeGreaterThan(150);
  });

  it('puts a lone label in the middle', () => {
    const t = placeLabels(
      [{ id: 'a', text: 'Search', source: box(0, 0), target: box(400, 0) }],
      [box(0, 0), box(400, 0)],
      false,
    );
    expect(t.get('a')).toBe(0.5);
  });

  it('moves or drops labels that would overlap each other', () => {
    // Two edges with the same path: the second label must go elsewhere along it.
    const req = (id: string) => ({ id, text: 'Downloads', source: box(0, 0), target: box(600, 0) });
    const t = placeLabels([req('a'), req('b')], [], false);
    expect(t.get('a')).toBe(0.5);
    expect(t.get('b')).not.toBe(0.5);
    // With no room left at all, labels are dropped rather than stacked.
    const crowded = placeLabels(
      Array.from({ length: 12 }, (_, i) => req(`e${i}`)),
      [],
      false,
    );
    expect(crowded.size).toBeLessThan(12);
  });

  it('keeps labels off nodes', () => {
    const { width } = labelSize('Library refresh');
    // A node sits exactly at the midpoint of the edge.
    const blocker = box(300 - width, -20, width * 2, 40);
    const t = placeLabels(
      [{ id: 'a', text: 'Library refresh', source: box(0, 0), target: box(500, 0) }],
      [blocker],
      false,
    );
    expect(t.get('a')).not.toBe(0.5);
  });

  it('always places a pinned label, first', () => {
    const t = placeLabels(
      [
        { id: 'a', text: 'Other', source: box(0, 0), target: box(300, 0) },
        { id: 'h', text: 'Hovered', source: box(0, 0), target: box(300, 0), pinned: true },
      ],
      [box(130, 0, 60, 40)],
      false,
    );
    expect(t.get('h')).toBe(0.5);
    expect(t.get('a')).not.toBe(0.5);
  });
});
