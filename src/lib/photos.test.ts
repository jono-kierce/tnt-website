import { describe, expect, it } from 'vitest';
import { allPhotos, avatarPhoto, leadPhoto, playerPhotos, seasonPhotos } from './photos.ts';

// Runs against the real manifest: these are invariants of photos.yaml, not of
// a fixture, so they keep holding as the owner adds photos.
const photos = allPhotos();
const slugs = [...new Set(photos.flatMap((p) => p.players))];
const seasons = [...new Set(photos.map((p) => p.season).filter((s) => s !== null))] as number[];

describe('avatar crops', () => {
  it('never appear in a gallery', () => {
    for (const s of slugs) expect(playerPhotos(s).some((p) => p.avatar)).toBe(false);
    for (const n of seasons) expect(seasonPhotos(n).some((p) => p.avatar)).toBe(false);
  });

  it('are the avatar for the one player they name', () => {
    const crops = photos.filter((p) => p.avatar);
    expect(crops.length).toBeGreaterThan(0);
    for (const c of crops) {
      expect(c.players).toHaveLength(1);
      expect(avatarPhoto(c.players[0])?.file).toBe(c.file);
    }
  });

  it('never front a graphic — leadPhoto stays full-size', () => {
    for (const s of slugs) expect(leadPhoto(s)?.avatar ?? false).toBe(false);
  });

  it('leave everyone else on the first-solo-photo rule', () => {
    const cropped = new Set(photos.filter((p) => p.avatar).flatMap((p) => p.players));
    for (const s of slugs.filter((x) => !cropped.has(x))) {
      expect(avatarPhoto(s)).toEqual(leadPhoto(s));
    }
  });
});
