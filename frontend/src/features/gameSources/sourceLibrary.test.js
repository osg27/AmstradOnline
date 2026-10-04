import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../api/client', () => ({ API_BASE_URL: 'https://app.example', renewSession: vi.fn() }));
import { downloadSourceGame, readSources, writeSources } from './sourceLibrary';

afterEach(() => vi.unstubAllGlobals());

describe('connected sources', () => {
  it('keeps catalogues separated by account and tolerates corrupt storage', () => {
    const values = new Map();
    const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
    const sources = [{ id: 'a', url: 'https://example.com', label: 'Games', system: 'msx', games: [{ url: 'https://example.com/game.dsk', file_name: 'game.dsk', title: 'Game' }] }];
    writeSources(storage, 'alice', sources);
    expect(readSources(storage, 'alice')).toEqual(sources);
    expect(readSources(storage, 'bob')).toEqual([]);
    expect(readSources({ getItem: () => '{bad' }, 'alice')).toEqual([]);
  });

  it('passes the original filename and exact downloaded bytes to the File launcher', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-token' });
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Length': '3' } }));
    vi.stubGlobal('fetch', fetch);
    const file = await downloadSourceGame({ url: 'https://example.com/Game%20A.dsk', file_name: 'Game A.dsk' }, 'msx');
    expect(file.name).toBe('Game A.dsk');
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ url: 'https://example.com/Game%20A.dsk', system: 'msx' });
  });

  it('rejects an incomplete game instead of launching it', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('abc', { headers: { 'Content-Length': '5' } })));
    await expect(downloadSourceGame({ url: 'https://example.com/test.rom', file_name: 'test.rom' }, 'msx')).rejects.toThrow('incomplete');
  });
});
