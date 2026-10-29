import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { prepareX68000Media, x68000JoyBits, x68000KeyboardJoystickBit } from './media';

describe('X68000 WebX68k media', () => {
  it('boots a hard drive directly', () => {
    expect(prepareX68000Media({ fileName: 'Game.hdf', bytes: [1, 2] }).primary).toBe('Game.hdf');
  });
  it('creates a playlist for two floppies and preserves archive paths', () => {
    const bytes = zipSync({ 'Game/Disk1.dim': new Uint8Array([1]), 'Game/Disk2.dim': new Uint8Array([2]), 'readme.txt': new Uint8Array([3]) });
    const result = prepareX68000Media({ fileName: 'Game.zip', bytes });
    expect(result.primary).toBe('osg-disks.m3u');
    expect(new TextDecoder().decode(result.files.at(-1).bytes)).toBe('Game/Disk1.dim\nGame/Disk2.dim');
  });
  it('uses supplied playlists and rejects path traversal', () => {
    expect(prepareX68000Media({ files: [{ fileName: 'Disk.xdf', bytes: [1] }, { fileName: 'Game.m3u', bytes: [2] }] }).primary).toBe('Game.m3u');
    expect(() => prepareX68000Media({ fileName: '../game.hdf', bytes: [1] })).toThrow('unsafe');
  });
  it('maps room joystick controls to libretro button bits', () => {
    expect(x68000JoyBits(1 | 16 | 32)).toBe((1 << 4) | (1 << 8) | 1);
    expect(x68000JoyBits(0)).toBe(0);
    expect(x68000KeyboardJoystickBit('ArrowUp')).toBe(1);
    expect(x68000KeyboardJoystickBit('X')).toBe(16);
    expect(x68000KeyboardJoystickBit('z')).toBe(32);
    expect(x68000KeyboardJoystickBit('F12')).toBe(0);
  });
});
