/**
 * `[[id]]` entity links inside markdown fields. The server reports unknown ids; the web app renders
 * them as entity links.
 */
import type { PathSegment } from './paths.js';

export const WIKILINK = /\[\[([a-z0-9]+(?:-[a-z0-9]+)*)\]\]/g;

/** Ids linked from a markdown text, in order of appearance. */
export function wikiLinks(text: string | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(WIKILINK)].map((m) => m[1]!);
}

/** Markdown fields per section, as paths inside the entity. `notes` and `summary` apply to all. */
export const MARKDOWN_FIELDS: Record<string, readonly PathSegment[][]> = {
  policies: [['rule'], ['why']],
  procedures: [['body']],
  stacks: [['description']],
  nodes: [
    ['backup', 'notes'],
    ['firewall', 'notes'],
    ['update', 'notes'],
  ],
  services: [['update', 'notes']],
  backups: [['restore']],
  history: [['rollback']],
  articles: [['body']],
};

export const COMMON_MARKDOWN_FIELDS: readonly PathSegment[][] = [['notes'], ['summary']];
