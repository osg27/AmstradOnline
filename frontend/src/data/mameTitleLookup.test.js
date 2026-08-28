import { describe, expect, it } from 'vitest';
import { getMameDisplayName } from './mameTitleLookup';

describe('MAME display names', () => {
  it('resolves ROM archives to their real catalogue title', () => {
    expect(getMameDisplayName('ddragon.zip')).toBe('Double Dragon');
  });

  it('resolves clone ROM names to their specific title', () => {
    expect(getMameDisplayName('ddragonu')).toBe('Double Dragon (US)');
  });

  it('uses a readable fallback for unknown ROMs', () => {
    expect(getMameDisplayName('some_game.zip')).toBe('Some Game');
  });
});
