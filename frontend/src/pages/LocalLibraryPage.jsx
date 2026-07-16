import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';
import mame2003PlusTitles from '../data/mame2003PlusTitles';
import {
  getLocalLibraryFolders,
  getLocalLibraryGames,
  getLocalLibrarySetting,
  saveLocalLibraryFolders,
  saveLocalLibraryGames,
  saveLocalLibrarySetting,
} from '../localLibraryDb';

export const SUPPORTED_SYSTEMS = [
  {
    id: 'arcade',
    roomSystem: 'arcade',
    label: 'MAME Arcade',
    shortLabel: 'MAME',
    extensions: ['zip', '7z'],
    pathHints: ['mame', 'arcade'],
    note: 'MAME 2003 / 2003-Plus romset',
  },
  {
    id: 'cpc',
    roomSystem: 'cpc',
    label: 'Amstrad CPC',
    shortLabel: 'CPC',
    extensions: ['dsk'],
    pathHints: ['amstrad', 'cpc'],
  },
  {
    id: 'spectrum',
    roomSystem: 'spectrum',
    label: 'ZX Spectrum',
    shortLabel: 'ZX',
    extensions: ['tap', 'tzx', 'z80', 'sna', 'szx'],
    pathHints: ['spectrum', 'zx'],
  },
  {
    id: 'c64',
    roomSystem: 'c64',
    label: 'Commodore 64',
    shortLabel: 'C64',
    extensions: ['d64', 't64', 'tap', 'prg', 'crt'],
    pathHints: ['c64', 'commodore'],
  },
  {
    id: 'atari8',
    roomSystem: 'atari8',
    label: 'Atari 400/800 XL',
    shortLabel: 'A8',
    extensions: ['atr', 'xex', 'car', 'rom', 'cas'],
    pathHints: ['atari 8', 'atari8', '800xl', '400'],
  },
  {
    id: 'nes',
    roomSystem: 'nes',
    label: 'NES',
    shortLabel: 'NES',
    extensions: ['nes'],
    pathHints: ['nes', 'nintendo entertainment'],
  },
  {
    id: 'snes',
    roomSystem: 'snes',
    label: 'SNES',
    shortLabel: 'SNES',
    extensions: ['sfc', 'smc'],
    pathHints: ['snes', 'super nintendo'],
  },
  {
    id: 'mastersystem',
    roomSystem: 'mastersystem',
    label: 'Sega Master System',
    shortLabel: 'SMS',
    extensions: ['sms'],
    pathHints: ['master system', 'mastersystem', 'sms'],
  },
  {
    id: 'megadrive',
    roomSystem: 'megadrive',
    label: 'Mega Drive',
    shortLabel: 'MD',
    extensions: ['bin', 'gen', 'md', 'smd'],
    pathHints: ['mega drive', 'megadrive', 'genesis'],
  },
  {
    id: 'pcengine',
    roomSystem: 'pcengine',
    label: 'PC Engine',
    shortLabel: 'PCE',
    extensions: ['pce', 'sgx'],
    pathHints: ['pc engine', 'pcengine', 'turbografx'],
  },
  {
    id: 'playstation',
    roomSystem: 'playstation',
    label: 'PlayStation',
    shortLabel: 'PS1',
    extensions: ['cue', 'chd', 'pbp', 'iso'],
    pathHints: ['playstation', 'ps1', 'psx'],
  },
  {
    id: 'amiga',
    roomSystem: 'amiga',
    label: 'Amiga',
    shortLabel: 'A500',
    extensions: ['adf'],
    pathHints: ['amiga', 'a500'],
  },
  {
    id: 'atarist',
    roomSystem: 'atarist',
    label: 'Atari ST',
    shortLabel: 'ST',
    extensions: ['st', 'msa', 'stx', 'ipf'],
    pathHints: ['atari st', 'atarist'],
  },
];

const SYSTEM_BY_ID = Object.fromEntries(SUPPORTED_SYSTEMS.map((system) => [system.id, system]));
const EXTENSION_SYSTEMS = SUPPORTED_SYSTEMS.reduce((map, system) => {
  system.extensions.forEach((extension) => {
    if (!map.has(extension)) map.set(extension, []);
    map.get(extension).push(system);
  });
  return map;
}, new Map());

const LIBRETRO_BOXART_REPOS = {
  arcade: ['MAME', 'Arcade_-_MAME'],
  cpc: ['Amstrad_-_CPC'],
  spectrum: ['Sinclair_-_ZX_Spectrum'],
  c64: ['Commodore_-_64'],
  atari8: ['Atari_-_8-bit'],
  nes: ['Nintendo_-_Nintendo_Entertainment_System'],
  snes: ['Nintendo_-_Super_Nintendo_Entertainment_System'],
  mastersystem: ['Sega_-_Master_System_-_Mark_III'],
  megadrive: ['Sega_-_Mega_Drive_-_Genesis'],
  pcengine: ['NEC_-_PC_Engine_-_TurboGrafx_16'],
  playstation: ['Sony_-_PlayStation'],
  amiga: ['Commodore_-_Amiga'],
  atarist: ['Atari_-_ST'],
};

