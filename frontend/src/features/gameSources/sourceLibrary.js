import { API_BASE_URL, renewSession } from '../../api/client';

export const SOURCE_SYSTEMS = new Set(['cpc', 'spectrum', 'c64', 'msx', 'amiga', 'amiga_aga', 'mastersystem', 'megadrive', 'nes', 'snes', 'pcengine', 'arcade']);
export const MAX_SOURCE_FILE_BYTES = 128 * 1024 * 1024;
const catalogueSessions = new Map();
const artworkSessions = new Map();
export const peekSourceCatalogues = (username) => catalogueSessions.get(username);
export const peekSourceArtwork = (username) => artworkSessions.get(username);

export async function loadSourceArtwork(username) {
  if (artworkSessions.has(username)) return artworkSessions.get(username);
  const saved = await catalogueTransaction('readonly', `artwork-front-v1:${username}`) || {};
  artworkSessions.set(username, saved);
  return saved;
}

export async function saveSourceArtwork(username, artwork) {
  artworkSessions.set(username, artwork);
  await catalogueTransaction('readwrite', `artwork-front-v1:${username}`, artwork);
}

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
        && typeof game.file_name === 'string' && typeof game.title === 'string'),
    })) : [];
  } catch {
    return [];
  }
}

export function writeSources(storage, username, sources) {
  if (sources.length > 20) throw new Error('You can save up to 20 sources in this preview. Remove an old source first.');
  storage.setItem(sourceStorageKey(username), JSON.stringify(sources));
}

// Large catalogues exceed localStorage's small synchronous quota. Store metadata
// in a separate IndexedDB database; never store the downloaded game bytes here.
async function catalogueTransaction(mode, username, sources) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('oldstylegaming-connected-sources', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('catalogues');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other library tabs and try again.'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('catalogues', mode);
      const store = tx.objectStore('catalogues');
      const request = mode === 'readonly' ? store.get(sourceStorageKey(username)) : store.put(sources, sourceStorageKey(username));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || new Error('Catalogue storage failed'));
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function loadSourceCatalogues(username) {
  if (catalogueSessions.has(username)) return catalogueSessions.get(username);
  const saved = await catalogueTransaction('readonly', username);
  if (saved !== undefined) { catalogueSessions.set(username, saved); return saved; }
  const legacy = readSources(localStorage, username);
  if (legacy.length) await saveSourceCatalogues(username, legacy);
  catalogueSessions.set(username, legacy);
  return legacy;
}

export async function saveSourceCatalogues(username, sources) {
  if (sources.length > 20) throw new Error('Remove an old source before adding more than 20 sources.');
  await catalogueTransaction('readwrite', username, sources);
  catalogueSessions.set(username, sources);
  // Migration completes only after the IndexedDB transaction has committed.
  try { localStorage.removeItem(sourceStorageKey(username)); } catch { /* optional cleanup */ }
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
