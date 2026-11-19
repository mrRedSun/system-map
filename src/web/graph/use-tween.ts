import { useEffect, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';

const DURATION_MS = 320;
const ease = (t: number) => 1 - (1 - t) ** 3;

function geometry(n: Node) {
  return {
    x: n.position.x,
    y: n.position.y,
    w: Number(n.style?.width ?? 0),
    h: Number(n.style?.height ?? 0),
  };
}

/**
 * Animates node positions and sizes from the previous layout to the next, so expanding a group
 * moves things smoothly (and edges follow, unlike a CSS transition).
 */
export function useTweenedNodes<N extends Node>(target: N[]): N[] {
  const [frame, setFrame] = useState(target);
  const shown = useRef<Map<string, N>>(new Map());

  useEffect(() => {
    const from = shown.current;
    const record = (nodes: N[]) => {
      shown.current = new Map(nodes.map((n) => [n.id, n]));
      setFrame(nodes);
    };
    const moved = target.some((n) => {
      const p = from.get(n.id);
      if (!p) return false;
      const a = geometry(p);
      const b = geometry(n);
      return a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h;
    });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!moved || reduced) {
      record(target);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const k = ease(Math.min(1, (now - start) / DURATION_MS));
      const nodes = target.map((n) => {
        const p = from.get(n.id);
        if (!p || p.parentId !== n.parentId) return n;
        const a = geometry(p);
        const b = geometry(n);
        const lerp = (x: number, y: number) => x + (y - x) * k;
        return {
          ...n,
          position: { x: lerp(a.x, b.x), y: lerp(a.y, b.y) },
          style: b.w ? { ...n.style, width: lerp(a.w, b.w), height: lerp(a.h, b.h) } : n.style,
        };
      });
      record(nodes);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return frame;
}