const boxArtIndexCache = new Map();
const BOX_ART_NOISE_WORDS = new Set(['disney', 'disneys', 's', 'taito', 'sega', 'nintendo']);

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[\[\(].*?[\]\)]/g, ' ')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fileBaseName(fileName) {
  return fileName.replace(/\.[^.]+$/, '');
}

function arcadeRomKey(fileName) {
  return fileBaseName(fileName).toLowerCase();
}

function isArcadeParentRom(game) {
  if (game.system !== 'arcade') return true;
  const metadata = mame2003PlusTitles[arcadeRomKey(game.fileName)];
  return !metadata?.parent;
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function regionExpandedName(value) {
  return value
    .replace(/\((U)\)/gi, '(USA)')
    .replace(/\((E)\)/gi, '(Europe)')
    .replace(/\((J)\)/gi, '(Japan)')
    .replace(/\[(U)\]/gi, '(USA)')
    .replace(/\[(E)\]/gi, '(Europe)')
    .replace(/\[(J)\]/gi, '(Japan)');
}

function normalizeRevisionTags(value) {
  return value
    .replace(/\(Rev[-\s]?A\)/gi, '(Rev 1)')
    .replace(/\(Rev[-\s]?B\)/gi, '(Rev 2)')
    .replace(/\(Rev[-\s]?C\)/gi, '(Rev 3)');
}

function stripRegionAndMeta(value) {
  return value.replace(/\s*[\[\(].*?[\]\)]/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleCaseSmallWords(value) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (/^(THE|A|AN|AND|OF|IN|ON|TO|FOR)$/i.test(part)) return part.toLowerCase();
      if (/^[IVX]+$/i.test(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ')
    .replace(/, the$/i, ', The')
    .replace(/\bIi\b/g, 'II')
    .replace(/\bIii\b/g, 'III')
    .replace(/\bIv\b/g, 'IV');
}

function moveTrailingArticle(value) {
  return value.replace(/^(.+),\s*(the|a|an)$/i, (_match, title, article) => {
    const normalizedArticle = article.charAt(0).toUpperCase() + article.slice(1).toLowerCase();
    return `${normalizedArticle} ${title.trim()}`;
  });
}

function disneyVariants(value) {
  const variants = [];
  const withPossessive = value.replace(/^Disney(?:s|'s)?\s+/i, "Disney's ");
  variants.push(withPossessive);

  variants.push(withPossessive.replace(/^Disney's\s+Jungle Book\b/i, "Disney's The Jungle Book"));
  variants.push(withPossessive.replace(/^Disney's\s+Lion King\b/i, "Disney's The Lion King"));

  if (/^Jungle Book\b/i.test(value)) variants.push(value.replace(/^Jungle Book\b/i, "Disney's The Jungle Book"));
  if (/^Aladdin\b/i.test(value)) variants.push(value.replace(/^Aladdin\b/i, "Disney's Aladdin"));
  if (/^Lion King\b/i.test(value)) variants.push(value.replace(/^Lion King\b/i, "Disney's The Lion King"));

  return variants;
}

function punctuationVariants(value) {
  const variants = [value];
  variants.push(value.replace(/\s+-\s+/g, ' - '));
  variants.push(value.replace(/\s+The\s+/i, ' - The '));
  variants.push(value.replace(/\s+And\s+The\s+/i, ' and the '));
  variants.push(value.replace(/\bAnd\b/g, 'and'));
  variants.push(value.replace(/\bHigh Tech\b/gi, 'High-Tech'));
  variants.push(value.replace(/\bChase\s+H\.?\s*Q\.?\b/gi, 'Chase H.Q.'));
  variants.push(value.replace(/\bH Q\b/gi, 'H.Q.'));
  variants.push(value.replace(/\bHQ\b/gi, 'H.Q.'));
  variants.push(value.replace(/\bHang ON\b/gi, 'Hang-On'));
  variants.push(value.replace(/\bSpider Man\b/gi, 'Spider-Man'));
  variants.push(value.replace(/\bX Men\b/gi, 'X-Men'));
  variants.push(value.replace(/\bMs Pac Man\b/gi, 'Ms. Pac-Man'));
  variants.push(value.replace(/\bPac Man\b/gi, 'Pac-Man'));
  variants.push(...disneyVariants(value));
  variants.push(value.replace(/^Disney(?:s|'s)?\s+/i, ''));
  variants.push(value.replace(/^Taito\s+/i, ''));
  return variants;
}

function appendRegions(title, revision = '') {
  const suffixes = [
    '(World)',
    '(USA)',
    '(Europe)',
    '(USA, Europe)',
    '(USA, Europe, Brazil) (En)',
    '(Europe, Brazil) (En)',
    '(Japan, Europe) (En)',
    '(Japan, USA, Brazil) (En)',
  ];
  return suffixes.flatMap((suffix) => [
    `${title} ${suffix}`,
    revision ? `${title} ${suffix} ${revision}` : null,
  ]);
}

function normalizeBoxArtKey(value) {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/\bh\s*\.?\s*q\.?\b/g, 'hq')
    .replace(/\bdisney'?s?\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\busa\b|\beurope\b|\bjapan\b|\bworld\b|\bbrazil\b|\ben\b|\brev\b|\bbeta\b|\bbios\b|\btaito\b|\bsega\b|\bnintendo\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bh q\b/g, 'hq')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeExactBoxArtKey(value) {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/\bh\s*\.?\s*q\.?\b/g, 'hq')
    .replace(/\bdisney'?s?\b/g, 'disney')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bh q\b/g, 'hq')
    .replace(/\s+/g, ' ')
    .trim();
}

function rawGitHubBoxArtUrl(repo, path) {
  return `https://raw.githubusercontent.com/libretro-thumbnails/${repo}/master/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function libretroBoxArtUrl(repo, fileName) {
  const setName = repo.replace(/_/g, ' ');
  return `https://thumbnails.libretro.com/${encodeURIComponent(setName)}/Named_Boxarts/${encodeURIComponent(fileName)}.png`;
}

function makeBoxArtEntry(repo, fileName, url) {
  return {
    title: fileName,
    url,
    exactKey: normalizeExactBoxArtKey(fileName),
    looseKey: normalizeBoxArtKey(fileName),
  };
}

async function getBoxArtIndex(systemId) {
  if (boxArtIndexCache.has(systemId)) return boxArtIndexCache.get(systemId);

  const repos = LIBRETRO_BOXART_REPOS[systemId] || [];
  const indexPromise = (async () => {
    const entries = [];
    for (const repo of repos) {
      try {
        const response = await fetch(`https://api.github.com/repos/libretro-thumbnails/${repo}/git/trees/master?recursive=1`, { cache: 'force-cache' });
        if (!response.ok) continue;
        const payload = await response.json();
        const tree = Array.isArray(payload.tree) ? payload.tree : [];
        tree
          .filter((item) => item.type === 'blob' && /^Named_Boxarts\/.+\.png$/i.test(item.path))
          .forEach((item) => {
            const fileName = item.path.split('/').pop().replace(/\.png$/i, '');
            entries.push(makeBoxArtEntry(repo, fileName, rawGitHubBoxArtUrl(repo, item.path)));
          });
      } catch {
        // Try the next repo; external metadata sources are best-effort.
      }

      try {
        const setName = repo.replace(/_/g, ' ');
        const response = await fetch(`https://thumbnails.libretro.com/${encodeURIComponent(setName)}/Named_Boxarts/`, { cache: 'force-cache' });
        if (!response.ok) continue;
        const html = await response.text();
        const matches = [...html.matchAll(/href="([^"]+\.png)"/gi)];
        matches.forEach((match) => {
          const fileName = decodeURIComponent(match[1].split('/').pop().replace(/\.png$/i, '').replace(/\+/g, ' '));
          if (!entries.some((entry) => entry.title === fileName)) {
            entries.push(makeBoxArtEntry(repo, fileName, libretroBoxArtUrl(repo, fileName)));
          }
        });
      } catch {
        // Directory listings are a fallback for when the GitHub tree is stale or blocked.
      }
    }
    return entries;
  })();

  boxArtIndexCache.set(systemId, indexPromise);
  return indexPromise;
}

function findIndexedBoxArt(game, index) {
  const candidates = buildBoxArtNameCandidates(game);
  const exactKeys = candidates.map(normalizeExactBoxArtKey).filter(Boolean);
  const looseKeys = candidates.map(normalizeBoxArtKey).filter(Boolean);

  for (const key of exactKeys) {
    const match = index.find((entry) => entry.exactKey === key);
    if (match) return match;
  }

  for (const key of looseKeys) {
    const match = index.find((entry) => entry.looseKey === key);
    if (match) return match;
  }

  const baseKey = normalizeBoxArtKey(stripRegionAndMeta(fileBaseName(game.fileName)));
  if (baseKey.length >= 4) {
    const startsWithMatch = index.find((entry) => entry.looseKey.startsWith(baseKey) || baseKey.startsWith(entry.looseKey));
    if (startsWithMatch) return startsWithMatch;
  }

  const candidateTokenSets = looseKeys
    .map((key) => key.split(' ').filter((token) => token.length > 1 && !BOX_ART_NOISE_WORDS.has(token)))
    .filter((tokens) => tokens.length >= 2);
  const subsetMatch = index.find((entry) => {
    const entryTokens = new Set(entry.looseKey.split(' ').filter(Boolean));
    return candidateTokenSets.some((tokens) => tokens.every((token) => entryTokens.has(token)));
  });
  if (subsetMatch) return subsetMatch;

  return null;
}

function buildBoxArtNameCandidates(game) {
  const base = fileBaseName(game.fileName).replace(/_/g, ' ').trim();
  const expandedBase = regionExpandedName(base);
  const revisedBase = normalizeRevisionTags(expandedBase);
  const withoutRevision = expandedBase.replace(/\s*\(Rev[^)]*\)/gi, '').trim();
  const usaEurope = expandedBase.replace(/\(USA\)/gi, '(USA, Europe)');
  const usaEuropeBrazil = revisedBase.replace(/\(USA\)/gi, '(USA, Europe, Brazil) (En)');
  const withoutBracketMeta = stripRegionAndMeta(base);
  const cleanedTitle = titleCaseSmallWords(withoutBracketMeta || game.title);
  const articleFixed = moveTrailingArticle(withoutBracketMeta);
  const articleFixedTitle = titleCaseSmallWords(articleFixed);
  const titleVariants = uniq([
    game.title,
    cleanedTitle,
    articleFixed,
    articleFixedTitle,
    moveTrailingArticle(game.title),
    moveTrailingArticle(cleanedTitle),
    moveTrailingArticle(base),
    moveTrailingArticle(expandedBase),
    ...punctuationVariants(game.title),
    ...punctuationVariants(cleanedTitle),
    ...punctuationVariants(articleFixedTitle),
  ]);

  return uniq([
    base,
    expandedBase,
    revisedBase,
    withoutRevision,
    usaEurope,
    usaEuropeBrazil,
    withoutBracketMeta,
    ...titleVariants,
    ...titleVariants.flatMap((title) => appendRegions(title)),
    ...titleVariants.flatMap((title) => appendRegions(title, '(Rev 1)')),
    ...titleVariants.flatMap((title) => appendRegions(title, '(Beta)')),
    game.system === 'arcade' ? fileBaseName(game.fileName).toLowerCase() : null,
  ]);
}

function probeImageUrl(url) {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      resolve(null);
    }, 7000);

    image.onload = () => {
      window.clearTimeout(timer);
      resolve(url);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    image.referrerPolicy = 'no-referrer';
    image.src = url;
  });
}

async function findBoxArtForGame(game) {
  const index = await getBoxArtIndex(game.system);
  const indexedMatch = findIndexedBoxArt(game, index);
  if (indexedMatch) {
    return {
      boxArtUrl: indexedMatch.url,
      boxArtSource: indexedMatch.url,
      boxArtFetchedAt: new Date().toISOString(),
    };
  }

  const repos = LIBRETRO_BOXART_REPOS[game.system] || [];
  const names = buildBoxArtNameCandidates(game);

  for (const repo of repos) {
    const setName = repo.replace(/_/g, ' ');
    for (const name of names) {
      const url = `https://thumbnails.libretro.com/${encodeURIComponent(setName)}/Named_Boxarts/${encodeURIComponent(name)}.png`;
      const imageUrl = await probeImageUrl(url);
      if (imageUrl) {
        return {
          boxArtUrl: imageUrl,
          boxArtSource: imageUrl,
          boxArtFetchedAt: new Date().toISOString(),
        };
      }
    }
  }

  return null;
}

function titleFromFileName(fileName) {
  return slugify(fileName)
    .split(' ')
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function getFileExtension(fileName) {
  const match = /\.([^.]+)$/.exec(fileName.toLowerCase());
  return match ? match[1] : '';
}

function detectSystem(fileName, relativePath) {
  const extension = getFileExtension(fileName);
  const candidates = EXTENSION_SYSTEMS.get(extension) || [];
  const path = relativePath.toLowerCase().replace(/[\\/]+/g, ' ');

  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const hinted = candidates.find((system) => system.pathHints.some((hint) => path.includes(hint)));
  if (hinted) return hinted;

  return candidates[0];
}

function canUseDirectoryPicker() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

async function* walkDirectory(directoryHandle, prefix = '') {
  for await (const [name, handle] of directoryHandle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      yield* walkDirectory(handle, path);
    } else if (handle.kind === 'file') {
      yield { handle, name, path };
    }
  }
}

function buildSystemCounts(games) {
  return games.reduce((counts, game) => {
    counts[game.system] = (counts[game.system] || 0) + 1;
    return counts;
  }, {});
}

export default function LocalLibraryPage({ embedded = false, onboarding = false, onComplete = null }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedSystem = searchParams.get('system');
  const requestedSystemExists = SUPPORTED_SYSTEMS.some((system) => system.id === requestedSystem);
  const username = localStorage.getItem('username');
  const [folders, setFolders] = useState([]);
  const [games, setGames] = useState([]);
  const [selectedSystems, setSelectedSystems] = useState([]);
  const [activeSystem, setActiveSystem] = useState(requestedSystemExists ? requestedSystem : 'all');
  const [query, setQuery] = useState('');
  const [favourites, setFavourites] = useState([]);
  const [status, setStatus] = useState('Loading library...');
  const [scanProgress, setScanProgress] = useState(null);
  const [mediaProgress, setMediaProgress] = useState(null);
  const [launchingId, setLaunchingId] = useState(null);
  const [showArcadeClones, setShowArcadeClones] = useState(false);

  useEffect(() => {
    async function loadLibrary() {
      try {
        const [savedFolders, savedGames, savedSystems, savedFavourites] = await Promise.all([
          getLocalLibraryFolders(),
          getLocalLibraryGames(),
          getLocalLibrarySetting('selectedSystems', []),
          getLocalLibrarySetting('favourites', []),
        ]);
        setFolders(savedFolders);
        setGames(savedGames);
        setSelectedSystems(savedSystems.length ? savedSystems : SUPPORTED_SYSTEMS.map((system) => system.id));
        setFavourites(savedFavourites);
        setStatus(savedGames.length ? 'Library ready' : 'Choose a ROM folder to build your local library.');
      } catch (err) {
        setStatus(`Could not load local library: ${err.message}`);
      }
    }

    loadLibrary();
  }, []);

  useEffect(() => {
    if (requestedSystemExists) {
      setActiveSystem(requestedSystem);
    }
  }, [requestedSystem, requestedSystemExists]);

  useEffect(() => {
    if (!mediaProgress) return undefined;

    const warnBeforeLeaving = (event) => {
      event.preventDefault();
      event.returnValue = 'Box art download is still running.';
      return event.returnValue;
    };

    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [mediaProgress]);

  const systemCounts = useMemo(() => buildSystemCounts(games), [games]);
  const visibleSystems = useMemo(() => SUPPORTED_SYSTEMS.filter((system) => selectedSystems.includes(system.id)), [selectedSystems]);
  const favouriteSet = useMemo(() => new Set(favourites), [favourites]);
  const filteredGames = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return games
      .filter((game) => selectedSystems.includes(game.system))
      .filter((game) => activeSystem === 'all' || game.system === activeSystem || (activeSystem === 'favourites' && favouriteSet.has(game.id)))
      .filter((game) => showArcadeClones || game.system !== 'arcade' || isArcadeParentRom(game))
      .filter((game) => !normalizedQuery || `${game.title} ${game.fileName} ${game.path}`.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [activeSystem, favouriteSet, games, query, selectedSystems, showArcadeClones]);
  const hiddenArcadeCloneCount = useMemo(
    () => games
      .filter((game) => selectedSystems.includes(game.system))
      .filter((game) => activeSystem === 'all' || game.system === 'arcade' || (activeSystem === 'favourites' && favouriteSet.has(game.id)))
      .filter((game) => game.system === 'arcade' && !isArcadeParentRom(game))
      .length,
    [activeSystem, favouriteSet, games, selectedSystems],
  );

  async function toggleSystem(systemId) {
    const next = selectedSystems.includes(systemId)
      ? selectedSystems.filter((id) => id !== systemId)
      : [...selectedSystems, systemId];
    setSelectedSystems(next);
    await saveLocalLibrarySetting('selectedSystems', next);
    if (activeSystem !== 'all' && activeSystem !== 'favourites' && !next.includes(activeSystem)) {
      setActiveSystem('all');
    }
  }

  async function toggleFavourite(gameId) {
    const next = favouriteSet.has(gameId)
      ? favourites.filter((id) => id !== gameId)
      : [...favourites, gameId];
    setFavourites(next);
    await saveLocalLibrarySetting('favourites', next);
  }

  async function finishSetup() {
    await saveLocalLibrarySetting('librarySetupComplete', true);
    if (onComplete) {
      onComplete();
      return;
    }
    navigate('/lobby');
  }

  async function scanFolder(targetSystemId = null) {
    if (!canUseDirectoryPicker()) {
      setStatus('Folder scanning needs Chrome, Edge, or another Chromium browser.');
      return;
    }

    try {
      const targetSystem = targetSystemId ? SYSTEM_BY_ID[targetSystemId] : null;
      const directoryHandle = await window.showDirectoryPicker({ mode: 'read' });
      const folderId = targetSystem ? `system:${targetSystem.id}` : `mixed:${directoryHandle.name}-${Date.now()}`;
      const nextGames = [];
      const sampleHandles = [];
      let scanned = 0;
      setScanProgress({ scanned: 0, matched: 0 });
      setStatus(`Scanning ${directoryHandle.name}${targetSystem ? ` for ${targetSystem.label}` : ''}...`);

      for await (const entry of walkDirectory(directoryHandle)) {
        scanned += 1;
        const extension = getFileExtension(entry.name);
        const pathParts = entry.path.split(/[\\/]+/).map((part) => part.toLowerCase());
        const inSamplesFolder = pathParts.includes('samples');

        if ((targetSystem?.id === 'arcade' || !targetSystem) && inSamplesFolder && ['zip', '7z'].includes(extension)) {
          sampleHandles.push({
            key: entry.name.replace(/\.(zip|7z)$/i, '').toLowerCase(),
            name: entry.name,
            path: entry.path,
            handle: entry.handle,
          });
          continue;
        }

        const system = targetSystem && targetSystem.extensions.includes(extension)
          ? targetSystem
          : targetSystem
            ? null
            : detectSystem(entry.name, entry.path);
        if (system) {
          nextGames.push({
            id: `${folderId}:${entry.path}`,
            folderId,
            folderName: directoryHandle.name,
            folderSystem: targetSystem?.id || 'mixed',
            title: titleFromFileName(entry.name),
            fileName: entry.name,
            path: entry.path,
            extension,
            system: system.id,
            roomSystem: system.roomSystem,
            handle: entry.handle,
            indexedAt: new Date().toISOString(),
          });
        }
        if (scanned % 100 === 0) {
          setScanProgress({ scanned, matched: nextGames.length });
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      }

      const folder = {
        id: folderId,
        name: directoryHandle.name,
        system: targetSystem?.id || 'mixed',
        systemLabel: targetSystem?.label || 'Mixed library',
        handle: directoryHandle,
        scannedAt: new Date().toISOString(),
        gameCount: nextGames.length,
        sampleCount: sampleHandles.length,
        samples: sampleHandles,
      };

      const [storedFolders, storedGames] = await Promise.all([
        getLocalLibraryFolders(),
        getLocalLibraryGames(),
      ]);
      const mergedFolders = [
        ...storedFolders.filter((existingFolder) => existingFolder.id !== folderId),
        folder,
      ].sort((left, right) => (left.systemLabel || left.name).localeCompare(right.systemLabel || right.name));
      const mergedGames = [
        ...storedGames.filter((game) => game.folderId !== folderId),
        ...nextGames,
      ];

      await saveLocalLibraryFolders(mergedFolders);
      await saveLocalLibraryGames(mergedGames);
      setFolders(mergedFolders);
      setGames(mergedGames);
      setScanProgress(null);
      setStatus(`Found ${nextGames.length} ${targetSystem ? targetSystem.label : 'playable'} file${nextGames.length === 1 ? '' : 's'} in ${directoryHandle.name}${sampleHandles.length ? `, plus ${sampleHandles.length} MAME sample zip${sampleHandles.length === 1 ? '' : 's'}` : ''}.`);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setStatus(`Scan failed: ${err.message}`);
      }
      setScanProgress(null);
    }
  }

  async function launchGame(game) {
    setLaunchingId(game.id);
    setStatus(`Starting ${game.title}...`);
    try {
      sessionStorage.setItem('oldstylegaming:pendingLocalGame', JSON.stringify({
        id: game.id,
        title: game.title,
        fileName: game.fileName,
        system: game.system,
        roomSystem: game.roomSystem,
      }));

      const room = await apiFetch('/rooms/create', {
        method: 'POST',
        body: JSON.stringify({
          system: game.roomSystem,
          party_max_players: 2,
        }),
      });
      navigate(`/room/${room.room_code}?mode=solo&localGame=${encodeURIComponent(game.id)}`);
    } catch (err) {
      setStatus(`Could not start ${game.title}: ${err.message}`);
    } finally {
      setLaunchingId(null);
    }
  }

  function leaveLibrary() {
    if (mediaProgress && !window.confirm('Box art download is still running. Leave this page anyway?')) {
      return;
    }
    navigate('/lobby');
  }

  async function downloadBoxArt() {
    const skippedArcadeClones = filteredGames.filter((game) => game.system === 'arcade' && !isArcadeParentRom(game) && !game.boxArtUrl).length;
    const targets = filteredGames.filter((game) => !game.boxArtUrl && isArcadeParentRom(game));
    if (!targets.length) {
      setStatus(skippedArcadeClones
        ? 'Box art is already downloaded for shown parent games. MAME clone ROMs are skipped.'
        : 'Box art is already downloaded for the shown games.');
      return;
    }

    let found = 0;
    let checked = 0;
    let nextGames = games;
    setMediaProgress({ checked: 0, total: targets.length, found: 0 });
    setStatus(`Downloading box art for ${targets.length} shown game${targets.length === 1 ? '' : 's'}${skippedArcadeClones ? `, skipping ${skippedArcadeClones} MAME clone${skippedArcadeClones === 1 ? '' : 's'}` : ''}... fetching artwork index.`);

    await Promise.all([...new Set(targets.map((game) => game.system))].map((systemId) => getBoxArtIndex(systemId)));
    setStatus(`Downloading box art for ${targets.length} shown parent game${targets.length === 1 ? '' : 's'}...`);

    let cursor = 0;
    async function worker() {
      while (cursor < targets.length) {
        const game = targets[cursor];
        cursor += 1;
        try {
          const media = await findBoxArtForGame(game);
          if (media) {
            found += 1;
            nextGames = nextGames.map((item) => (
              item.id === game.id ? { ...item, ...media } : item
            ));
            setGames(nextGames);
          }
        } catch {
          // Missing artwork is expected for some dumps and naming variants.
        }
        checked += 1;
        setMediaProgress({ checked, total: targets.length, found });
        if (checked % 25 === 0 || checked === targets.length) {
          await saveLocalLibraryGames(nextGames);
        }
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }

    const workerCount = Math.min(8, targets.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    await saveLocalLibraryGames(nextGames);
    setMediaProgress(null);
    setStatus(`Box art complete: ${found} found, ${targets.length - found} missing${skippedArcadeClones ? `, ${skippedArcadeClones} MAME clone${skippedArcadeClones === 1 ? '' : 's'} skipped` : ''}.`);
  }

  const content = (
    <div className="local-library-shell">
      {!embedded ? (
      <header className="lobby-header local-library-header">
        <BrandMark />
        <div className="account-strip">
          <span>{username}</span>
          <button type="button" className="secondary" onClick={leaveLibrary}>Lobby</button>
        </div>
      </header>
      ) : null}

        <section className={`local-library-hero ${onboarding ? 'welcome-library-hero' : ''}`}>
          <div>
            <p className="lobby-eyebrow">{onboarding ? 'Welcome to Old Style Gaming' : 'Your ROMs, your machine'}</p>
            <h1>{onboarding ? 'Set up your game shelves' : 'Local Game Library'}</h1>
            <p>{onboarding ? (games.length ? 'Your browser already has a scanned library. Pick the systems you want on your home page, then continue.' : 'Choose the systems you care about, attach local ROM folders, and your home page will become your own retro dashboard.') : 'Pick a folder once, build a searchable library, and keep the ROMs on your own drive.'}</p>
          </div>
          <div className="local-library-actions">
            <button type="button" onClick={() => scanFolder()}>
              <i className="bi bi-folder2-open" aria-hidden="true" />
              Add mixed ROM folder
            </button>
            <span>{folders.length ? `${folders.length} folder${folders.length === 1 ? '' : 's'} connected` : 'No folders connected yet'}</span>
          </div>
        </section>

        <section className="setup-wizard" aria-label="Setup wizard">
          <div className="setup-step active">
            <span>1</span>
            <strong>Select systems</strong>
            <small>{selectedSystems.length} enabled</small>
          </div>
          <div className={`setup-step ${folders.length ? 'active' : ''}`}>
            <span>2</span>
            <strong>Choose folders</strong>
            <small>{folders.length ? `${folders.length} connected` : 'Waiting'}</small>
          </div>
          <div className={`setup-step ${games.length ? 'active' : ''}`}>
            <span>3</span>
            <strong>Scan library</strong>
            <small>{scanProgress ? `${scanProgress.scanned} scanned` : `${games.length} games`}</small>
          </div>
          <div className={`setup-step ${games.length ? 'active' : ''}`}>
            <span>4</span>
            <strong>Play</strong>
            <small>Solo rooms first</small>
          </div>
        </section>

        {onboarding ? (
          <div className="onboarding-finish-bar">
            <div>
              <strong>{games.length ? `${games.length} local games indexed` : 'Pick your systems first'}</strong>
              <span>{folders.length ? `${folders.length} folder${folders.length === 1 ? '' : 's'} connected` : 'Add folders now, or just choose systems and add folders later from My Library.'}</span>
            </div>
            <button type="button" onClick={finishSetup} disabled={!selectedSystems.length}>
              Continue to home
            </button>
          </div>
        ) : null}

        <main className={`local-library-layout ${onboarding ? 'onboarding-library-layout' : ''}`}>
          <aside className="local-library-sidebar">
            <div className="local-library-panel">
              <h2>Systems</h2>
              <div className="system-picker-list">
                {SUPPORTED_SYSTEMS.map((system) => {
                  const linkedFolder = folders.find((folder) => folder.system === system.id);
                  return (
                    <div key={system.id} className={selectedSystems.includes(system.id) ? 'system-picker-row enabled' : 'system-picker-row'}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedSystems.includes(system.id)}
                          onChange={() => toggleSystem(system.id)}
                        />
                        <span>{system.label}</span>
                        <small>{systemCounts[system.id] || 0}</small>
                      </label>
                      <button type="button" className="secondary" onClick={() => scanFolder(system.id)}>
                        {linkedFolder ? 'Change folder' : 'Add folder'}
                      </button>
                      {linkedFolder ? <em>{linkedFolder.name}</em> : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="local-library-panel library-status-panel">
              <h2>Status</h2>
              <p>{status}</p>
              {scanProgress ? (
                <dl>
                  <div>
                    <dt>Scanned</dt>
                    <dd>{scanProgress.scanned}</dd>
                  </div>
                  <div>
                    <dt>Matched</dt>
                    <dd>{scanProgress.matched}</dd>
                  </div>
                </dl>
              ) : null}
            </div>

            <div className="local-library-panel">
              <h2>Folders</h2>
              {folders.length ? (
                <div className="library-folder-list">
                  {folders.map((folder) => (
                    <div key={folder.id}>
                      <strong>{folder.systemLabel || folder.system || 'Library'}</strong>
                      <span>{folder.name}</span>
                      <small>{folder.gameCount || 0} game{folder.gameCount === 1 ? '' : 's'}{folder.sampleCount ? `, ${folder.sampleCount} samples` : ''}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">Add a folder beside each system, or use one mixed folder.</p>
              )}
            </div>
          </aside>

          {!onboarding ? (
          <section className="local-library-main">
            <div className="local-library-toolbar">
              <div className="library-filter-tabs" aria-label="Library filters">
                <button type="button" className={activeSystem === 'all' ? 'active' : 'secondary'} onClick={() => setActiveSystem('all')}>
                  All
                </button>
                <button type="button" className={activeSystem === 'favourites' ? 'active' : 'secondary'} onClick={() => setActiveSystem('favourites')}>
                  Favourites
                </button>
                {visibleSystems.map((system) => (
                  <button
                    key={system.id}
                    type="button"
                    className={activeSystem === system.id ? 'active' : 'secondary'}
                    onClick={() => setActiveSystem(system.id)}
                  >
                    {system.shortLabel}
                  </button>
                ))}
              </div>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search your games"
              />
              {selectedSystems.includes('arcade') && hiddenArcadeCloneCount > 0 ? (
                <label className="library-clone-toggle">
                  <input
                    type="checkbox"
                    checked={showArcadeClones}
                    onChange={(event) => setShowArcadeClones(event.target.checked)}
                  />
                  <span>Show clones/children</span>
                </label>
              ) : null}
              <button type="button" className="secondary download-media-button" onClick={downloadBoxArt} disabled={!filteredGames.length || Boolean(mediaProgress)}>
                {mediaProgress ? `Box art ${mediaProgress.checked}/${mediaProgress.total}` : 'Download box art'}
              </button>
            </div>

            <div className="library-summary-strip">
              <strong>{filteredGames.length}</strong>
              <span>shown from {games.length} indexed files{!showArcadeClones && hiddenArcadeCloneCount ? ` - ${hiddenArcadeCloneCount} MAME clones hidden` : ''}{mediaProgress ? ` - found ${mediaProgress.found}` : ''}</span>
            </div>
            {mediaProgress ? (
              <div className="media-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax={mediaProgress.total} aria-valuenow={mediaProgress.checked}>
                <span style={{ width: `${Math.round((mediaProgress.checked / mediaProgress.total) * 100)}%` }} />
              </div>
            ) : null}

            {filteredGames.length ? (
              <div className="local-game-grid">
                {filteredGames.map((game) => {
                  const system = SYSTEM_BY_ID[game.system];
                  const favourite = favouriteSet.has(game.id);
                  return (
                    <article key={game.id} className={game.boxArtUrl ? 'local-game-card has-box-art' : 'local-game-card'}>
                      <div className={game.boxArtUrl ? 'local-game-art has-art' : 'local-game-art'}>
                        {game.boxArtUrl ? (
                          <>
                            <img src={game.boxArtUrl} alt="" loading="lazy" />
                            <div className="local-game-art-overlay">
                              <strong>{game.title}</strong>
                              <small>{system?.label || 'Unknown system'}</small>
                            </div>
                          </>
                        ) : (
                          <span>{system?.shortLabel || game.system}</span>
                        )}
                      </div>
                      <div className="local-game-card-head">
                        <span>{system?.shortLabel || game.system}</span>
                        <button
                          type="button"
                          className={favourite ? 'active icon-button' : 'secondary icon-button'}
                          onClick={() => toggleFavourite(game.id)}
                          title={favourite ? 'Remove favourite' : 'Add favourite'}
                          aria-label={favourite ? `Remove ${game.title} from favourites` : `Add ${game.title} to favourites`}
                        >
                          <i className={favourite ? 'bi bi-star-fill' : 'bi bi-star'} aria-hidden="true" />
                        </button>
                      </div>
                      <h3>{game.title}</h3>
                      <p>{system?.label || 'Unknown system'}</p>
                      <small>{game.path}</small>
                      <button type="button" onClick={() => launchGame(game)} disabled={launchingId === game.id}>
                        {launchingId === game.id ? 'Starting...' : 'Play'}
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-local-library">
                <strong>{games.length ? 'No games match that filter' : 'No local library yet'}</strong>
                <span>{games.length ? 'Try another system or search term.' : 'Use Locate ROM folder to scan a folder you choose.'}</span>
              </div>
            )}
          </section>
          ) : null}
        </main>
    </div>
  );

  if (embedded) return content;

  return (
    <div className="page local-library-page">
      {content}
    </div>
  );
}
