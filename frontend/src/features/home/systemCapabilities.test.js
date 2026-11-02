import { describe, expect, it } from 'vitest';
import { getSystemCapabilities, systemFamily } from './systemCapabilities';
import { formatDuration, formatPlayedAgo, isRecentScoreLive, titleFromPlayedFile } from './homeFormat';

describe('system capabilities', () => {
  it('maps room systems onto the user-facing system', () => {
    expect(systemFamily('cpc_party')).toBe('cpc');
    expect(systemFamily('amiga_aga')).toBe('amiga');
    expect(systemFamily('amiga_link')).toBe('amiga');
    expect(systemFamily('snes')).toBe('snes');
  });

  it('offers Party Mode only on CPC and C64, and the arcade as one cabinet', () => {
    expect(getSystemCapabilities('cpc').party).toEqual({ roomSystem: 'cpc_party' });
    expect(getSystemCapabilities('c64').party).toEqual({ roomSystem: 'c64' });
    expect(getSystemCapabilities('megadrive').party).toBeNull();
    const arcade = getSystemCapabilities('arcade');
    expect(arcade.cabinet).toBe(true);
    expect(arcade.online).toBe(false);
    expect(arcade.party).toBeNull();
  });

  it('offers Link Play only on Amiga, marked as testing', () => {
    expect(getSystemCapabilities('amiga').link).toEqual({ roomSystem: 'amiga_link', testing: true });
    expect(getSystemCapabilities('cpc').link).toBeNull();
  });

  it('lists RetroAchievements and high scores only where they exist', () => {
    ['megadrive', 'mastersystem', 'snes', 'nes', 'cpc'].forEach((id) => {
      expect(getSystemCapabilities(id).retroAchievements).toBe(true);
    });
    ['arcade', 'amiga', 'c64', 'pcengine'].forEach((id) => {
      expect(getSystemCapabilities(id).retroAchievements).toBe(false);
    });
    expect(getSystemCapabilities('arcade').highScores).toBe('all');
    expect(getSystemCapabilities('amiga').highScores).toBe('some');
    expect(getSystemCapabilities('snes').highScores).toBeNull();
  });

  it('never exposes save states', () => {
    expect(Object.keys(getSystemCapabilities('snes'))).not.toContain('saveStates');
  });
});

describe('home formatting', () => {
  const now = new Date('2026-11-01T12:00:00Z').getTime();

  it('formats play time and recency', () => {
    expect(formatDuration(3 * 3600 + 12 * 60)).toBe('3h 12m');
    expect(formatDuration(48 * 60)).toBe('48 min');
    expect(formatDuration(20)).toBe('under a minute');
    expect(formatPlayedAgo('2026-11-01T10:00:00Z', now)).toBe('2 hours ago');
    expect(formatPlayedAgo('2026-10-31T09:00:00Z', now)).toBe('yesterday');
  });

  it('marks a score live only when it is under 24 hours old', () => {
    expect(isRecentScoreLive('2026-11-01T01:00:00Z', now)).toBe(true);
    expect(isRecentScoreLive('2026-10-31T11:59:00Z', now)).toBe(false);
    expect(isRecentScoreLive('not a date', now)).toBe(false);
  });

  it('turns a played file name into a readable title', () => {
    expect(titleFromPlayedFile('Sonic The Hedgehog (Europe).md', 'megadrive')).toBe('Sonic The Hedgehog');
    expect(titleFromPlayedFile('Lemmings_v1.2.lha', 'amiga')).toBe('Lemmings v1.2');
  });
});
