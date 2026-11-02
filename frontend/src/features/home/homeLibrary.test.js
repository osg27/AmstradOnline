import { beforeAll, describe, expect, it, vi } from 'vitest';

let buildRecentGames;
let matchPlayedGame;

beforeAll(async () => {
  // The library page module reads window.location when it loads.
  vi.stubGlobal('window', { location: { port: '', protocol: 'http:', hostname: 'localhost', origin: 'http://localhost' } });
  ({ buildRecentGames, matchPlayedGame } = await import('./homeLibrary'));
});

const actionFighter = { id: 'a', system: 'mastersystem', fileName: 'Action Fighter (USA, Europe) (v1.1).zip', title: 'Action Fighter', boxArtUrl: '/x.png' };
const alexKidd = { id: 'b', system: 'mastersystem', fileName: 'Alex Kidd in Miracle World (USA, Europe).zip', title: 'Alex Kidd in Miracle World' };
const pilotwings = { id: 'c', system: 'snes', fileName: 'Pilotwings (USA).sfc', title: 'Pilotwings' };
const games = [actionFighter, alexKidd, pilotwings];

describe('matchPlayedGame', () => {
  it('matches a ROM unpacked from an archive by title', () => {
    expect(matchPlayedGame(games, { system: 'mastersystem', game: 'Action Fighter.sms from Action Fighter' })).toBe(actionFighter);
    expect(matchPlayedGame(games, { system: 'mastersystem', game: 'Alex Kidd in Miracle World.sms from Alex Kidd in Miracle World (USA, Europe).zip' })).toBe(alexKidd);
  });

  it('still matches exact file names', () => {
    expect(matchPlayedGame(games, { system: 'snes', game: 'Pilotwings (USA).sfc' })).toBe(pilotwings);
  });

  it('does not match across systems', () => {
    expect(matchPlayedGame(games, { system: 'nes', game: 'Pilotwings.nes' })).toBe(null);
  });
});

describe('buildRecentGames', () => {
  it('uses the library title and art for archive-loaded games', () => {
    const [item] = buildRecentGames([{ system: 'mastersystem', game: 'Action Fighter.sms from Action Fighter', last_played_at: '2026-11-01T00:00:00Z', total_seconds: 30 }], games);
    expect(item.title).toBe('Action Fighter');
    expect(item.boxArt).toBe('/x.png');
  });
});

describe('art from another version', () => {
  it('uses the box art saved on a sibling version', () => {
    const plain = { id: 'p', system: 'mastersystem', fileName: 'Action Fighter.sms', title: 'Action Fighter' };
    const withArt = { id: 'q', system: 'mastersystem', fileName: 'Action Fighter (Japan).zip', title: 'Action Fighter', boxArtUrl: '/art.png' };
    const [item] = buildRecentGames([{ system: 'mastersystem', game: 'Action Fighter.sms from Action Fighter', last_played_at: '2026-11-01T00:00:00Z' }], [plain, withArt]);
    expect(item.libraryGame).toBe(plain);
    expect(item.boxArt).toBe('/art.png');
  });
});
