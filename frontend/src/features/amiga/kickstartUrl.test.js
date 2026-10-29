import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { sha1Bytes } from '../localLibrary/core/hash';
import { identifyKickstartDownload, validateKickstartUrl } from './kickstartUrl';

describe('personal Kickstart URL imports', () => {
  it('accepts web URLs and rejects credentials and other protocols', () => {
    expect(validateKickstartUrl('https://example.com/roms.zip')).toBe('https://example.com/roms.zip');
    expect(() => validateKickstartUrl('file:///roms.zip')).toThrow();
    expect(() => validateKickstartUrl('https://user:password@example.com/roms.zip')).toThrow();
  });

  it('identifies both ROMs by contents even with misleading filenames', async () => {
    const a500 = new Uint8Array(256 * 1024).fill(1);
    const a1200 = new Uint8Array(512 * 1024).fill(2);
    const catalogue = [
      { id: 'a500', model: 'A500', sha1: await sha1Bytes(a500) },
      { id: 'a1200', model: 'A1200', sha1: await sha1Bytes(a1200) },
    ];
    const result = await identifyKickstartDownload(zipSync({ 'folder/wrong.bin': a500, 'another.rom': a1200, 'readme.txt': new Uint8Array([1]) }), catalogue);
    expect(result.map((rom) => rom.kickstart.model)).toEqual(['A500', 'A1200']);
    expect(result[0].fileName).toBe('wrong.bin');
    expect((await identifyKickstartDownload(a500, catalogue))[0].kickstart.model).toBe('A500');
  });

  it('rejects a ROM with the right size but an unknown checksum', async () => {
    await expect(identifyKickstartDownload(new Uint8Array(256 * 1024))).rejects.toThrow('checksums must match');
  });
});
