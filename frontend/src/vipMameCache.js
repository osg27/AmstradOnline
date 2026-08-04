import { API_BASE_URL } from './api/client';

const VIP_MAME_CACHE = 'oldstylegaming-vip-mame-v1';
const VIP_C64_CACHE = 'oldstylegaming-vip-c64-v1';
const VIP_AMIGA_CACHE = 'oldstylegaming-vip-amiga-v1';
const VIP_AMSTRAD_CACHE = 'oldstylegaming-vip-amstrad-v1';
const VIP_SPECTRUM_CACHE = 'oldstylegaming-vip-spectrum-v1';
const VIP_MEGADRIVE_CACHE = 'oldstylegaming-vip-megadrive-v1';
const VIP_PCENGINE_CACHE = 'oldstylegaming-vip-pcengine-v1';
const VIP_MASTERSYSTEM_CACHE = 'oldstylegaming-vip-mastersystem-v1';
const TOURNAMENT_MAME_CACHE = 'oldstylegaming-tournament-mame-v1';

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

function amstradCacheRequest(fileName) {
  return new Request(
    `${window.location.origin}/__vip-amstrad-cache__/${encodeURIComponent(fileName)}`,
  );
}

async function authenticatedAmstradResponse(fileName) {
  const token = localStorage.getItem('token');
  return fetch(
    `${API_BASE_URL}/auth/vip/amstrad/files/${encodeURIComponent(fileName)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
}

export async function prepareVipAmstradFile(fileName, onProgress = () => {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await authenticatedAmstradResponse(fileName);
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
      const blob = new Blob(chunks, { type: 'application/zip' });
      const cache = await caches.open(VIP_AMSTRAD_CACHE);
      await cache.put(amstradCacheRequest(fileName), new Response(blob, {
        headers: { 'Content-Type': 'application/zip', 'Content-Length': String(blob.size) },
      }));
      return blob.size;
    } catch (error) {
      lastError = error;
      if (attempt < 2) onProgress({ loaded: 0, total: 0, attempt: attempt + 1, retrying: true });
    }
  }
  throw lastError;
}

export async function takePreparedVipAmstradFile(fileName) {
  if (!('caches' in window)) return null;
  const cache = await caches.open(VIP_AMSTRAD_CACHE);
  const request = amstradCacheRequest(fileName);
  const response = await cache.match(request);
  if (!response) return null;
  await cache.delete(request);
  return new Uint8Array(await response.arrayBuffer());
}

function spectrumCacheRequest(fileName) {
  return new Request(
    `${window.location.origin}/__vip-spectrum-cache__/${encodeURIComponent(fileName)}`,
  );
}

async function authenticatedSpectrumResponse(fileName) {
  const token = localStorage.getItem('token');
  return fetch(
    `${API_BASE_URL}/auth/vip/spectrum/files/${encodeURIComponent(fileName)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
}

export async function prepareVipSpectrumFile(fileName, onProgress = () => {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await authenticatedSpectrumResponse(fileName);
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
      const blob = new Blob(chunks, { type: 'application/zip' });
      const cache = await caches.open(VIP_SPECTRUM_CACHE);
      await cache.put(spectrumCacheRequest(fileName), new Response(blob, {
        headers: { 'Content-Type': 'application/zip', 'Content-Length': String(blob.size) },
      }));
      return blob.size;
    } catch (error) {
      lastError = error;
      if (attempt < 2) onProgress({ loaded: 0, total: 0, attempt: attempt + 1, retrying: true });
    }
  }
  throw lastError;
}

export async function takePreparedVipSpectrumFile(fileName) {
  if (!('caches' in window)) return null;
  const cache = await caches.open(VIP_SPECTRUM_CACHE);
  const request = spectrumCacheRequest(fileName);
  const response = await cache.match(request);
  if (!response) return null;
  await cache.delete(request);
  return new Uint8Array(await response.arrayBuffer());
}

function megadriveCacheRequest(fileName) {
  return new Request(
    `${window.location.origin}/__vip-megadrive-cache__/${encodeURIComponent(fileName)}`,
  );
}

async function authenticatedMegadriveResponse(fileName) {
  const token = localStorage.getItem('token');
  return fetch(
    `${API_BASE_URL}/auth/vip/megadrive/files/${encodeURIComponent(fileName)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
}

export async function prepareVipMegadriveFile(fileName, onProgress = () => {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await authenticatedMegadriveResponse(fileName);
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
      const blob = new Blob(chunks, { type: 'application/zip' });
      const cache = await caches.open(VIP_MEGADRIVE_CACHE);
      await cache.put(megadriveCacheRequest(fileName), new Response(blob, {
        headers: { 'Content-Type': 'application/zip', 'Content-Length': String(blob.size) },
      }));
      return blob.size;
    } catch (error) {
      lastError = error;
      if (attempt < 2) onProgress({ loaded: 0, total: 0, attempt: attempt + 1, retrying: true });
    }
  }
  throw lastError;
}

export async function takePreparedVipMegadriveFile(fileName) {
  if (!('caches' in window)) return null;
  const cache = await caches.open(VIP_MEGADRIVE_CACHE);
  const request = megadriveCacheRequest(fileName);
  const response = await cache.match(request);
  if (!response) return null;
  await cache.delete(request);
  return new Uint8Array(await response.arrayBuffer());
}

function pcengineCacheRequest(fileName) {
  return new Request(
    `${window.location.origin}/__vip-pcengine-cache__/${encodeURIComponent(fileName)}`,
  );
}

async function authenticatedPcengineResponse(fileName) {
  const token = localStorage.getItem('token');
  return fetch(
    `${API_BASE_URL}/auth/vip/pcengine/files/${encodeURIComponent(fileName)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
}

export async function prepareVipPcengineFile(fileName, onProgress = () => {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await authenticatedPcengineResponse(fileName);
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
      const blob = new Blob(chunks, { type: 'application/x-7z-compressed' });
      const cache = await caches.open(VIP_PCENGINE_CACHE);
      await cache.put(pcengineCacheRequest(fileName), new Response(blob, {
        headers: { 'Content-Type': 'application/x-7z-compressed', 'Content-Length': String(blob.size) },
      }));
      return blob.size;
    } catch (error) {
      lastError = error;
      if (attempt < 2) onProgress({ loaded: 0, total: 0, attempt: attempt + 1, retrying: true });
    }
  }
  throw lastError;
}

export async function takePreparedVipPcengineFile(fileName) {
  if (!('caches' in window)) return null;
  const cache = await caches.open(VIP_PCENGINE_CACHE);
  const request = pcengineCacheRequest(fileName);
  const response = await cache.match(request);
  if (!response) return null;
  await cache.delete(request);
  return new Uint8Array(await response.arrayBuffer());
}

function mastersystemCacheRequest(fileName) {
  return new Request(`${window.location.origin}/__vip-mastersystem-cache__/${encodeURIComponent(fileName)}`);
}

async function authenticatedMastersystemResponse(fileName) {
  const token = localStorage.getItem('token');
  return fetch(`${API_BASE_URL}/auth/vip/mastersystem/files/${encodeURIComponent(fileName)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export async function prepareVipMastersystemFile(fileName, onProgress = () => {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await authenticatedMastersystemResponse(fileName);
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
      const blob = new Blob(chunks, { type: 'application/x-7z-compressed' });
      const cache = await caches.open(VIP_MASTERSYSTEM_CACHE);
      await cache.put(mastersystemCacheRequest(fileName), new Response(blob, {
        headers: { 'Content-Type': 'application/x-7z-compressed', 'Content-Length': String(blob.size) },
      }));
      return blob.size;
    } catch (error) {
      lastError = error;
      if (attempt < 2) onProgress({ loaded: 0, total: 0, attempt: attempt + 1, retrying: true });
    }
  }
  throw lastError;
}

export async function takePreparedVipMastersystemFile(fileName) {
  if (!('caches' in window)) return null;
  const cache = await caches.open(VIP_MASTERSYSTEM_CACHE);
  const request = mastersystemCacheRequest(fileName);
  const response = await cache.match(request);
  if (!response) return null;
  await cache.delete(request);
  return new Uint8Array(await response.arrayBuffer());
}

export function extractPrepared7zFile(bytes, allowedExtensions) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/emulatorjs/data/compression/extract7z.js');
    const matches = [];
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('Timed out extracting the downloaded game archive'));
    }, 30000);
    const finish = (error, value) => {
      window.clearTimeout(timeout);
      worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    worker.onerror = () => finish(new Error('Could not extract the downloaded game archive'));
    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.t === 2) {
        const fileName = String(message.file || '');
        if (allowedExtensions.some((extension) => fileName.toLowerCase().endsWith(extension))) {
          matches.push({ fileName, bytes: new Uint8Array(message.data) });
        }
      } else if (message.t === 1) {
        if (!matches.length) {
          finish(new Error(`Archive does not contain a supported ${allowedExtensions.join(' or ')} ROM`));
        } else {
          matches.sort((left, right) => left.fileName.localeCompare(right.fileName, undefined, { numeric: true }));
          finish(null, matches[0]);
        }
      }
    };
    worker.postMessage(bytes);
  });
}

function tournamentCacheRequest(code, fileName) {
  return new Request(
    `${window.location.origin}/__tournament-mame-cache__/${encodeURIComponent(code)}/${encodeURIComponent(fileName)}`,
  );
}

export async function prepareTournamentMameFile(code, fileName, onProgress = () => {}) {
  const token = localStorage.getItem('token');
  const response = await fetch(
    `${API_BASE_URL}/auth/tournaments/${encodeURIComponent(code)}/files/${encodeURIComponent(fileName)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
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
      onProgress({ loaded, total });
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    chunks.push(bytes);
    loaded = bytes.byteLength;
    onProgress({ loaded, total: total || loaded });
  }
  if (total && total !== loaded) throw new Error(`Download ended early for ${fileName}`);
  const blob = new Blob(chunks, { type: 'application/zip' });
  const cache = await caches.open(TOURNAMENT_MAME_CACHE);
  await cache.put(tournamentCacheRequest(code, fileName), new Response(blob));
  return blob.size;
}

export async function takePreparedTournamentMameFile(code, fileName) {
  if (!('caches' in window)) return null;
  const cache = await caches.open(TOURNAMENT_MAME_CACHE);
  const request = tournamentCacheRequest(code, fileName);
  const response = await cache.match(request);
  if (!response) return null;
  await cache.delete(request);
  return new Uint8Array(await response.arrayBuffer());
}
