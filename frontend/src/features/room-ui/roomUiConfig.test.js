import { describe, expect, it } from 'vitest';
import {
  deriveGameTitle,
  detectPadKind,
  dpadMaskFromOffset,
  isKeyboardSystem,
  prettifyFileName,
  sideLayoutFor,
  touchProfileFor,
  withIndefiniteArticle,
} from './roomUiConfig';

describe('withIndefiniteArticle', () => {
  it('uses "an" before vowel sounds', () => {
    expect(withIndefiniteArticle('Amstrad CPC')).toBe('an Amstrad CPC');
    expect(withIndefiniteArticle('Atari ST')).toBe('an Atari ST');
    expect(withIndefiniteArticle('NES')).toBe('an NES');
    expect(withIndefiniteArticle('SNES')).toBe('an SNES');
    expect(withIndefiniteArticle('MSX / MSX2')).toBe('an MSX / MSX2');
    expect(withIndefiniteArticle('arcade')).toBe('an arcade');
  });

  it('uses "a" before consonant sounds', () => {
    expect(withIndefiniteArticle('Mega Drive')).toBe('a Mega Drive');
    expect(withIndefiniteArticle('ZX Spectrum')).toBe('a ZX Spectrum');
    expect(withIndefiniteArticle('PC Engine / TurboGrafx-16')).toBe('a PC Engine / TurboGrafx-16');
    expect(withIndefiniteArticle('MAME Arcade')).toBe('a MAME Arcade');
    expect(withIndefiniteArticle('Commodore 64')).toBe('a Commodore 64');
  });
});

describe('deriveGameTitle', () => {
  it('prefers library and arcade titles, then the file name, then the system', () => {
    expect(deriveGameTitle({ libraryTitle: 'Gryzor', loadedDiskName: 'x.dsk', systemLabel: 'Amstrad CPC' })).toBe('Gryzor');
    expect(deriveGameTitle({ arcadeTitle: '1943', loadedDiskName: '1943.zip' })).toBe('1943');
    expect(deriveGameTitle({ loadedDiskName: 'Streets_of_Rage_2 (USA).md', systemLabel: 'Mega Drive' })).toBe('Streets of Rage 2');
    expect(deriveGameTitle({ systemLabel: 'Mega Drive' })).toBe('Mega Drive');
  });

  it('keeps a readable fallback for odd file names', () => {
    expect(prettifyFileName('(USA).md')).toBe('(USA)');
  });
});

describe('system capabilities', () => {
  it('treats micros as keyboard systems', () => {
    ['cpc', 'spectrum', 'c64', 'msx', 'atarist', 'amiga', 'amiga_aga', 'x68000', 'atari8'].forEach((system) => {
      expect(isKeyboardSystem(system)).toBe(true);
    });
    ['megadrive', 'nes', 'snes', 'arcade', 'playstation'].forEach((system) => {
      expect(isKeyboardSystem(system)).toBe(false);
    });
  });

  it('offers touch controls only where the joystick path is safe', () => {
    expect(touchProfileFor('arcade').keys.map((key) => key.mask)).toEqual([4096, 64]);
    expect(touchProfileFor('megadrive').face.map((button) => button.mask)).toEqual([16, 32, 128]);
    expect(touchProfileFor('cpc')).toBeTruthy();
    expect(touchProfileFor('amiga')).toBeNull();
    expect(touchProfileFor('saturn_beetle')).toBeNull();
  });
});

describe('dpadMaskFromOffset', () => {
  it('maps offsets to 8-way joystick bits', () => {
    expect(dpadMaskFromOffset(0, 0)).toBe(0);
    expect(dpadMaskFromOffset(40, 0)).toBe(8);
    expect(dpadMaskFromOffset(-40, 0)).toBe(4);
    expect(dpadMaskFromOffset(0, -40)).toBe(1);
    expect(dpadMaskFromOffset(0, 40)).toBe(2);
    expect(dpadMaskFromOffset(30, -30)).toBe(9);
  });
});

describe('detectPadKind', () => {
  it('recognises arcade sticks', () => {
    expect(detectPadKind({ id: 'Xbox Wireless Controller', mapping: 'standard' })).toBe('pad');
    expect(detectPadKind({ id: '8BitDo Arcade Stick', mapping: 'standard' })).toBe('stick');
    expect(detectPadKind({ id: 'Generic USB Joystick', mapping: '' })).toBe('stick');
  });
});

describe('sideLayoutFor', () => {
  const base = { viewport: 'desktop', width: 1440, hasScores: true, hasAchievements: true, enabled: true };
  it('shows both panels when wide and both have content', () => {
    expect(sideLayoutFor(base)).toEqual({ available: true, showLeft: true, showRight: true });
  });
  it('only shows the side that has content', () => {
    expect(sideLayoutFor({ ...base, hasScores: false })).toEqual({ available: true, showLeft: false, showRight: true });
    expect(sideLayoutFor({ ...base, hasAchievements: false })).toEqual({ available: true, showLeft: true, showRight: false });
  });
  it('hides everything below the breakpoint, on phones and in OBS view', () => {
    expect(sideLayoutFor({ ...base, width: 1279 }).available).toBe(false);
    expect(sideLayoutFor({ ...base, viewport: 'phone' }).showLeft).toBe(false);
    expect(sideLayoutFor({ ...base, viewport: 'land' }).showRight).toBe(false);
    expect(sideLayoutFor({ ...base, obsCapture: true }).available).toBe(false);
  });
  it('respects the toggle but keeps it available', () => {
    expect(sideLayoutFor({ ...base, enabled: false })).toEqual({ available: true, showLeft: false, showRight: false });
  });
  it('is unavailable when there is no content', () => {
    expect(sideLayoutFor({ ...base, hasScores: false, hasAchievements: false }).available).toBe(false);
  });
});
