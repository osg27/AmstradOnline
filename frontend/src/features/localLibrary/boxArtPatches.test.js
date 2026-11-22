import { describe, expect, it } from 'vitest';
import { applyGameMediaPatches } from './boxArtPatches';

describe('applyGameMediaPatches', () => {
  it('merges media into games that are still in the library', () => {
    const games = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
    const next = applyGameMediaPatches(games, new Map([['b', { boxArtUrl: 'x.png' }]]));
    expect(next[1]).toEqual({ id: 'b', title: 'B', boxArtUrl: 'x.png' });
    expect(next[0]).toBe(games[0]);
  });

  it('never re-adds a game that was removed before the patch arrived', () => {
    const remaining = [{ id: 'b', title: 'B' }];
    const next = applyGameMediaPatches(remaining, new Map([['a', { boxArtUrl: 'x.png' }]]));
    expect(next.map((game) => game.id)).toEqual(['b']);
  });

  it('returns the same list when there is nothing to apply', () => {
    const games = [{ id: 'a' }];
    expect(applyGameMediaPatches(games, new Map())).toBe(games);
  });
});
