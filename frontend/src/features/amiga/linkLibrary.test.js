import { describe, expect, it, vi } from 'vitest';
import { gzipSync, zipSync } from 'fflate';
import { describeLinkDisk, findLinkLibraryDisk, linkLibraryEntries, prepareLinkDisks, resolveLinkKickstart, validLinkSelection, sameLinkSelection, preserveSharedLinkSource } from './linkLibrary';

const disk = (name = 'Stunt Car Racer.adf', data = [1, 2, 3]) => new File([new Uint8Array(data)], name);
const entry = (file, extra = {}) => ({ system: 'amiga', fileName: file.name, title: 'Stunt Car Racer', ...extra });

describe('Link Play library boot', () => {
  it('loads each player’s own exact disk, even when a different release has the same name', async () => {
    const good = disk();
    const selection = await describeLinkDisk(good);
    const bad = disk(good.name, [9]);
    const readLocal = vi.fn(async (item) => item.file);
    const result = await findLinkLibraryDisk(selection, [entry(bad, { file: bad }), entry(good, { file: good })], { readLocal });
    expect(await result.arrayBuffer()).toEqual(await good.arrayBuffer());
    expect(readLocal).toHaveBeenCalledTimes(2);
  });

  it('uses a matching disk inside the guest’s own connected source zip', async () => {
    const file = disk();
    const selection = await describeLinkDisk(file);
    const sourceEntry = { url: 'https://guest-library.example/game.zip', file_name: 'Amiga/Stunt Car Racer.zip', title: 'Stunt Car Racer' };
    const entries = linkLibraryEntries([], [{ id: 'guest', system: 'amiga', games: [sourceEntry] }]);
    const download = vi.fn(async () => new File([zipSync({ 'other.adf': new Uint8Array([8]), 'Stunt Car Racer.adf': new Uint8Array([1, 2, 3]) })], sourceEntry.file_name));
    const result = await findLinkLibraryDisk(selection, entries, { download });
    expect(await result.arrayBuffer()).toEqual(await file.arrayBuffer());
    expect(download).toHaveBeenCalledWith(sourceEntry, 'amiga');
    expect(selection).not.toHaveProperty('url');
  });

  it('matches a compressed ADZ against the same uncompressed ADF', async () => {
    const file = disk();
    const compressed = new File([gzipSync(new Uint8Array(await file.arrayBuffer()))], 'Stunt Car Racer.adz');
    const result = await findLinkLibraryDisk(await describeLinkDisk(file), [entry(compressed)], { readLocal: async () => compressed });
    expect((await describeLinkDisk(result)).sha256).toBe((await describeLinkDisk(file)).sha256);
  });

  it('reports missing games and mismatched releases instead of loading another version', async () => {
    const selection = await describeLinkDisk(disk());
    await expect(findLinkLibraryDisk(selection, [], {})).rejects.toThrow('missing from your library');
    await expect(findLinkLibraryDisk(selection, [entry(disk())], { readLocal: async () => disk('Stunt Car Racer.adf', [9]) })).rejects.toThrow('different version');
  });

  it('only asks for folder permission when needed and never opens a picker automatically', async () => {
    const selection = await describeLinkDisk(disk());
    const requestPermission = vi.fn();
    const readLocal = vi.fn();
    await expect(findLinkLibraryDisk(selection, [entry(disk(), { handle: { queryPermission: async () => 'prompt', requestPermission } })], { readLocal })).rejects.toThrow('Allow access');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(readLocal).not.toHaveBeenCalled();
  });

  it('does not download unrelated games or trust peer download addresses', async () => {
    const download = vi.fn();
    const selection = { ...await describeLinkDisk(disk()), url: 'https://host.example/private' };
    await expect(findLinkLibraryDisk(selection, [{ ...entry(disk('Lotus.adf')), title: 'Lotus', source: 'public-url' }], { download })).rejects.toThrow('missing');
    expect(download).not.toHaveBeenCalled();
  });

  it('rejects malformed peer metadata and unsupported disk formats', async () => {
    expect(validLinkSelection({ type: 'amiga-link-game', fileName: 'Stunt.adf', sha256: 'bad' })).toBe(false);
    await expect(prepareLinkDisks(disk('Stunt.lha'))).rejects.toThrow('floppy release');
    await expect(prepareLinkDisks(disk('Stunt.ipf'))).rejects.toThrow('floppy release');
  });

  it('orders floppy disks and excludes Kickstarts, WHDLoad and non-Amiga libraries', async () => {
    const entries = linkLibraryEntries([entry(disk()), entry(disk('kick.rom')), entry(disk('Stunt.lha')), entry(disk(), { system: 'c64' })], []);
    expect(entries).toHaveLength(1);
    const files = await prepareLinkDisks(new File([zipSync({ 'disk 2.adf': new Uint8Array([2]), 'disk 1.adf': new Uint8Array([1]), 'kick.rom': new Uint8Array([0]) })], 'Stunt.zip'));
    expect(files.map((file) => file.name)).toEqual(['disk 1.adf', 'disk 2.adf']);
  });

  it('reuses saved A500 firmware without contacting the configured source', async () => {
    const stored = { fileName: 'kick.rom', bytes: new Uint8Array([1]) };
    const cacheSource = vi.fn();
    expect(await resolveLinkKickstart({ loadStored: async () => stored, sourceUrl: 'https://own.example/kick.zip', cacheSource,
      identify: async () => [{ kickstart: { model: 'A500' } }] })).toBe(stored);
    expect(cacheSource).not.toHaveBeenCalled();
  });

  it('automatically uses the player’s configured Kickstart source when their cached ROM is missing', async () => {
    const stored = { fileName: 'kick.rom', bytes: new Uint8Array([1]) };
    const loadStored = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(stored);
    const cacheSource = vi.fn();
    expect(await resolveLinkKickstart({ loadStored, sourceUrl: 'https://own.example/kick.zip', cacheSource,
      identify: async () => [{ kickstart: { model: 'A500' } }] })).toBe(stored);
    expect(cacheSource).toHaveBeenCalledWith('https://own.example/kick.zip');
  });

  it('explains missing or wrong-model firmware instead of silently starting AROS', async () => {
    await expect(resolveLinkKickstart({ loadStored: async () => null })).rejects.toThrow('Kickstart 1.3 is missing');
    await expect(resolveLinkKickstart({ loadStored: async () => ({ bytes: new Uint8Array([1]) }),
      identify: async () => [{ kickstart: { model: 'A1200' } }] })).rejects.toThrow('requires A500');
  });
});


describe('shared room metadata delivery', () => {
  it('upgrades a byte-identical selection when its shared source becomes known', () => {
    const local = { type: 'amiga-link-game', fileName: 'game.adf', sha256: 'a'.repeat(64) };
    const shared = { ...local, sharedGameId: 'b'.repeat(32) };
    expect(sameLinkSelection(local, shared)).toBe(false);
    expect(sameLinkSelection(shared, { ...shared })).toBe(true);
    expect(preserveSharedLinkSource(local, shared)).toEqual(shared);
  });

  it('does not relabel a different host-selected disk as the room?s shared ADF', () => {
    const shared = { sha256: 'a'.repeat(64), sharedGameId: 'b'.repeat(32) };
    const changed = { sha256: 'c'.repeat(64) };
    expect(preserveSharedLinkSource(changed, shared)).toBe(changed);
  });
});
