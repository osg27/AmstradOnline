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

  it('does not infer A1200 merely because an Amiga release has multiple disks', () => {
    const storage = { getItem: () => null, removeItem: () => {} };
    const game = {
      id: 'amiga-agony',
      platform: 'amiga',
      defaultReleaseId: 'release',
      releases: [{
        id: 'release',
        isComplete: true,
        metadata: { machine: [] },
        media: [1, 2, 3].map((diskNumber) => ({
          diskNumber,
          name: `disk${diskNumber}.zip`,
          file: { name: `disk${diskNumber}.zip` },
        })),
      }],
    };
    const launch = prepareLocalGameLaunch(game, storage);
    expect(launch.roomSystem).toBe('amiga');
    expect(launch.files).toHaveLength(3);
  });

  it('routes a resolved A1200 release through PUAE', () => {
    const storage = { getItem: () => null, removeItem: () => {} };
    const game = {
      id: 'amiga-aga', platform: 'amiga', defaultReleaseId: 'release',
      releases: [{ id: 'release', isComplete: true, metadata: { machine: [] }, amiga: { launchConfiguration: { model: 'A1200' } }, media: [{ diskNumber: 1, name: 'game.adf', file: { name: 'game.adf' } }] }],
    };
    expect(prepareLocalGameLaunch(game, storage).roomSystem).toBe('amiga_aga');
  });

  it('routes a WHDLoad archive through the HD-capable A1200 PUAE room', () => {
    const storage = { getItem: () => null, removeItem: () => {} };
    const game = {
      id: 'amiga-lotus-2', platform: 'amiga', defaultReleaseId: 'release',
      releases: [{
        id: 'release',
        isComplete: true,
        metadata: { machine: [] },
        media: [{ name: 'Lotus2_v1.11_0497.lha', file: { name: 'Lotus2_v1.11_0497.lha' } }],
      }],
    };
    expect(prepareLocalGameLaunch(game, storage).roomSystem).toBe('amiga_aga');
  });
});
