import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '../localLibrary/core/hash';
import { apiFetch, renewSession } from '../../api/client';
import { downloadSharedLinkGame, getSharedLinkSelection, startSharedLinkRoom } from './sharedLinkGames';
import { validLinkSelection } from './linkLibrary';

vi.mock('../../api/client', () => ({ API_BASE_URL: 'https://api.example', apiFetch: vi.fn(), renewSession: vi.fn() }));
const id = 'a'.repeat(32);
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

async function fixture() {
  const data = new Uint8Array([1, 2, 3]);
  const game = { id, file_name: 'Stunt Car Racer.adf', size: data.length, sha256: await sha256(new File([data], 'game.adf')) };
  vi.mocked(apiFetch).mockResolvedValue(game);
  vi.stubGlobal('localStorage', { getItem: () => 'local-test-token' });
  return { data, game };
}

describe('shared Link Games', () => {
  it('downloads the published disk for either player without a local library copy', async () => {
    const { data, game } = await fixture();
    const fetch = vi.fn(async () => new Response(data));
    vi.stubGlobal('fetch', fetch);
    const file = await downloadSharedLinkGame(id, game.sha256);
    expect(file.name).toBe(game.file_name);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(data);
    expect(fetch).toHaveBeenCalledWith(`https://api.example/auth/link-games/${id}/disk`, expect.objectContaining({ credentials: 'include' }));
  });

  it('rejects a different release before downloading', async () => {
    await fixture();
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(downloadSharedLinkGame(id, 'b'.repeat(64))).rejects.toThrow('does not match');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects incomplete or changed downloads', async () => {
    await fixture(); vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([9, 8, 7]))));
    await expect(downloadSharedLinkGame(id)).rejects.toThrow('incomplete or changed');
  });

  it('renews an expired session before retrying the download', async () => {
    const { data } = await fixture();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(new Response(data)));
    await downloadSharedLinkGame(id);
    expect(renewSession).toHaveBeenCalledOnce();
  });

  it('creates an Amiga Link room and preserves the shared selection in its URL', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ room_code: 'TEST42' });
    const navigate = vi.fn();
    await startSharedLinkRoom(id, navigate);
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ system: 'amiga_link', hosting_mode: 'multiplayer', party_max_players: 2, shared_link_game_id: id });
    const url = new URL(navigate.mock.calls[0][0], 'https://osg.example');
    expect(url.searchParams.get('linkGame')).toBe(id);
    expect(url.searchParams.get('returnTo')).toBe('/link-games');
  });

  it('resolves the room selection from the server without a serial message or local library', async () => {
    const { game } = await fixture();
    expect(await getSharedLinkSelection(id)).toEqual({ type: 'amiga-link-game', fileName: game.file_name, sha256: game.sha256, sharedGameId: id });
    expect(apiFetch).toHaveBeenCalledWith(`/auth/link-games/${id}`);
  });

  it('never treats peer metadata as a download URL', async () => {
    expect(validLinkSelection({ type: 'amiga-link-game', fileName: 'disk.adf', sha256: 'a'.repeat(64), sharedGameId: 'https://other.example/disk.adf' })).toBe(false);
    await expect(downloadSharedLinkGame('../secrets')).rejects.toThrow('Invalid shared');
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
