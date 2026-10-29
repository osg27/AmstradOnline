import { unzipSync } from 'fflate';
import { sha1Bytes } from '../localLibrary/core/hash';
import { KICKSTART_CATALOGUE } from './kickstarts';

export const KICKSTART_URL_KEY = 'amiga-kickstart-source-url';

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
    const kickstart = catalogue.find((item) => item.sha1 === checksum);
    if (kickstart) found.set(kickstart.id, { kickstart, fileName: name.split(/[\\/]/).pop(), bytes: rom });
  }
  if (!found.size) throw new Error('No supported A500 1.3 or A1200 3.1 Kickstart ROMs found. ROM checksums must match.');
  return [...found.values()];
}

export async function downloadKickstarts(value) {
  const url = validateKickstartUrl(value);
  let response;
  try {
    response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) });
  } catch {
    throw new Error('Could not fetch Kickstarts. Check the URL and that its server allows browser access (CORS).');
  }
  if (!response.ok) throw new Error(`Kickstart download failed (HTTP ${response.status}).`);
  return identifyKickstartDownload(new Uint8Array(await response.arrayBuffer()));
}
