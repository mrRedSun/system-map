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

/** Positions along the edge to try, as the bezier parameter t. */
const SPOTS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78];
const CHAR_WIDTH = 6.2;
const LABEL_HEIGHT = 18;

export function labelSize(text: string): { width: number; height: number } {
  return { width: Math.ceil(text.length * CHAR_WIDTH) + 10, height: LABEL_HEIGHT };
}

/** Point at `t` on React Flow's default bezier edge between two handles (curvature 0.25). */
export function bezierAt(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  vertical: boolean,
  t: number,
): { x: number; y: number } {
  const offset = (d: number) => (d >= 0 ? 0.5 * d : 0.25 * 25 * Math.sqrt(-d));
  const [c1x, c1y, c2x, c2y] = vertical
    ? [sx, sy + offset(ty - sy), tx, ty - offset(ty - sy)]
    : [sx + offset(tx - sx), sy, tx - offset(tx - sx), ty];
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * sx + b * c1x + c * c2x + d * tx, y: a * sy + b * c1y + c * c2y + d * ty };
}

/** Source and target handle points: right → left, or bottom → top when vertical. */
export function handles(source: Rect, target: Rect, vertical: boolean) {
  return vertical
    ? {
        sx: source.x + source.width / 2,
        sy: source.y + source.height,
        tx: target.x + target.width / 2,
        ty: target.y,
      }
    : {
        sx: source.x + source.width,
        sy: source.y + source.height / 2,
        tx: target.x,
        ty: target.y + target.height / 2,
      };
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
    const { sx, sy, tx, ty } = handles(r.source, r.target, vertical);
    for (const t of r.pinned ? [0.5] : SPOTS) {
      const p = bezierAt(sx, sy, tx, ty, vertical, t);
      const rect = { x: p.x - width / 2, y: p.y - height / 2, width, height };
      if (!r.pinned && [...placed, ...obstacles].some((o) => overlaps(rect, o))) continue;
      placed.push(rect);
      out.set(r.id, t);
      break;
    }
  }
  return out;
}
