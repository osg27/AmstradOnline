import { describe, expect, it } from 'vitest';
import { createManifest } from './manifest';
import { groupGames } from './group';
import { normaliseFilename } from './normalise';

function scanned(name) {
  const parsed = normaliseFilename(name);
  return {
    id: name,
    name,
    path: `TestAmiga/${name}`,
    extension: 'zip',
    size: 10,
    type: 'application/zip',
    lastModified: 1,
    file: { name },
    platform: 'amiga',
    ...parsed,
  };
}

describe('TOSEC parsing and grouping', () => {
  it('builds a single ZIP game', () => {
    const games = groupGames([scanned('Ugh! (1992)(Global Software).zip')]);
    expect(games).toHaveLength(1);
    expect(games[0].title).toBe('Ugh!');
    expect(games[0].releases[0].isComplete).toBe(true);
  });

  it('orders and completes a two-disk release', () => {
    const games = groupGames([
      scanned('Universe 3 (1990)(Omnitrend)(US)(Disk 2 of 2).zip'),
      scanned('Universe 3 (1990)(Omnitrend)(US)(Disk 1 of 2).zip'),
    ]);
    expect(games[0].releases[0].media.map((item) => item.diskNumber)).toEqual([1, 2]);
    expect(games[0].releases[0].isComplete).toBe(true);
  });

  it('separates incompatible disk totals, demos, CD32, and installed sets', () => {
    const files = [
      scanned('UFO - Enemy Unknown (1994)(MicroProse)(Disk 1 of 4).zip'),
      scanned('UFO - Enemy Unknown (1994)(MicroProse)(Disk 1 of 5).zip'),
      scanned('UFO - Enemy Unknown (demo-rolling)(AGA)(Disk 1 of 6)[HD].zip'),
      scanned('UFO - Enemy Unknown CD32 (1994)(Disk 1 of 7)[HD, CD32 rip].zip'),
      scanned('Ultima VI (1990)(Disk 1 of 3)[FD-HD].zip'),
      scanned('Ultima VI (1990)(Disk 1 of 4)[FD installed].zip'),
    ];
    const games = groupGames(files);
    const ufo = games.find((game) => game.title === 'UFO - Enemy Unknown');
    expect(ufo.releases.map((release) => release.media[0].diskCount).sort()).toEqual([4, 5, 6, 7]);
    const ultima = games.find((game) => game.title === 'Ultima VI');
    expect(ultima.releases).toHaveLength(2);
  });

  it('keeps crack alternatives and avoids questionable defaults', () => {
    const games = groupGames([
      scanned('Ugh! (1992)(Global Software).zip'),
      scanned('Ugh! (1992)(Global Software)[cr PSG].zip'),
      scanned('Ugh! (1992)(Global Software)[cr Bad Karma].zip'),
      scanned('Ugh! (1992)(Global Software)[b corrupt file].zip'),
      scanned('Ugh! (1992)(Global Software)[v virus].zip'),
      scanned('Ugh! (1992)(Global Software)[t +8 Backlash].zip'),
      scanned('Ugh! (1992)(Global Software)[h Fast Eddie].zip'),
    ]);
    expect(games[0].releases.length).toBeGreaterThan(2);
    const selected = games[0].releases.find((release) => release.id === games[0].defaultReleaseId);
    expect(selected.metadata.tags).toEqual([]);
  });

  it('can safely reuse clean data disks for a crack-specific boot disk', () => {
    const game = groupGames([
      scanned('Game (1992)(Publisher)(Disk 1 of 3)[cr PSG].zip'),
      scanned('Game (1992)(Publisher)(Disk 2 of 3).zip'),
      scanned('Game (1992)(Publisher)(Disk 3 of 3).zip'),
    ])[0];
    const cracked = game.releases.find((release) => release.metadata.tags.includes('cr PSG'));
    expect(cracked.isComplete).toBe(true);
    expect(cracked.media.map((media) => media.diskNumber)).toEqual([1, 2, 3]);
    expect(cracked.warnings.join(' ')).toContain('shared');
  });

  it('exports metadata without File objects', () => {
    const manifest = createManifest(groupGames([scanned('Ugh! (1992)(Global Software).zip')]));
    expect(JSON.stringify(manifest)).not.toContain('"file"');
    expect(manifest.games[0].releases[0].media[0].name).toContain('Ugh!');
  });
});
