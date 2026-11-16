import { unzipSync } from 'fflate';

// Official FBNeo sf2ce World 920513 CPU program. Graphics/sound are checked by MAME.
const supported = [
  '774a2b52f7c1876c0e10d8d57a0850ad2d016cf6',
  'a8e2edef62fa99c5ef701b28bfb6bc42f3af183d',
  '1960dca35f0ca6f2b399a9fccfbc0132ac6425d1',
];
const legacy = [
  'c8d7a01b626771870123f1663a01a81f9c8fe582',
  '64111eba81d743fc3fd51d7a89cd0b2eefcc900d',
  supported[2],
];

export function classifyCps1Programs(hashes, softcore) {
  const matches = expected => expected.every(hash => hashes.includes(hash));
  if (matches(supported)) return { legacy: false, description: 'World 920513 — RetroAchievements-supported ROM revision.' };
  if (matches(legacy)) {
    if (softcore) throw new Error('This sf2ce.zip is World 920313. For submissions use the supported World 920513 set, or untick submissions to preview this older set.');
    return { legacy: true, description: 'World 920313 — older MAME set, local preview only. Submissions require World 920513.' };
  }
  throw new Error('This archive does not contain a complete supported SF2 Champion Edition World program. Use sf2ce.zip World 920513.');
}

export async function inspectCps1Rom(bytes, softcore) {
  let count = 0, files;
  try {
    files = unzipSync(bytes, { filter: entry => entry.originalSize === 0x80000 && ++count <= 32 });
  } catch {
    throw new Error('Could not read sf2ce.zip. Choose a complete ZIP ROM set.');
  }
  const hashes = await Promise.all(Object.values(files).map(async data => {
    const digest = await crypto.subtle.digest('SHA-1', data);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }));
  return classifyCps1Programs(hashes, softcore);
}
