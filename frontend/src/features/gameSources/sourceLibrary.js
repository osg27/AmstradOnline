import { API_BASE_URL, renewSession } from '../../api/client';

export const SOURCE_SYSTEMS = new Set(['cpc', 'spectrum', 'c64', 'msx', 'amiga', 'amiga_aga', 'mastersystem', 'megadrive', 'nes', 'snes', 'pcengine', 'arcade']);
export const MAX_SOURCE_FILE_BYTES = 128 * 1024 * 1024;

export function sourceStorageKey(username) {
  return `oldstylegaming:connected-sources:v1:${username || 'anonymous'}`;
}

export function readSources(storage, username) {
  try {
    const entries = JSON.parse(storage.getItem(sourceStorageKey(username)) || '[]');
    return Array.isArray(entries) ? entries.filter((source) => (
      source && typeof source.id === 'string' && typeof source.url === 'string'
      && typeof source.label === 'string' && SOURCE_SYSTEMS.has(source.system)
      && Array.isArray(source.games)
    )).slice(0, 20).map((source) => ({
      ...source,
      games: source.games.filter((game) => game && typeof game.url === 'string'
        && typeof game.file_name === 'string' && typeof game.title === 'string').slice(0, 500),
    })) : [];
  } catch {
    return [];
  }
}

export function writeSources(storage, username, sources) {
  if (sources.length > 20) throw new Error('You can save up to 20 sources in this preview. Remove an old source first.');
  storage.setItem(sourceStorageKey(username), JSON.stringify(sources));
}

export async function downloadSourceGame(game, system, { signal, onProgress = () => {} } = {}) {
  const request = () => fetch(`${API_BASE_URL}/auth/library/sources/download`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    body: JSON.stringify({ url: game.url, system }),
    signal,
  });
  let response = await request();
  if (response.status === 401) {
    await renewSession();
    response = await request();
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(typeof error?.detail === 'string' ? error.detail : `Download failed (HTTP ${response.status})`);
  }
  const total = Number(response.headers.get('Content-Length')) || 0;
  if (total > MAX_SOURCE_FILE_BYTES) {
    await response.body?.cancel();
    throw new Error('This file exceeds the 128 MB preview limit.');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > MAX_SOURCE_FILE_BYTES) throw new Error('This file exceeds the 128 MB preview limit.');
      chunks.push(value);
      onProgress(loaded, total);
    }
    if (!loaded || (total && total !== loaded)) throw new Error('The game download was incomplete. Please try again.');
    return new File(chunks, game.file_name, { type: 'application/octet-stream' });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
