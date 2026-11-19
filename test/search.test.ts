import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/server/model/build.js';
import { indexModel } from '../src/web/lib/model-index.js';
import { buildSearchIndex, search } from '../src/web/search/search.js';
import { exampleFiles } from './helpers.js';

const docs = buildSearchIndex(indexModel(buildModel(exampleFiles()).model));
const ids = (q: string) => search(docs, q).map((h) => h.doc.id);

describe('search', () => {
  it('ranks exact and prefix id/name matches first', () => {
    expect(ids('wiki')[0]).toBe('wiki');
    expect(ids('Jellyfin')[0]).toBe('jellyfin');
  });

  it('finds IPs, ports, hostnames, paths and notes, with a snippet', () => {
    expect(ids('10.10.0.53')).toContain('ct-dns');
    expect(ids('8096')).toContain('jellyfin');
    expect(ids('photos.example.net')).toContain('route-photos');
    expect(ids('/opt/stacks')).toContain('vm-docker');
    const hit = search(docs, 'TOTP').find((h) => h.doc.id === 'authelia');
    expect(hit?.snippet).toMatch(/TOTP/);
  });

  it('requires every token', () => {
    expect(ids('jellyfin 8096')[0]).toBe('jellyfin');
    expect(ids('jellyfin 9999')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });
});
