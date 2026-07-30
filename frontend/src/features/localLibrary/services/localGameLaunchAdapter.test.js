import { describe, expect, it } from 'vitest';
import { orderedReleaseFiles, prepareLocalGameLaunch } from './localGameLaunchAdapter';

describe('local game launch adapter', () => {
  it('passes File objects in numeric disk order', () => {
    const disk1 = { name: 'disk1.zip' };
    const disk2 = { name: 'disk2.zip' };
    expect(orderedReleaseFiles({
      media: [
        { diskNumber: 2, name: disk2.name, file: disk2 },
        { diskNumber: 1, name: disk1.name, file: disk1 },
      ],
    })).toEqual([disk1, disk2]);
  });

  it.each([
    ['amiga', 'amiga'],
    ['c64', 'c64'],
    ['spectrum', 'spectrum'],
    ['amstrad', 'cpc'],
  ])('routes %s releases to the existing %s player', (platform, roomSystem) => {
    const storage = { getItem: () => null, removeItem: () => {} };
    const game = {
      id: `${platform}-game`,
      platform,
      defaultReleaseId: 'release',
      releases: [{
        id: 'release',
        isComplete: true,
        metadata: { machine: [] },
        media: [{ diskNumber: 1, name: 'game.zip', file: { name: 'game.zip' } }],
      }],
    };
    expect(prepareLocalGameLaunch(game, storage).roomSystem).toBe(roomSystem);
  });
});
