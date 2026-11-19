import { describe, expect, it } from 'vitest';
import {
  bezierAt,
  edgePath,
  edgeSides,
  labelSize,
  placeLabels,
  type Rect,
} from '../src/web/graph/edge-labels.js';

const box = (x: number, y: number, width = 100, height = 40): Rect => ({ x, y, width, height });

describe('edge labels', () => {
  it('follows the bezier: ends at the handles, middle between them', () => {
    expect(bezierAt(0, 0, 200, 100, 'right', 'left', 0)).toEqual({ x: 0, y: 0 });
    expect(bezierAt(0, 0, 200, 100, 'right', 'left', 1)).toEqual({ x: 200, y: 100 });
    expect(bezierAt(0, 0, 200, 100, 'right', 'left', 0.5)).toEqual({ x: 100, y: 50 });
    // Out of a right side towards something on the left: it bows out to the right first.
    expect(bezierAt(200, 0, 0, 0, 'right', 'left', 0.25).x).toBeGreaterThan(150);
    // Right side to right side: a C on the right.
    expect(bezierAt(100, 0, 100, 200, 'right', 'right', 0.5).x).toBeGreaterThan(100);
  });

  it("draws facing sides exactly like React Flow's bezier edge", async () => {
    const { getBezierPath, Position } = await import('@xyflow/system');
    for (const [sx, sy, tx, ty] of [
      [0, 0, 200, 100],
      [200, 0, 0, 80],
    ] as const) {
      const [rf] = getBezierPath({
        sourceX: sx,
        sourceY: sy,
        sourcePosition: Position.Right,
        targetX: tx,
        targetY: ty,
        targetPosition: Position.Left,
      });
      expect(edgePath(sx, sy, tx, ty, 'right', 'left')).toBe(rf);
    }
  });

  it('connects the sides that face each other', () => {
    const a = box(0, 0);
    expect(edgeSides(a, box(300, 200), false)).toEqual({ source: 'right', target: 'left' });
    expect(edgeSides(box(300, 200), a, false)).toEqual({ source: 'left', target: 'right' });
    // Same column: around the right, not across the source.
    expect(edgeSides(a, box(20, 300), false)).toEqual({ source: 'right', target: 'right' });
    expect(edgeSides(a, box(0, 300), true)).toEqual({ source: 'bottom', target: 'top' });
    expect(edgeSides(box(0, 300), a, true)).toEqual({ source: 'top', target: 'bottom' });
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
