import { API_BASE_URL } from './api/client';

const VIP_MAME_CACHE = 'oldstylegaming-vip-mame-v1';
const VIP_C64_CACHE = 'oldstylegaming-vip-c64-v1';
const VIP_AMIGA_CACHE = 'oldstylegaming-vip-amiga-v1';

function cacheRequest(directory, fileName) {
  return new Request(
    `${window.location.origin}/__vip-mame-cache__/${directory}/${encodeURIComponent(fileName)}`,
  );
}

async function authenticatedArchiveResponse(directory, fileName) {
  const token = localStorage.getItem('token');
  return fetch(
    `${API_BASE_URL}/auth/vip/mame/files/${directory}/${encodeURIComponent(fileName)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
}

export async function prepareVipMameFile(directory, fileName, onProgress = () => {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await authenticatedArchiveResponse(directory, fileName);
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.detail || `Could not download ${fileName}`);
      }

      const total = Number(response.headers.get('Content-Length')) || 0;
      const reader = response.body?.getReader();
      const chunks = [];
      let loaded = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.byteLength;
          onProgress({ loaded, total, attempt });
        }
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer());
        chunks.push(bytes);
        loaded = bytes.byteLength;
        onProgress({ loaded, total: total || loaded, attempt });
      }

      if (total && loaded !== total) {
        throw new Error(`Download ended early for ${fileName}`);
      }
      const blob = new Blob(chunks, { type: 'application/zip' });
      const cache = await caches.open(VIP_MAME_CACHE);
      await cache.put(
        cacheRequest(directory, fileName),
        new Response(blob, {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Length': String(blob.size),
          },
        }),
      );
      return blob.size;
    } catch (error) {
      lastError = error;
      if (attempt < 2) onProgress({ loaded: 0, total: 0, attempt: attempt + 1, retrying: true });
    }
  }
  throw lastError;
}

export async function takePreparedVipMameFile(directory, fileName) {
  if (!('caches' in window)) return null;
  const cache = await caches.open(VIP_MAME_CACHE);
  const request = cacheRequest(directory, fileName);
  const response = await cache.match(request);
  if (!response) return null;
  await cache.delete(request);
  return new Uint8Array(await response.arrayBuffer());
}

function c64CacheRequest(fileName) {
  return new Request(
    `${window.location.origin}/__vip-c64-cache__/${encodeURIComponent(fileName)}`,
  );
}

async function authenticatedC64Response(fileName) {
  const token = localStorage.getItem('token');
  return fetch(
    `${API_BASE_URL}/auth/vip/c64/files/${encodeURIComponent(fileName)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
}

export async function prepareVipC64File(fileName, onProgress = () => {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await authenticatedC64Response(fileName);
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.detail || `Could not download ${fileName}`);
      }

      const total = Number(response.headers.get('Content-Length')) || 0;
      const reader = response.body?.getReader();
      const chunks = [];
      let loaded = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.byteLength;
          onProgress({ loaded, total, attempt });
        }
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer());
        chunks.push(bytes);
        loaded = bytes.byteLength;
        onProgress({ loaded, total: total || loaded, attempt });
      }

      if (total && loaded !== total) throw new Error(`Download ended early for ${fileName}`);
      const blob = new Blob(chunks, { type: 'application/octet-stream' });
      const cache = await caches.open(VIP_C64_CACHE);
      await cache.put(c64CacheRequest(fileName), new Response(blob, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(blob.size),
        },
      }));
      return blob.size;
    } catch (error) {
      lastError = error;
      if (attempt < 2) onProgress({ loaded: 0, total: 0, attempt: attempt + 1, retrying: true });
    }
  }
  throw lastError;
}

export async function takePreparedVipC64File(fileName) {
  if (!('caches' in window)) return null;
  const cache = await caches.open(VIP_C64_CACHE);
  const request = c64CacheRequest(fileName);
  const response = await cache.match(request);
  if (!response) return null;
  await cache.delete(request);
  return new Uint8Array(await response.arrayBuffer());
}

function amigaCacheRequest(fileName) {
  return new Request(
    `${window.location.origin}/__vip-amiga-cache__/${encodeURIComponent(fileName)}`,
  );
}

async function authenticatedAmigaResponse(fileName) {
  const token = localStorage.getItem('token');
  return fetch(
    `${API_BASE_URL}/auth/vip/amiga/files/${encodeURIComponent(fileName)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
}

export async function prepareVipAmigaFile(fileName, onProgress = () => {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await authenticatedAmigaResponse(fileName);
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.detail || `Could not download ${fileName}`);
      }

      const total = Number(response.headers.get('Content-Length')) || 0;
      const reader = response.body?.getReader();
      const chunks = [];
      let loaded = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.byteLength;
          onProgress({ loaded, total, attempt });
        }
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer());
        chunks.push(bytes);
        loaded = bytes.byteLength;
        onProgress({ loaded, total: total || loaded, attempt });
      }

      if (total && loaded !== total) throw new Error(`Download ended early for ${fileName}`);
      const blob = new Blob(chunks, { type: 'application/octet-stream' });
      const cache = await caches.open(VIP_AMIGA_CACHE);
      await cache.put(amigaCacheRequest(fileName), new Response(blob, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(blob.size),
        },
      }));
      return blob.size;
    } catch (error) {
      lastError = error;
      if (attempt < 2) onProgress({ loaded: 0, total: 0, attempt: attempt + 1, retrying: true });
    }
  }
  throw lastError;
}

export async function takePreparedVipAmigaFile(fileName) {
  if (!('caches' in window)) return null;
  const cache = await caches.open(VIP_AMIGA_CACHE);
  const request = amigaCacheRequest(fileName);
  const response = await cache.match(request);
  if (!response) return null;
  await cache.delete(request);
  return new Uint8Array(await response.arrayBuffer());
}
