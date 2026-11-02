import { describe, expect, it } from 'vitest';
import { buildSystemChips, describeLibraryEmptyState, formatLibraryCount } from './libraryView';

describe('buildSystemChips', () => {
  const systems = [{ id: 'nes' }, { id: 'amiga' }];
  it('puts All and Favourites first, then systems with colours and counts', () => {
    const chips = buildSystemChips({ systems, counts: { nes: 12, amiga: 3 }, totalGames: 15, favouriteCount: 2 });
    expect(chips.map((chip) => chip.id)).toEqual(['all', 'favourites', 'nes', 'amiga']);
    expect(chips[0].count).toBe(15);
    expect(chips[1].count).toBe(2);
    expect(chips[2]).toMatchObject({ label: 'NES', count: 12 });
    expect(chips[2].color).toMatch(/^#/);
  });
  it('keeps a linked system visible when it has no games', () => {
    const chips = buildSystemChips({ systems, counts: {}, activeSystem: 'snes' });
    expect(chips.at(-1)).toMatchObject({ id: 'snes', count: 0 });
  });
});

describe('formatLibraryCount', () => {
  it('shows a plain total or shown-of-total', () => {
    expect(formatLibraryCount({ shown: 1234, total: 1234 })).toBe('1,234 games');
    expect(formatLibraryCount({ shown: 48, total: 1234 })).toBe('48 of 1,234 games');
    expect(formatLibraryCount({ shown: 0, total: 0 })).toBe('0 games');
  });
});

describe('describeLibraryEmptyState', () => {
  it('returns null when there are games to show', () => {
    expect(describeLibraryEmptyState({ totalGames: 10, matchCount: 4 })).toBeNull();
  });
  it('invites the user to add games when the library is empty', () => {
    expect(describeLibraryEmptyState({ totalGames: 0 }).kind).toBe('empty');
  });
  it('reports loading first', () => {
    expect(describeLibraryEmptyState({ loading: true, totalGames: 0 }).kind).toBe('loading');
  });
  it('distinguishes favourites, an empty system and no search results', () => {
    expect(describeLibraryEmptyState({ totalGames: 10, activeSystem: 'favourites' }).kind).toBe('favourites');
    expect(describeLibraryEmptyState({ totalGames: 10, activeSystem: 'snes', systemLabel: 'SNES', systemGames: 0 }).kind).toBe('system-empty');
    expect(describeLibraryEmptyState({ totalGames: 10, activeSystem: 'snes', systemGames: 4, filtersActive: true }).kind).toBe('no-results');
    expect(describeLibraryEmptyState({ totalGames: 10, activeSystem: 'all', filtersActive: true }).kind).toBe('no-results');
  });
});
