import { API_BASE_URL, apiFetch, renewSession } from '../../api/client';
import { sha256 } from '../localLibrary/core/hash';
import { validSharedLinkId, validLinkSelection } from './linkLibrary';
export { validSharedLinkId };

export async function getSharedLinkSelection(id) {
  if (!validSharedLinkId(id)) throw new Error('Invalid shared Link Game.');
  const game = await apiFetch(`/auth/link-games/${id}`);
  const selection = { type: 'amiga-link-game', fileName: game.file_name, sha256: game.sha256, sharedGameId: id };
  if (!validLinkSelection(selection)) throw new Error('The shared game metadata is invalid. Please retry.');
  return selection;
}

export async function downloadSharedLinkGame(id, expectedHash = '') {
  if (!validSharedLinkId(id)) throw new Error('Invalid shared Link Game.');
  const game = await apiFetch(`/auth/link-games/${id}`);
  if (expectedHash && game.sha256 !== expectedHash) throw new Error('The shared disk does not match the host’s game. Start a fresh room.');
  const request = () => fetch(`${API_BASE_URL}/auth/link-games/${id}/disk`, {
    credentials: 'include', headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
  });
  let response = await request();
  if (response.status === 401) {
    await renewSession();
    response = await request();
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.detail || 'The shared Link Game could not be downloaded.');
  }
  const file = new File([await response.arrayBuffer()], game.file_name);
  if (file.size !== game.size || await sha256(file) !== game.sha256) {
    throw new Error('The shared game download was incomplete or changed. Please retry.');
  }
  return file;
}

export async function startSharedLinkRoom(id, navigate) {
  if (!validSharedLinkId(id)) throw new Error('Invalid shared Link Game.');
  const room = await apiFetch('/rooms/create', {
    method: 'POST', body: JSON.stringify({ system: 'amiga_link', hosting_mode: 'multiplayer', party_max_players: 2, shared_link_game_id: id }),
  });
  navigate(`/room/${room.room_code}?${new URLSearchParams({ linkGame: id, returnTo: '/link-games' })}`);
}
