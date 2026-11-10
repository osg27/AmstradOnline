import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { buildCd32Rom, CD32_ROM_HALF, findMissingCueTracks, isCd32Media, isCd32TrackOnly, selectCd32ContentFile } from './cd32';

const encoder = new TextEncoder();
const kickstart = () => {
  const bytes = new Uint8Array(CD32_ROM_HALF).fill(1);
  bytes.set(encoder.encode('exec 40.10 (15.7.93)'), 4096);
  return bytes;
};
const extended = () => new Uint8Array(CD32_ROM_HALF).fill(2);

describe('CD32 media', () => {
  it('detects disc images but not floppies or lone tracks', () => {
    expect(isCd32Media([{ fileName: 'Game.cue' }, { fileName: 'Game.bin' }])).toBe(true);
    expect(isCd32Media([{ fileName: 'Game.CHD' }])).toBe(true);
    expect(isCd32Media([{ fileName: 'Game.adf' }])).toBe(false);
    expect(isCd32Media([{ fileName: 'Track 01.bin' }])).toBe(false);
    expect(isCd32TrackOnly('Track 02.wav')).toBe(true);
  });

  it('boots the sheet rather than a track and reports missing CUE tracks', () => {
    const cue = encoder.encode('FILE "Game (Track 1).bin" BINARY\n  TRACK 01 MODE1/2352\nFILE "Game (Track 2).bin" BINARY\n');
    const files = [{ fileName: 'Game (Track 1).bin', bytes: new Uint8Array(1) }, { fileName: 'Game.cue', bytes: cue }];
    expect(selectCd32ContentFile(files).fileName).toBe('Game.cue');
    expect(findMissingCueTracks(files)).toEqual(['Game (Track 2).bin']);
    expect(findMissingCueTracks([...files, { fileName: 'game (track 2).BIN', bytes: new Uint8Array(1) }])).toEqual([]);
  });
});

describe('CD32 firmware', () => {
  it('combines separate Kickstart and extended ROMs as extended then Kickstart', () => {
    const rom = buildCd32Rom([{ fileName: 'kick40060.CD32', bytes: kickstart() }, { fileName: 'cd32.rom', bytes: extended() }]);
    expect(rom.bytes.length).toBe(CD32_ROM_HALF * 2);
    expect(rom.bytes[0]).toBe(2);
    expect(rom.bytes[CD32_ROM_HALF]).toBe(1);
  });

  it('accepts a zip and reorders a combined ROM stored Kickstart-first', () => {
    const combined = new Uint8Array(CD32_ROM_HALF * 2);
    combined.set(kickstart(), 0);
    combined.set(extended(), CD32_ROM_HALF);
    const rom = buildCd32Rom([{ fileName: 'cd32.zip', bytes: zipSync({ 'CD32 KS+ext.rom': combined }) }]);
    expect(rom.bytes[0]).toBe(2);
    expect(rom.bytes[CD32_ROM_HALF]).toBe(1);
  });

  it('rejects a lone Kickstart without the extended ROM', () => {
    expect(() => buildCd32Rom([{ fileName: 'kick40060.CD32', bytes: kickstart() }])).toThrow('extended ROM');
  });
});
