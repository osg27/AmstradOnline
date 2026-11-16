import { unzipSync } from 'fflate';

// PUAE boots CD32 content from these image descriptors. CUE/CCD/MDS images
// reference separate track files, which must be loaded alongside them.
export const CD32_DISC_EXTENSIONS = ['.cue', '.chd', '.iso', '.ccd', '.mds', '.nrg'];
export const CD32_TRACK_EXTENSIONS = ['.bin', '.img', '.sub', '.mdf', '.wav', '.flac', '.mp3'];
export const CD32_MEDIA_EXTENSIONS = [...CD32_DISC_EXTENSIONS, ...CD32_TRACK_EXTENSIONS];

export const CD32_ROM_HALF = 512 * 1024;
export const CD32_ROM_SIZE = CD32_ROM_HALF * 2;

const lower = (value) => String(value || '').toLowerCase();
const fileNameOf = (item) => String(item?.fileName || item?.name || '');
const baseName = (value) => String(value || '').split(/[\\/]/).pop();
const hasExtension = (name, extensions) => extensions.some((extension) => lower(name).endsWith(extension));

export function isCd32Media(files = []) {
  return files.some((item) => hasExtension(fileNameOf(item), CD32_DISC_EXTENSIONS));
}

export function isCd32TrackOnly(fileName) {
  return hasExtension(fileName, CD32_TRACK_EXTENSIONS);
}

export function selectCd32ContentFile(files = []) {
  for (const extension of CD32_DISC_EXTENSIONS) {
    const match = files.find((item) => lower(fileNameOf(item)).endsWith(extension));
    if (match) return match;
  }
  return null;
}

export function cueTrackFileNames(cueText) {
  return [...String(cueText).matchAll(/^\s*FILE\s+(?:"([^"]+)"|(\S+))/gim)]
    .map((match) => baseName(match[1] || match[2]));
}

// Returns the track files a CUE sheet references that were not supplied.
export function findMissingCueTracks(files = []) {
  const names = new Set(files.map((item) => lower(baseName(fileNameOf(item)))));
  return files
    .filter((item) => lower(fileNameOf(item)).endsWith('.cue') && item.bytes)
    .flatMap((cue) => cueTrackFileNames(new TextDecoder('latin1').decode(cue.bytes)))
    .filter((track) => !names.has(lower(track)));
}

function looksLikeKickstart(bytes) {
  // exec.library's resident ID string ("exec 40.10 (15.7.93)") lives in the
  // Kickstart half, never in the CD32 extended ROM.
  const text = new TextDecoder('latin1').decode(bytes);
  return /exec 4\d\.\d+ \(/.test(text);
}

// Normalises the user's CD32 firmware into UAE's combined 1 MB layout:
// extended ROM in the first 512 KB, Kickstart 40.060 in the second.
export function buildCd32Rom(entries = []) {
  const roms = entries.flatMap((entry) => {
    const bytes = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes || []);
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      return Object.entries(unzipSync(bytes, { filter: (file) => file.originalSize <= CD32_ROM_SIZE }))
        .map(([name, data]) => ({ fileName: baseName(name), bytes: data }));
    }
    return [{ fileName: baseName(entry.fileName), bytes }];
  }).filter((rom) => rom.bytes.length === CD32_ROM_SIZE || rom.bytes.length === CD32_ROM_HALF);

  const combined = roms.find((rom) => rom.bytes.length === CD32_ROM_SIZE);
  if (combined) {
    const first = combined.bytes.subarray(0, CD32_ROM_HALF);
    const second = combined.bytes.subarray(CD32_ROM_HALF);
    const swapped = looksLikeKickstart(first) && !looksLikeKickstart(second);
    const bytes = swapped ? concat(second, first) : combined.bytes;
    return { fileName: combined.fileName, bytes };
  }

  const halves = roms.filter((rom) => rom.bytes.length === CD32_ROM_HALF);
  const kickstart = halves.find((rom) => looksLikeKickstart(rom.bytes))
    || halves.find((rom) => !/ext/i.test(rom.fileName));
  const extended = halves.find((rom) => rom !== kickstart && !looksLikeKickstart(rom.bytes))
    || halves.find((rom) => rom !== kickstart);
  if (!kickstart || !extended) {
    throw new Error('CD32 needs both the Kickstart 40.060 ROM and the CD32 extended ROM (two 512 KB files), or one combined 1 MB CD32 ROM.');
  }
  return { fileName: `${kickstart.fileName} + ${extended.fileName}`, bytes: concat(extended.bytes, kickstart.bytes) };
}

function concat(left, right) {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}
