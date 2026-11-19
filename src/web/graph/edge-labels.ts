/**
 * Places edge labels so they never overlap each other or a node. A label goes at the first free
 * spot along its edge (middle first); when there is none it is left out (hovering the edge still
 * shows it). Pure, so it is unit-tested without a browser.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LabelRequest {
  id: string;
  text: string;
  source: Rect;
  target: Rect;
  /** Placed first and always (the hovered edge). */
  pinned?: boolean;
}

export type Side = 'left' | 'right' | 'top' | 'bottom';

/** Positions along the edge to try, as the bezier parameter t. */
const SPOTS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78];
const CHAR_WIDTH = 6.2;
const LABEL_HEIGHT = 18;

export function labelSize(text: string): { width: number; height: number } {
  return { width: Math.ceil(text.length * CHAR_WIDTH) + 10, height: LABEL_HEIGHT };
}

const OUT: Record<Side, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
};

/**
 * Cubic bezier control points. Facing sides match React Flow's default bezier edge
 * (curvature 0.25). Same sides (a "C" around the right of a column) bulge out past both ends,
 * where React Flow's curve would collapse into a straight line through the cards between.
 */
export function controlPoints(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  sourceSide: Side,
  targetSide: Side,
): [number, number, number, number] {
  if (sourceSide === targetSide) {
    const [nx, ny] = OUT[sourceSide];
    const span = nx !== 0 ? Math.abs(ty - sy) : Math.abs(tx - sx);
    const bulge = 40 + span * 0.15;
    // Outermost of the two ends, then the bulge beyond it.
    const edge = nx > 0 || ny > 0 ? Math.max : Math.min;
    if (nx !== 0) {
      const x = edge(sx, tx) + nx * bulge;
      return [x, sy, x, ty];
    }
    const y = edge(sy, ty) + ny * bulge;
    return [sx, y, tx, y];
  }
  const offset = (d: number) => (d >= 0 ? 0.5 * d : 0.25 * 25 * Math.sqrt(-d));
  const control = (side: Side, x1: number, y1: number, x2: number, y2: number) =>
    side === 'left'
      ? [x1 - offset(x1 - x2), y1]
      : side === 'right'
        ? [x1 + offset(x2 - x1), y1]
        : side === 'top'
          ? [x1, y1 - offset(y1 - y2)]
          : [x1, y1 + offset(y2 - y1)];
  const [c1x, c1y] = control(sourceSide, sx, sy, tx, ty) as [number, number];
  const [c2x, c2y] = control(targetSide, tx, ty, sx, sy) as [number, number];
  return [c1x, c1y, c2x, c2y];
}

/** SVG path of an edge. */
export function edgePath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  sourceSide: Side,
  targetSide: Side,
): string {
  const [c1x, c1y, c2x, c2y] = controlPoints(sx, sy, tx, ty, sourceSide, targetSide);
  return `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${tx},${ty}`;
}

/** Point at `t` on an edge's curve. */
export function bezierAt(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  sourceSide: Side,
  targetSide: Side,
  t: number,
): { x: number; y: number } {
  const [c1x, c1y, c2x, c2y] = controlPoints(sx, sy, tx, ty, sourceSide, targetSide);
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * sx + b * c1x + c * c2x + d * tx, y: a * sy + b * c1y + c * c2y + d * ty };
}

/**
 * Which sides an edge leaves and enters by. Normally out of the source's far side (right, or
 * bottom when vertical) into the target's near side. A target behind the source is reached
 * from the source's near side into the target's far side, and one level with it from far side
 * to far side, so no edge loops around its source or runs across the map and back.
 */
export function edgeSides(
  source: Rect,
  target: Rect,
  vertical: boolean,
): { source: Side; target: Side } {
  const [far, near]: [Side, Side] = vertical ? ['bottom', 'top'] : ['right', 'left'];
  const pos = (r: Rect) => (vertical ? r.y : r.x);
  const len = (r: Rect) => (vertical ? r.height : r.width);
  if (pos(target) >= pos(source) + len(source)) return { source: far, target: near };
  if (pos(target) + len(target) <= pos(source)) return { source: near, target: far };
  return { source: far, target: far };
}

/** The point in the middle of a rectangle's side. */
export function sidePoint(r: Rect, side: Side): { x: number; y: number } {
  if (side === 'left') return { x: r.x, y: r.y + r.height / 2 };
  if (side === 'right') return { x: r.x + r.width, y: r.y + r.height / 2 };
  if (side === 'top') return { x: r.x + r.width / 2, y: r.y };
  return { x: r.x + r.width / 2, y: r.y + r.height };
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Bezier parameter t for each label that fits; labels that do not fit are absent. */
export function placeLabels(
  requests: readonly LabelRequest[],
  obstacles: readonly Rect[],
  vertical: boolean,
): Map<string, number> {
  const placed: Rect[] = [];
  const out = new Map<string, number>();
  const ordered = [...requests].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)),
  );
  for (const r of ordered) {
    const { width, height } = labelSize(r.text);
    const sides = edgeSides(r.source, r.target, vertical);
    const from = sidePoint(r.source, sides.source);
    const to = sidePoint(r.target, sides.target);
    for (const t of r.pinned ? [0.5] : SPOTS) {
      const p = bezierAt(from.x, from.y, to.x, to.y, sides.source, sides.target, t);
      const rect = { x: p.x - width / 2, y: p.y - height / 2, width, height };
      if (!r.pinned && [...placed, ...obstacles].some((o) => overlaps(rect, o))) continue;
      placed.push(rect);
      out.set(r.id, t);
      break;
    }
  }
  return out;
}
