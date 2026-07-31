import { unzipSync } from 'fflate';
import { sha1Bytes } from '../localLibrary/core/hash';

const MEDIA_EXTENSIONS = /\.(adf|adz|dms|ipf|hdf|lha)$/i;

export function decodeHashMatches(hash, tuples = []) {
  return tuples.map(([releaseUuid, parentUuid, name, position]) => ({ hash, releaseUuid, parentUuid, name, position }));
}

export async function inspectAmigaFile(file) {
  if (!/\.zip$/i.test(file.name)) return [{ name: file.name, file, sha1: await sha1Bytes(await file.arrayBuffer()), source: 'openretro-exact-hash' }];
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  return Promise.all(Object.entries(entries).filter(([name]) => MEDIA_EXTENSIONS.test(name)).map(async ([name, bytes]) => ({ name, bytes, sha1: await sha1Bytes(bytes), source: 'openretro-exact-hash' })));
}

export async function lookupHashes(hashes, fetcher = fetch, base = '/data/amiga') {
  const prefixes = [...new Set(hashes.map((hash) => hash.slice(0, 2)))];
  const shards = await Promise.all(prefixes.map((prefix) => fetcher(`${base}/hashes/${prefix}.json`).then((response) => response.json())));
  const merged = Object.assign({}, ...shards.map((item) => item.hashes));
  return hashes.flatMap((hash) => decodeHashMatches(hash, merged[hash] || []));
}

export function groupIdentifiedMedia(items, matches) {
  const byHash = new Map(matches.map((match) => [match.hash, match]));
  const releases = new Map();
  items.forEach((item) => {
    const match = byHash.get(item.sha1); if (!match) return;
    if (!releases.has(match.releaseUuid)) releases.set(match.releaseUuid, { releaseUuid: match.releaseUuid, parentUuid: match.parentUuid, media: [] });
    releases.get(match.releaseUuid).media.push({ ...item, diskNumber: match.position, expectedName: match.name });
  });
  return [...releases.values()].map((release) => ({ ...release, media: release.media.sort((a, b) => a.diskNumber - b.diskNumber), identificationSource: 'openretro-exact-hash' }));
}
