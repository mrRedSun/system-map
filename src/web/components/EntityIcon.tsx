import { createElement } from 'react';
import type { EntityRef } from '@/lib/model-index';
import { iconFor } from '@/lib/visuals';

/** The kind icon for an entity (lucide components are static; this only picks one). */
export function EntityIcon({ entity, className }: { entity?: EntityRef; className?: string }) {
  return createElement(iconFor(entity), { className });
}
