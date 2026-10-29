import { describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { sha1Bytes } from '../localLibrary/core/hash';
import { archiveKickstartListing, identifyKickstartDownload, saveKickstartSource, selectArchiveKickstartFiles, validateKickstartUrl } from './kickstartUrl';

describe('personal Kickstart URL imports', () => {
  it('resolves Archive.org listing URLs and selects supported unmodified ROM candidates', () => {
    expect(archiveKickstartListing('https://archive.org/download/commodore-amiga-firmware')).toBe('commodore-amiga-firmware');
    expect(archiveKickstartListing('https://archive.org/details/firmware/')).toBe('firmware');
    expect(archiveKickstartListing('https://example.com/download/firmware')).toBeNull();
    expect(archiveKickstartListing('https://archive.org/download/firmware/rom.zip')).toBeNull();
    const files = [
      'Kickstart v1.3 r34.005 (Commodore)(A500-A1000-A2000-CDTV)[!].zip',
      'Kickstart v3.1 r40.068 (Commodore)(A1200)[!].zip',
      'Kickstart v3.1 r40.068 (Commodore)(A1200)[encrypted, needs rom.key].zip',
      'Kickstart v1.3 r34.005 (Commodore)(A500)[h hack].zip',
      'Kickstart v3.1 r40.068 (Commodore)(A4000)[!].zip',
    ].map((name) => ({ name, size: '150000' }));
    expect(selectArchiveKickstartFiles(files)).toEqual(files.slice(0, 2));
  });

  it('keeps the URL when downloading fails so it can be retried', async () => {
    const saved = new Map();
    vi.stubGlobal('localStorage', { setItem: (key, value) => saved.set(key, value) });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    try {
      await expect(saveKickstartSource('https://example.com/roms.zip')).rejects.toThrow('Could not fetch');
      expect([...saved.values()]).toEqual(['https://example.com/roms.zip']);
    } finally { vi.unstubAllGlobals(); }
  });
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
