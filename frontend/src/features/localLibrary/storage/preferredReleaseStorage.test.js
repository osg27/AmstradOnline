import { describe, expect, it } from 'vitest';
import {
  getPreferredRelease,
  preferredReleaseKey,
  resolveRelease,
  setPreferredRelease,
} from './preferredReleaseStorage';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const game = {
  id: 'amiga-ugh',
  platform: 'amiga',
  defaultReleaseId: 'clean',
  releases: [
    { id: 'clean', isComplete: true },
    { id: 'crack', isComplete: true },
  ],
};

describe('preferred release storage', () => {
  it('saves and resolves a preferred release', () => {
    const storage = memoryStorage();
    setPreferredRelease(game, 'crack', storage);
    expect(getPreferredRelease(game, storage)?.id).toBe('crack');
    expect(resolveRelease(game, storage)?.id).toBe('crack');
  });

  it('removes a stale preference and falls back to default', () => {
    const storage = memoryStorage();
    storage.setItem(preferredReleaseKey(game.platform, game.id), 'missing');
    expect(resolveRelease(game, storage)?.id).toBe('clean');
    expect(storage.getItem(preferredReleaseKey(game.platform, game.id))).toBe(null);
  });
});

