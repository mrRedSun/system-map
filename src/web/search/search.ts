/** In-memory full-text search over every entity. Pure; tested in Node. */
import { displayName, type ModelIndex } from '../lib/model-index';
import { kindLabel } from '../lib/visuals';

export interface SearchDoc {
  id: string;
  name: string;
  kind: string;
  /** Lower-cased `path: value` lines for every scalar in the entity. */
  lines: string[];
  text: string;
}

export interface SearchHit {
  doc: SearchDoc;
  score: number;
  /** The line that matched, when the match is not in the id or name. */
  snippet?: string;
}

function flatten(value: unknown, path: string, out: string[]) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) value.forEach((v) => flatten(v, path, out));
  else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out);
  } else out.push(`${path}: ${String(value)}`);
}

export function buildSearchIndex(index: ModelIndex): SearchDoc[] {
  return [...index.byId.values()].map((ref) => {
    const lines: string[] = [];
    flatten(ref.entity, '', lines);
    const name = displayName(ref);
    const kind = kindLabel(ref);
    return {
      id: ref.id,
      name,
      kind,
      lines,
      text: `${ref.id}\n${name}\n${kind}\n${lines.join('\n')}`.toLowerCase(),
    };
  });
}

export function search(docs: SearchDoc[], query: string, limit = 50): SearchHit[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const doc of docs) {
    if (!tokens.every((t) => doc.text.includes(t))) continue;
    const id = doc.id.toLowerCase();
    const name = doc.name.toLowerCase();
    const q = tokens.join(' ');
    let score = 0;
    if (id === q) score += 120;
    else if (name === q) score += 100;
    else if (id.startsWith(q) || name.startsWith(q)) score += 60;
    for (const t of tokens) {
      if (id.includes(t) || name.includes(t)) score += 20;
      else score += 5;
    }
    const inHeader = tokens.every((t) => id.includes(t) || name.includes(t));
    const snippet = inHeader
      ? undefined
      : doc.lines
          .find((l) => tokens.some((t) => l.toLowerCase().includes(t)))
          // `[[id]]` entity links read as plain ids in a one-line preview.
          ?.replace(/\[\[([a-z0-9-]+)\]\]/g, '$1');
    hits.push({ doc, score, snippet });
  }
  hits.sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id));
  return hits.slice(0, limit);
}
