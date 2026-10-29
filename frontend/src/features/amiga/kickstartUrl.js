import { unzipSync } from 'fflate';
import { sha1Bytes } from '../localLibrary/core/hash';
import { KICKSTART_CATALOGUE } from './kickstarts';

export const KICKSTART_URL_KEY = 'amiga-kickstart-source-url';

export async function saveKickstartSource(value) {
  if (!value.trim()) {
    localStorage.removeItem(KICKSTART_URL_KEY);
    return [];
  }
  const url = validateKickstartUrl(value.trim());
  localStorage.setItem(KICKSTART_URL_KEY, url);
  const roms = await downloadKickstarts(url);
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('oldstylegaming-kickstarts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('roms');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('roms', 'readwrite');
      for (const rom of roms) {
        const key = rom.kickstart.model === 'A1200' ? 'amiga-aga-a1200-kickstart-clean' : 'amiga-a500-kickstart-clean';
        transaction.objectStore('roms').put({ fileName: rom.fileName, bytes: rom.bytes }, key);
      }
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Could not save Kickstarts.'));
    });
    localStorage.setItem(KICKSTART_URL_KEY, url);
    return roms;
  } finally {
    db.close();
  }
}

export function validateKickstartUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Enter an HTTP or HTTPS URL without embedded credentials.');
  }
  return url.href;
}

export async function identifyKickstartDownload(bytes, catalogue = KICKSTART_CATALOGUE) {
  const entries = bytes[0] === 0x50 && bytes[1] === 0x4b
    ? Object.entries(unzipSync(bytes, { filter: (entry) => entry.originalSize <= 512 * 1024 }))
    : [['kickstart.rom', bytes]];
  const found = new Map();
  for (const [name, rom] of entries) {
    if (![256 * 1024, 512 * 1024].includes(rom.length)) continue;
    const checksum = await sha1Bytes(rom);
    const kickstart = catalogue.find((item) => item.sha1 === checksum || item.alternateSha1?.includes(checksum));
    if (kickstart) found.set(kickstart.id, { kickstart, fileName: name.split(/[\\/]/).pop(), bytes: rom });
  }
  if (!found.size) throw new Error('No supported A500 1.3 or A1200 3.1 Kickstart ROMs found. ROM checksums must match.');
  return [...found.values()];
}

export function archiveKickstartListing(value) {
  const url = new URL(value);
  const match = url.pathname.match(/^\/(?:download|details)\/([A-Za-z0-9_.-]+)\/?$/);
  return url.hostname === 'archive.org' && match ? match[1] : null;
}

export function selectArchiveKickstartFiles(files) {
  return files.filter((file) => {
    const name = String(file.name || '');
    return /\.(zip|rom|bin)$/i.test(name) && Number(file.size) <= 2 * 1024 * 1024
      && !/encrypted|\[(?:h|b|o|a|u)[^\]]*\]/i.test(name)
      && ((/kickstart.*(?:v1\.3|34\.0*5)/i.test(name) && /A500/i.test(name))
        || (/kickstart.*(?:v3\.1|40\.0*68)/i.test(name) && /A1200/i.test(name)));
  }).slice(0, 8);
}

async function fetchKickstartUrl(url) {
  let response;
  try {
    response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) });
  } catch {
    throw new Error('Could not fetch Kickstarts. Check the URL and that its server allows browser access (CORS).');
  }
  if (!response.ok) throw new Error(`Kickstart download failed (HTTP ${response.status}).`);
  return response;
}

export async function downloadArchiveKickstartFile(item, file, metadata, download) {
  const path = file.name.split('/').map(encodeURIComponent).join('/');
  const primary = `https://archive.org/download/${encodeURIComponent(item)}/${path}`;
  const targets = [primary, primary];
  // Archive.org's download redirect can fail while its replicas remain available.
  for (const host of [metadata.d1, metadata.d2]) {
    if (typeof host === 'string' && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.archive\.org$/i.test(host)
      && typeof metadata.dir === 'string' && /^\/\d+\/items\/[A-Za-z0-9_.-]+$/.test(metadata.dir)) {
      targets.push(`https://${host}${metadata.dir}/${path}`);
    }
  }
  let lastError;
  for (const url of targets) {
    try {
      return await download({ url, file_name: file.name }, 'amiga');
    } catch (err) {
      lastError = err;
      if (!/HTTP (?:429|5\d\d)|timed out|connection failed|fetch|network|incomplete/i.test(err.message)) throw err;
    }
  }
  throw new Error(`Kickstart source is temporarily unavailable. Your URL is still saved; try again shortly. ${lastError?.message || ''}`);
}

export async function downloadKickstarts(value) {
  const url = validateKickstartUrl(value);
  const item = archiveKickstartListing(url);
  if (item) {
    const { downloadSourceGame } = await import('../gameSources/sourceLibrary');
    const response = await fetchKickstartUrl(`https://archive.org/metadata/${encodeURIComponent(item)}`);
    const metadata = await response.json();
    const files = selectArchiveKickstartFiles(metadata.files || []);
    if (!files.length) throw new Error('No supported A500 1.3 or A1200 3.1 ROM files found in this Archive.org listing.');
    const found = new Map();
    for (const file of files) {
      const target = `https://archive.org/download/${encodeURIComponent(item)}/${file.name.split('/').map(encodeURIComponent).join('/')}`;
      const download = /\.zip$/i.test(file.name)
        ? await downloadArchiveKickstartFile(item, file, metadata, downloadSourceGame)
        : await fetchKickstartUrl(target);
      const bytes = new Uint8Array(await download.arrayBuffer());
      try {
        for (const rom of await identifyKickstartDownload(bytes)) found.set(rom.kickstart.id, rom);
      } catch { /* A filename is only a hint; only verified ROMs are accepted. */ }
    }
    if (!found.size) throw new Error('The listing contained no ROMs matching the supported Kickstart checksums.');
    return [...found.values()];
  }
  const response = await fetchKickstartUrl(url);
  return identifyKickstartDownload(new Uint8Array(await response.arrayBuffer()));
}
