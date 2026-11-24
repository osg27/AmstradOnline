import { gunzipSync, unzipSync } from 'fflate';
import { normaliseFilename } from '../localLibrary/core/normalise';
import { sha256 } from '../localLibrary/core/hash';

const DISK = /\.(adf|adz|dms)$/i;
const ARCHIVE = /\.(zip|7z)$/i;
export const validSharedLinkId = (id) => /^[a-f0-9]{32}$/.test(id || '');
const basename = (name) => String(name || '').split(/[\\/]/).pop();
const titleKey = (name) => normaliseFilename(basename(name)).cleanedTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

// Only metadata crosses the link. Each player reads/downloads their own copy.
export function validLinkSelection(value) {
  return value?.type === 'amiga-link-game' && typeof value.fileName === 'string'
    && value.fileName.length <= 240 && DISK.test(value.fileName)
    && /^[a-f0-9]{64}$/.test(value.sha256 || '')
    && (value.sharedGameId === undefined || validSharedLinkId(value.sharedGameId));
}

export async function prepareLinkDisks(file, extract7z) {
  let entries = [[file.name, new Uint8Array(await file.arrayBuffer())]];
  if (/\.zip$/i.test(file.name)) {
    entries = Object.entries(unzipSync(entries[0][1], {
      filter: (entry) => DISK.test(entry.name) && entry.originalSize <= 4 * 1024 * 1024,
    }));
  } else if (/\.7z$/i.test(file.name)) {
    const extracted = await extract7z(entries[0][1], ['.adf', '.adz', '.dms']);
    entries = [[extracted.fileName, extracted.bytes]];
  }
  const disks = entries.filter(([name]) => DISK.test(name)
    && !name.replace(/\\/g, '/').split('/').some((part) => part === '..' || part === '__MACOSX'))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  if (!disks.length) throw new Error('Link Play needs an ADF, ADZ or DMS floppy release. Choose a floppy version from your library; WHDLoad, IPF and AGA releases need the normal Amiga player.');
  return disks.map(([name, bytes]) => /\.adz$/i.test(name)
    ? new File([gunzipSync(bytes)], basename(name).replace(/\.adz$/i, '.adf'))
    : new File([bytes], basename(name)));
}

export async function describeLinkDisk(file) {
  return { type: 'amiga-link-game', fileName: file.name, sha256: await sha256(file) };
}

export function linkLibraryEntries(localGames, sources) {
  const local = localGames.filter((game) => ['amiga', 'amiga_aga', 'amiga_link'].includes(game.system)
    && (DISK.test(game.fileName || '') || ARCHIVE.test(game.fileName || '')));
  const remote = sources.filter((source) => ['amiga', 'amiga_aga'].includes(source.system))
    .flatMap((source) => source.games.filter((game) => DISK.test(game.file_name) || ARCHIVE.test(game.file_name))
      .map((game) => ({ id: `url-source:${source.id}:${game.url}`, system: source.system,
        source: 'public-url', sourceEntry: game, title: game.title || normaliseFilename(game.file_name).cleanedTitle,
        fileName: game.file_name, roomSystem: source.system })));
  return [...local, ...remote];
}

export async function findLinkLibraryDisk(selection, entries, { readLocal, download, extract7z }) {
  if (!validLinkSelection(selection)) throw new Error('Invalid Link Play game selection.');
  const candidates = entries.filter((entry) => basename(entry.fileName).toLowerCase() === selection.fileName.toLowerCase()
    || titleKey(entry.fileName) === titleKey(selection.fileName) || titleKey(entry.title) === titleKey(selection.fileName));
  candidates.sort((a, b) => Number(basename(b.fileName).toLowerCase() === selection.fileName.toLowerCase())
    - Number(basename(a.fileName).toLowerCase() === selection.fileName.toLowerCase()));
  const errors = [];
  for (const entry of candidates) {
    try {
      if (entry.handle?.queryPermission && await entry.handle.queryPermission({ mode: 'read' }) !== 'granted') {
        throw new Error('Allow access to your saved Amiga folder, then retry.');
      }
      const file = entry.source === 'public-url' ? await download(entry.sourceEntry, entry.roomSystem) : await readLocal(entry);
      for (const disk of await prepareLinkDisks(file, extract7z)) {
        if ((await describeLinkDisk(disk)).sha256 === selection.sha256) return disk;
      }
    } catch (error) { errors.push(error.message); }
  }
  if (errors.length) throw new Error(errors[0]);
  throw new Error(candidates.length
    ? `Your library has a different version of ${selection.fileName}. Add the same disk release as the host, then retry.`
    : `${selection.fileName} is missing from your library. Add it to your library or choose the matching file.`);
}

export async function resolveLinkKickstart({ loadStored, sourceUrl, cacheSource, identify }) {
  let stored = await loadStored();
  if (!stored && sourceUrl) {
    await cacheSource(sourceUrl);
    stored = await loadStored();
  }
  if (!stored) throw new Error('A500 Kickstart 1.3 is missing. Add it once, or set your Kickstart source in the library, then retry.');
  const roms = await identify(stored.bytes);
  if (!roms.some((rom) => rom.kickstart.model === 'A500')) {
    throw new Error('Link Play requires A500 Kickstart 1.3. Choose the A500 ROM.');
  }
  return stored;
}
