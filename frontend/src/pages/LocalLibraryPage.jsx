import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { API_BASE_URL, apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';
import { getMameTitleDatabase } from '../data/mameTitleLookup';
import amigaLogoUrl from '../../assets/amiga500.svg';
import amigaAgaLogoUrl from '../../assets/amiga1200.svg';
import amstradLogoUrl from '../../assets/Amstrad_logo_1980s.svg.webp';
import arcadeLogoUrl from '../../assets/MAMELogo.svg';
import atariStLogoUrl from '../../assets/atari-st.webp';
import c64LogoUrl from '../../assets/C64_Logo.webp';
import masterSystemLogoUrl from '../../assets/Sega-master-system-logo.png';
import megaDriveLogoUrl from '../../assets/MegaDriveJPLogo.svg.webp';
import nesLogoUrl from '../../assets/NES_logo.svg.webp';
import pcEngineLogoUrl from '../../assets/PC_engine_logo_red.svg.webp';
import playStationLogoUrl from '../../assets/PlayStation_logo_and_wordmark.svg';
import snesLogoUrl from '../../assets/SNES_logo.svg.webp';
import spectrumLogoUrl from '../../assets/Sinclair_ZX_Spectrum-03.svg.webp';
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
    logo: arcadeLogoUrl,
    extensions: ['zip', '7z'],
    pathHints: ['mame', 'arcade'],
    note: 'MAME 2003 / 2003-Plus romset',
  },
  {
    id: 'cpc',
    roomSystem: 'cpc',
    label: 'Amstrad CPC',
    shortLabel: 'CPC',
    logo: amstradLogoUrl,
    extensions: ['dsk'],
    pathHints: ['amstrad', 'cpc'],
  },
  {
    id: 'spectrum',
    roomSystem: 'spectrum',
    label: 'ZX Spectrum',
    shortLabel: 'ZX',
    logo: spectrumLogoUrl,
    extensions: ['tap', 'tzx', 'z80', 'sna', 'szx', 'zip', '7z'],
    pathHints: ['spectrum', 'zx'],
  },
  {
    id: 'c64',
    roomSystem: 'c64',
    label: 'Commodore 64',
    shortLabel: 'C64',
    logo: c64LogoUrl,
    extensions: ['d64', 't64', 'tap', 'prg', 'crt', 'zip', '7z'],
    pathHints: ['c64', 'commodore'],
  },
  {
    id: 'nes',
    roomSystem: 'nes',
    label: 'NES',
    shortLabel: 'NES',
    logo: nesLogoUrl,
    extensions: ['nes', 'zip', '7z'],
    pathHints: ['nes', 'nintendo entertainment'],
  },
  {
    id: 'snes',
    roomSystem: 'snes',
    label: 'SNES',
    shortLabel: 'SNES',
    logo: snesLogoUrl,
    extensions: ['sfc', 'smc', 'zip', '7z'],
    pathHints: ['snes', 'super nintendo'],
  },
  {
    id: 'mastersystem',
    roomSystem: 'mastersystem',
    label: 'Sega Master System',
    shortLabel: 'SMS',
    logo: masterSystemLogoUrl,
    extensions: ['sms', 'zip', '7z'],
    pathHints: ['master system', 'mastersystem', 'sms'],
  },
  {
    id: 'megadrive',
    roomSystem: 'megadrive',
    label: 'Mega Drive',
    shortLabel: 'MD',
    logo: megaDriveLogoUrl,
    extensions: ['bin', 'gen', 'md', 'smd', 'zip', '7z'],
    pathHints: ['mega drive', 'megadrive', 'genesis'],
  },
  {
    id: 'pcengine',
    roomSystem: 'pcengine',
    label: 'PC Engine',
    shortLabel: 'PCE',
    logo: pcEngineLogoUrl,
    extensions: ['pce', 'sgx', 'zip', '7z'],
    pathHints: ['pc engine', 'pcengine', 'turbografx'],
  },
  {
    id: 'playstation',
    roomSystem: 'playstation',
    label: 'PlayStation',
    shortLabel: 'PS1',
    logo: playStationLogoUrl,
    extensions: ['cue', 'chd', 'pbp', 'iso', 'zip', '7z'],
    pathHints: ['playstation', 'ps1', 'psx'],
  },
  {
    id: 'amiga',
    roomSystem: 'amiga',
    label: 'Amiga',
    shortLabel: 'A500',
    logo: amigaLogoUrl,
    extensions: ['adf', 'zip', '7z'],
    pathHints: ['amiga', 'a500'],
  },
  {
    id: 'amiga_aga',
    roomSystem: 'amiga_aga',
    label: 'Amiga AGA',
    shortLabel: 'A1200',
    logo: amigaAgaLogoUrl,
    extensions: ['adf', 'adz', 'dms', 'ipf', 'zip', '7z'],
    pathHints: ['amiga aga', 'amiga 1200', 'amiga1200', 'a1200', 'aga'],
  },
  {
    id: 'atarist',
    roomSystem: 'atarist',
    label: 'Atari ST',
    shortLabel: 'ST',
    logo: atariStLogoUrl,
    extensions: ['st', 'msa', 'stx', 'ipf', 'zip', '7z'],
    pathHints: ['atari st', 'atarist'],
  },
];

const SYSTEM_BY_ID = Object.fromEntries(SUPPORTED_SYSTEMS.map((system) => [system.id, system]));
const mame2003PlusTitles = getMameTitleDatabase();
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
  nes: ['Nintendo_-_Nintendo_Entertainment_System'],
  snes: ['Nintendo_-_Super_Nintendo_Entertainment_System'],
  mastersystem: ['Sega_-_Master_System_-_Mark_III'],
  megadrive: ['Sega_-_Mega_Drive_-_Genesis'],
  pcengine: ['NEC_-_PC_Engine_-_TurboGrafx_16'],
  playstation: ['Sony_-_PlayStation'],
  amiga: ['Commodore_-_Amiga'],
  amiga_aga: ['Commodore_-_Amiga'],
  atarist: ['Atari_-_ST'],
};

const boxArtIndexCache = new Map();
const arcadeParentKeyCache = new Map();
const BOX_ART_NOISE_WORDS = new Set(['disney', 'disneys', 's', 'taito', 'sega', 'nintendo']);
const LIBRARY_PAGE_SIZE = 96;
const LIBRARY_ALPHABET = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
const COMPACT_REGION_SUFFIXES = {
  U: 'USA',
  E: 'Europe',
  J: 'Japan',
  W: 'World',
};
const TITLE_ACRONYMS = new Set([
  'ABC',
  'FIFA',
  'HQ',
  'MLB',
  'NBA',
  'NCAA',
  'NFL',
  'NHL',
  'RPG',
  'TV',
  'UFO',
  'USA',
  'WCW',
  'WWF',
]);

const COMPACT_TITLE_ALIASES = [
  ['3ninjaskickback', '3 Ninjas Kick Back'],
  ['7thsaga', '7th Saga'],
  ['90minutes', '90 Minutes European Prime Goal'],
  ['aaahhrealmonsters', 'Aaahh!!! Real Monsters'],
  ['abcmondaynightfootball', 'ABC Monday Night Football'],
  ['acmeanimationfactory', 'ACME Animation Factory'],
  ['adventuresofbatmanandrobin', 'Adventures of Batman and Robin'],
  ['adventuresoftintin', 'Adventures of Tintin'],
  ['battletoadsdoubledragon', 'Battletoads Double Dragon'],
  ['battletoads', 'Battletoads'],
  ['chasehq', 'Chase H.Q.'],
  ['disneysaladdin', "Disney's Aladdin"],
  ['disneysbonkers', "Disney's Bonkers"],
  ['disneysjunglebook', "Disney's The Jungle Book"],
  ['disneyslionking', "Disney's The Lion King"],
  ['disneyslittlemermaid', "Disney's The Little Mermaid"],
  ['indianajonesandthelastcrusade', 'Indiana Jones and the Last Crusade'],
  ['teenagemutantninjaturtlesturtlesintime', 'Teenage Mutant Ninja Turtles - Turtles in Time'],
  ['teenagemutantninjaturtles', 'Teenage Mutant Ninja Turtles'],
];

const SUPPORT_ROM_PATTERN = /\b(?:sound(?:s|track)?|music|bgm|sample(?:s)?|speech|voice(?:s)?|audio|ost|sound\s*test|music\s*test)\b/i;

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

function canonicalArcadeParentKey(romKey) {
  if (arcadeParentKeyCache.has(romKey)) return arcadeParentKeyCache.get(romKey);

  const metadata = mame2003PlusTitles[romKey];
  if (metadata) {
    const parentKey = metadata.parent || romKey;
    arcadeParentKeyCache.set(romKey, parentKey);
    return parentKey;
  }

  const parentPrefix = Object.entries(mame2003PlusTitles)
    .filter(([candidateKey, candidate]) => (
      candidateKey !== romKey
      && candidateKey.length >= 4
      && romKey.startsWith(candidateKey)
      && !candidate.parent
      && /^\d/.test(candidateKey)
    ))
    .sort(([left], [right]) => right.length - left.length)[0]?.[0];

  const parentKey = parentPrefix || romKey;
  arcadeParentKeyCache.set(romKey, parentKey);
  return parentKey;
}

function isArcadeParentRom(game) {
  if (game.system !== 'arcade') return true;
  const romKey = game.romKey || arcadeRomKey(game.fileName);
  return canonicalArcadeParentKey(romKey) === romKey;
}

function cleanArcadeDisplayTitle(value) {
  return titleCaseSmallWords(moveTrailingArticle(stripRegionAndMeta(value || '')))
    .replace(/\s+\bset\s+\d+\b$/i, '')
    .replace(/\s+\bversion\s+[a-z0-9.]+\b$/i, '')
    .replace(/\s+\bbootleg\b$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function arcadeMetadataTitle(game) {
  if (game.system !== 'arcade') return '';
  const romKey = game.romKey || arcadeRomKey(game.fileName);
  const parentKey = game.parentRomKey || canonicalArcadeParentKey(romKey);
  const metadata = mame2003PlusTitles[parentKey] || mame2003PlusTitles[romKey];
  return cleanArcadeDisplayTitle(metadata?.title || '');
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
      const upper = part.toUpperCase();
      if (/^(THE|A|AN|AND|OF|IN|ON|TO|FOR)$/i.test(part)) return part.toLowerCase();
      if (TITLE_ACRONYMS.has(upper)) return upper;
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
  return value
    .replace(/^(.+),\s*(the|a|an)$/i, (_match, title, article) => {
      const normalizedArticle = article.charAt(0).toUpperCase() + article.slice(1).toLowerCase();
      return `${normalizedArticle} ${title.trim()}`;
    })
    .replace(/^(.+?)\s+(the|a|an)$/i, (_match, title, article) => {
      const normalizedArticle = article.charAt(0).toUpperCase() + article.slice(1).toLowerCase();
      return `${normalizedArticle} ${title.trim()}`;
    });
}

function stripCompactRegionSuffix(value) {
  const trimmed = value.trim();
  const match = /^(.{3,})([UEJW])$/i.exec(trimmed);
  if (!match) return { title: trimmed, region: null };
  const looksLikeCompactRomName = !/\s/.test(trimmed)
    && (/^[0-9]/.test(trimmed) || /[a-z][A-Z0-9]/.test(trimmed) || /[A-Z][a-z]+[A-Z]$/.test(trimmed));
  if (!looksLikeCompactRomName) return { title: trimmed, region: null };

  const title = match[1].trim();
  const region = COMPACT_REGION_SUFFIXES[match[2].toUpperCase()] || null;
  return { title, region };
}

function splitCompactTitle(value) {
  return value
    .replace(/[_]+/g, ' ')
    .replace(/[-]+/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/\b([A-Z])\s+([A-Z])\b/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactTitleVariants(value) {
  const raw = fileBaseName(value || '').replace(/_/g, ' ').trim();
  const stripped = stripRegionAndMeta(raw);
  const knownTitle = knownCompactTitle(raw);
  return uniq([knownTitle, raw, stripped].flatMap((source) => {
    if (!source) return [];

    const regionless = stripCompactRegionSuffix(source);
    const split = splitCompactTitle(regionless.title);
    const articleFixed = moveTrailingArticle(split);
    const cased = titleCaseSmallWords(articleFixed);
    const regionSuffix = regionless.region ? `(${regionless.region})` : '';

    return [
      source,
      regionless.title,
      split,
      articleFixed,
      cased,
      regionSuffix ? `${split} ${regionSuffix}` : null,
      regionSuffix ? `${cased} ${regionSuffix}` : null,
      ...punctuationVariants(split),
      ...punctuationVariants(cased),
    ];
  }));
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

function normalizeCompactBoxArtKey(value) {
  return normalizeBoxArtKey(value).replace(/\s+/g, '');
}

function rawCompactKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[\[\(].*?[\]\)]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function knownCompactTitle(value) {
  const compact = rawCompactKey(value);
  const match = COMPACT_TITLE_ALIASES.find(([prefix]) => compact.startsWith(prefix));
  return match?.[1] || '';
}

function rawGitHubBoxArtUrl(repo, path, branch = 'master') {
  return `https://raw.githubusercontent.com/libretro-thumbnails/${repo}/${branch}/${path.split('/').map(encodeURIComponent).join('/')}`;
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
    compactKey: normalizeCompactBoxArtKey(fileName),
  };
}

function addBoxArtEntry(collection, repo, fileName, url) {
  if (collection.seenTitles.has(fileName)) return;

  const entry = makeBoxArtEntry(repo, fileName, url);
  collection.seenTitles.add(fileName);
  collection.entries.push(entry);
  if (entry.exactKey && !collection.exactMap.has(entry.exactKey)) {
    collection.exactMap.set(entry.exactKey, entry);
  }
  if (entry.looseKey && !collection.looseMap.has(entry.looseKey)) {
    collection.looseMap.set(entry.looseKey, entry);
  }
  if (entry.compactKey && !collection.compactMap.has(entry.compactKey)) {
    collection.compactMap.set(entry.compactKey, entry);
  }
}

async function getBoxArtIndex(systemId) {
  if (boxArtIndexCache.has(systemId)) return boxArtIndexCache.get(systemId);

  const repos = LIBRETRO_BOXART_REPOS[systemId] || [];
  const indexPromise = (async () => {
    const collection = {
      entries: [],
      exactMap: new Map(),
      looseMap: new Map(),
      compactMap: new Map(),
      seenTitles: new Set(),
    };
    for (const repo of repos) {
      for (const branch of ['master', 'main']) {
        try {
          const response = await fetch(`https://api.github.com/repos/libretro-thumbnails/${repo}/git/trees/${branch}?recursive=1`, { cache: 'force-cache' });
          if (!response.ok) continue;
          const payload = await response.json();
          const tree = Array.isArray(payload.tree) ? payload.tree : [];
          tree
            .filter((item) => item.type === 'blob' && /^Named_Boxarts\/.+\.png$/i.test(item.path))
            .forEach((item) => {
              const fileName = item.path.split('/').pop().replace(/\.png$/i, '');
              addBoxArtEntry(collection, repo, fileName, rawGitHubBoxArtUrl(repo, item.path, branch));
            });
          if (tree.length) break;
        } catch {
          // Try the next branch/repo; external metadata sources are best-effort.
        }
      }

      try {
        const setName = repo.replace(/_/g, ' ');
        const response = await fetch(`https://thumbnails.libretro.com/${encodeURIComponent(setName)}/Named_Boxarts/`, { cache: 'force-cache' });
        if (!response.ok) continue;
        const html = await response.text();
        const matches = [...html.matchAll(/href="([^"]+\.png)"/gi)];
        matches.forEach((match) => {
          const fileName = decodeURIComponent(match[1].split('/').pop().replace(/\.png$/i, '').replace(/\+/g, ' '));
          addBoxArtEntry(collection, repo, fileName, libretroBoxArtUrl(repo, fileName));
        });
      } catch {
        // Directory listings are a fallback for when the GitHub tree is stale or blocked.
      }
    }
    return collection;
  })();

  boxArtIndexCache.set(systemId, indexPromise);
  return indexPromise;
}

function findIndexedBoxArt(game, index) {
  const candidates = buildBoxArtNameCandidates(game);
  const exactKeys = candidates.map(normalizeExactBoxArtKey).filter(Boolean);
  const looseKeys = candidates.map(normalizeBoxArtKey).filter(Boolean);
  const compactKeys = candidates.map(normalizeCompactBoxArtKey).filter(Boolean);

  for (const key of exactKeys) {
    const match = index.exactMap.get(key);
    if (match) return match;
  }

  for (const key of looseKeys) {
    const match = index.looseMap.get(key);
    if (match) return match;
  }

  for (const key of compactKeys) {
    const match = index.compactMap.get(key);
    if (match) return match;
  }

  if (game.system === 'arcade') {
    return findArcadeIndexedBoxArtByTitle(candidates, index);
  }

  const baseKey = normalizeBoxArtKey(stripRegionAndMeta(fileBaseName(game.fileName)));
  if (baseKey.length >= 4) {
    const startsWithMatch = index.entries.find((entry) => entry.looseKey.startsWith(baseKey) || baseKey.startsWith(entry.looseKey));
    if (startsWithMatch) return startsWithMatch;
  }

  const candidateTokenSets = looseKeys
    .map((key) => key.split(' ').filter((token) => token.length > 1 && !BOX_ART_NOISE_WORDS.has(token)))
    .filter((tokens) => tokens.length >= 2);
  const subsetMatch = index.entries.find((entry) => {
    const entryTokens = new Set(entry.looseKey.split(' ').filter(Boolean));
    return candidateTokenSets.some((tokens) => tokens.every((token) => entryTokens.has(token)));
  });
  if (subsetMatch) return subsetMatch;

  return null;
}

function findArcadeIndexedBoxArtByTitle(candidates, index) {
  const safeKeys = uniq(candidates.map(normalizeBoxArtKey))
    .filter((key) => {
      if (key.length < 3) return false;
      const compact = key.replace(/\s+/g, '');
      const tokens = key.split(' ').filter(Boolean);
      return /^\d{3,5}$/.test(compact) || key.length >= 5 || tokens.length >= 2;
    });

  const safeCompacts = uniq(candidates.map(normalizeCompactBoxArtKey))
    .filter((key) => key.length >= 4);

  for (const key of safeKeys) {
    const match = index.entries.find((entry) => (
      entry.looseKey === key
      || entry.looseKey.startsWith(`${key} `)
    ));
    if (match) return match;
  }

  for (const key of safeCompacts) {
    const match = index.entries.find((entry) => (
      entry.compactKey === key
      || entry.compactKey.startsWith(key)
    ));
    if (match) return match;
  }

  return null;
}

function buildArcadeBoxArtNameCandidates(game) {
  const romKeys = uniq([
    game.romKey,
    arcadeRomKey(game.fileName),
    ...(game.variants || []).flatMap((variant) => [
      variant.romKey,
      arcadeRomKey(variant.fileName),
    ]),
  ].filter(Boolean));
  const parentKeys = uniq([
    game.parentRomKey,
    ...romKeys.map((romKey) => canonicalArcadeParentKey(romKey)),
  ]);
  const metadataTitles = uniq([...parentKeys, ...romKeys].flatMap((romKey) => {
    const title = mame2003PlusTitles[romKey]?.title || '';
    return [
      title,
      cleanArcadeDisplayTitle(title),
    ];
  }));
  const fileTitles = uniq([
    game.title,
    cleanArcadeDisplayTitle(game.title || ''),
    titleFromFileName(game.fileName || ''),
    ...(game.variants || []).flatMap((variant) => [
      variant.title,
      cleanArcadeDisplayTitle(variant.title || ''),
      titleFromFileName(variant.fileName || ''),
    ]),
  ]);

  return uniq([
    ...parentKeys,
    ...romKeys,
    ...metadataTitles,
    ...fileTitles,
  ]);
}

function buildBoxArtNameCandidates(game) {
  if (game.system === 'arcade') {
    return buildArcadeBoxArtNameCandidates(game);
  }

  const base = fileBaseName(game.fileName).replace(/_/g, ' ').trim();
  const compactBaseVariants = compactTitleVariants(base);
  const compactStoredTitleVariants = compactTitleVariants(game.title);
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
    ...compactStoredTitleVariants,
    ...compactBaseVariants,
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
    ...compactBaseVariants,
    ...titleVariants,
    ...titleVariants.flatMap((title) => appendRegions(title)),
    ...titleVariants.flatMap((title) => appendRegions(title, '(Rev 1)')),
    ...titleVariants.flatMap((title) => appendRegions(title, '(Beta)')),
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

function toApiMediaUrl(path) {
  if (!path) return path;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

function isExternalBoxArtUrl(url) {
  if (!/^https?:\/\//i.test(url || '')) return false;
  return !url.startsWith(API_BASE_URL);
}

async function cacheBoxArtUrl(game, sourceUrl) {
  try {
    const result = await apiFetch('/library/media/boxart', {
      method: 'POST',
      body: JSON.stringify({
        url: sourceUrl,
        system: game.system,
        title: game.title,
        rom_name: game.fileName || game.romKey || game.id,
      }),
    });
    if (result?.url) {
      return { url: toApiMediaUrl(result.url), cached: true };
    }
  } catch (error) {
    console.warn('Box art cache failed', error);
  }

  return { url: sourceUrl, cached: false };
}

async function buildBoxArtMedia(game, sourceUrl) {
  const cached = await cacheBoxArtUrl(game, sourceUrl);
  return {
    boxArtUrl: cached.url,
    boxArtSource: sourceUrl,
    boxArtCached: cached.cached,
    boxArtFetchedAt: new Date().toISOString(),
  };
}

async function findBoxArtForGame(game) {
  const index = await getBoxArtIndex(game.system);
  const indexedMatch = findIndexedBoxArt(game, index);
  if (indexedMatch) {
    const imageUrl = await probeImageUrl(indexedMatch.url);
    if (imageUrl) {
      return buildBoxArtMedia(game, imageUrl);
    }
  }

  if (game.system === 'arcade') {
    return null;
  }

  const repos = LIBRETRO_BOXART_REPOS[game.system] || [];
  const names = buildBoxArtNameCandidates(game);

  for (const repo of repos) {
    const setName = repo.replace(/_/g, ' ');
    for (const name of names) {
      const url = `https://thumbnails.libretro.com/${encodeURIComponent(setName)}/Named_Boxarts/${encodeURIComponent(name)}.png`;
      const imageUrl = await probeImageUrl(url);
      if (imageUrl) {
        return buildBoxArtMedia(game, imageUrl);
      }
    }
  }

  return null;
}

function titleFromFileName(fileName) {
  const base = fileBaseName(fileName);
  const knownTitle = knownCompactTitle(base);
  if (knownTitle) {
    return titleCaseSmallWords(moveTrailingArticle(knownTitle));
  }

  const compactTitle = compactTitleVariants(base)
    .map((variant) => stripRegionAndMeta(variant))
    .find((variant) => variant && variant.includes(' '));

  if (compactTitle) {
    return titleCaseSmallWords(moveTrailingArticle(compactTitle));
  }

  return titleCaseSmallWords(moveTrailingArticle(slugify(fileName)));
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

  if (extension === 'zip' || extension === '7z') {
    return null;
  }

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

function canonicalLibraryTitle(game) {
  const arcadeTitle = arcadeMetadataTitle(game);
  if (arcadeTitle) return arcadeTitle;

  const storedTitle = game.title || fileBaseName(game.fileName);
  const fileTitle = titleFromFileName(game.fileName || storedTitle);
  const knownTitle = knownCompactTitle(game.fileName || storedTitle);
  const rawTitle = knownTitle || (
    !storedTitle.includes(' ') && fileTitle.includes(' ')
      ? fileTitle
      : storedTitle
  );
  const withoutMeta = stripRegionAndMeta(rawTitle)
    .replace(/\b(?:rev(?:ision)?|version|ver)\s*[a-z0-9.]+$/i, '')
    .replace(/\b(?:beta|proto(?:type)?|sample|demo|hack|trainer|translation|overdump|bad dump|alternate)\b.*$/i, '')
    .replace(/\b(?:sound(?:s|track)?|music|bgm|sample(?:s)?|speech|voice(?:s)?)\b$/i, '')
    .replace(/\b(?:usa|europe|japan|world|korea|brazil|australia|france|germany|spain|italy)\b$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return titleCaseSmallWords(moveTrailingArticle(withoutMeta || rawTitle));
}

function withRomanSearchAliases(value) {
  const variants = [value];
  variants.push(value.replace(/\bII\b/gi, '2'));
  variants.push(value.replace(/\bIII\b/gi, '3'));
  variants.push(value.replace(/\bIV\b/gi, '4'));
  variants.push(value.replace(/\bVI\b/gi, '6'));
  variants.push(value.replace(/\bVII\b/gi, '7'));
  variants.push(value.replace(/\bVIII\b/gi, '8'));
  variants.push(value.replace(/\bIX\b/gi, '9'));
  variants.push(value.replace(/\b2\b/g, 'II'));
  variants.push(value.replace(/\b3\b/g, 'III'));
  variants.push(value.replace(/\b4\b/g, 'IV'));
  return uniq(variants);
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.[^.]+$/, ' ')
    .replace(/\bh\s*\.?\s*q\.?\b/g, 'hq')
    .replace(/\bdisney'?s?\b/g, 'disney')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bh q\b/g, 'hq')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSearchText(value) {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function searchableTitleParts(game) {
  const romKey = game.system === 'arcade' ? (game.romKey || arcadeRomKey(game.fileName)) : '';
  const parentKey = romKey ? (game.parentRomKey || canonicalArcadeParentKey(romKey)) : '';
  const arcadeTitles = uniq([
    romKey,
    parentKey,
    mame2003PlusTitles[romKey]?.title,
    mame2003PlusTitles[parentKey]?.title,
    cleanArcadeDisplayTitle(mame2003PlusTitles[romKey]?.title),
    cleanArcadeDisplayTitle(mame2003PlusTitles[parentKey]?.title),
  ]);
  const titleParts = uniq([
    canonicalLibraryTitle(game),
    game.title,
    titleFromFileName(game.fileName || ''),
    fileBaseName(game.fileName || ''),
    knownCompactTitle(game.fileName || game.title || ''),
    ...arcadeTitles,
    ...(game.variants || []).flatMap((variant) => [
      canonicalLibraryTitle(variant),
      variant.title,
      titleFromFileName(variant.fileName || ''),
      fileBaseName(variant.fileName || ''),
      variant.fileName,
      variant.path,
      knownCompactTitle(variant.fileName || variant.title || ''),
      variant.system === 'arcade' ? (variant.romKey || arcadeRomKey(variant.fileName)) : '',
      variant.system === 'arcade' ? (variant.parentRomKey || canonicalArcadeParentKey(variant.romKey || arcadeRomKey(variant.fileName))) : '',
      variant.system === 'arcade' ? cleanArcadeDisplayTitle(mame2003PlusTitles[variant.romKey || arcadeRomKey(variant.fileName)]?.title) : '',
      variant.system === 'arcade' ? cleanArcadeDisplayTitle(mame2003PlusTitles[variant.parentRomKey || canonicalArcadeParentKey(variant.romKey || arcadeRomKey(variant.fileName))]?.title) : '',
    ]),
  ]);

  return uniq(titleParts.flatMap((part) => withRomanSearchAliases(part || '')));
}

function matchesLibraryQuery(game, query) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return true;

  const queryVariants = uniq(withRomanSearchAliases(trimmedQuery).flatMap((part) => [
    normalizeSearchText(part),
    compactSearchText(part),
  ]));
  const haystacks = uniq(searchableTitleParts(game).flatMap((part) => [
    normalizeSearchText(part),
    compactSearchText(part),
  ]));

  return queryVariants.some((queryPart) => (
    queryPart.length > 0
    && haystacks.some((haystack) => haystack.includes(queryPart))
  ));
}

function getLibraryTitleInitial(title) {
  const first = String(title || '').trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : '#';
}

function isLikelySupportRom(gameOrName) {
  const fileName = typeof gameOrName === 'string'
    ? gameOrName
    : gameOrName?.fileName || gameOrName?.name || '';
  const normalizedName = fileBaseName(fileName)
    .replace(/[\[\](){}]/g, ' ')
    .replace(/[_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return SUPPORT_ROM_PATTERN.test(normalizedName);
}

function libraryGroupKey(game, { showArcadeClones = false } = {}) {
  if (game.system === 'arcade') {
    if (showArcadeClones) return `arcade:${game.id}`;
    const romKey = game.romKey || arcadeRomKey(game.fileName);
    return `arcade:${canonicalArcadeParentKey(romKey)}`;
  }

  const canonicalTitle = canonicalLibraryTitle(game);
  return `${game.system}:${normalizeBoxArtKey(canonicalTitle) || normalizeExactBoxArtKey(canonicalTitle) || game.id}`;
}

function variantPreferenceScore(game) {
  const haystack = `${game.fileName} ${game.path}`.toLowerCase();
  let score = 0;

  if (game.boxArtUrl) score -= 1000;
  if (/\(europe\)|\b\(e\)\b/.test(haystack)) score -= 90;
  if (/\(world\)/.test(haystack)) score -= 80;
  if (/\(usa\)|\b\(u\)\b/.test(haystack)) score -= 70;
  if (/\(japan\)|\b\(j\)\b/.test(haystack)) score -= 35;
  if (/\[!\]/.test(haystack)) score -= 25;
  if (/\b(?:rev|revision|version|ver|beta|proto|sample|demo|hack|trainer|translation|overdump|bad|alternate)\b|\[(?:b|h|o|p|t)[0-9+\]]/i.test(haystack)) score += 100;

  score += game.fileName.length / 100;
  return score;
}

function makeGroupedGame(variants) {
  const sortedVariants = [...variants].sort((left, right) => {
    const score = variantPreferenceScore(left) - variantPreferenceScore(right);
    if (score !== 0) return score;
    return left.fileName.localeCompare(right.fileName);
  });
  const preferred = sortedVariants[0];
  return {
    ...preferred,
    title: canonicalLibraryTitle(preferred),
    variantCount: sortedVariants.length,
    variants: sortedVariants,
  };
}

function groupLibraryGames(games, options = {}) {
  const groups = new Map();

  for (const game of games) {
    const key = libraryGroupKey(game, options);
    const variants = groups.get(key) || [];
    variants.push(game);
    groups.set(key, variants);
  }

  return [...groups.values()].map(makeGroupedGame);
}

export default function LocalLibraryPage({ embedded = false, onboarding = false, onComplete = null }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isSuperAdmin = localStorage.getItem('isSuperAdmin') === 'true';
  const isVip = localStorage.getItem('isVip') === 'true'
    || localStorage.getItem('isAdmin') === 'true'
    || isSuperAdmin;
  const availableSystems = useMemo(
    () => SUPPORTED_SYSTEMS.filter((system) => !system.superAdminOnly || isSuperAdmin),
    [isSuperAdmin],
  );
  const requestedSystem = searchParams.get('system');
  const requestedSystemExists = availableSystems.some((system) => system.id === requestedSystem);
  const requestedLetter = searchParams.get('letter');
  const requestedLetterExists = requestedLetter === 'all' || LIBRARY_ALPHABET.includes(requestedLetter);
  const username = localStorage.getItem('username');
  const [folders, setFolders] = useState([]);
  const [games, setGames] = useState([]);
  const [selectedSystems, setSelectedSystems] = useState([]);
  const [activeSystem, setActiveSystem] = useState(requestedSystemExists ? requestedSystem : 'all');
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [favourites, setFavourites] = useState([]);
  const [status, setStatus] = useState('Loading library...');
  const [scanProgress, setScanProgress] = useState(null);
  const [mediaProgress, setMediaProgress] = useState(null);
  const [launchingId, setLaunchingId] = useState(null);
  const [launchingSystemId, setLaunchingSystemId] = useState(null);
  const [showArcadeClones, setShowArcadeClones] = useState(searchParams.get('clones') === '1');
  const [showBoxArtOnly, setShowBoxArtOnly] = useState(searchParams.get('boxArt') === '1');
  const [letterFilter, setLetterFilter] = useState(requestedLetterExists ? requestedLetter : 'all');
  const [joinCode, setJoinCode] = useState('');
  const [loadingJoin, setLoadingJoin] = useState(false);
  const [renderLimit, setRenderLimit] = useState(LIBRARY_PAGE_SIZE);
  const [brokenBoxArtIds, setBrokenBoxArtIds] = useState(() => new Set());

  function buildLibraryReturnPath(overrides = {}) {
    const params = new URLSearchParams();
    const nextSystem = overrides.system ?? activeSystem;
    const nextQuery = overrides.query ?? query;
    const nextLetter = overrides.letter ?? letterFilter;
    const nextShowArcadeClones = overrides.showArcadeClones ?? showArcadeClones;
    const nextShowBoxArtOnly = overrides.showBoxArtOnly ?? showBoxArtOnly;

    if (nextSystem && nextSystem !== 'all') params.set('system', nextSystem);
    if (nextQuery.trim()) params.set('q', nextQuery.trim());
    if (nextLetter && nextLetter !== 'all') params.set('letter', nextLetter);
    if (nextShowArcadeClones) params.set('clones', '1');
    if (nextShowBoxArtOnly) params.set('boxArt', '1');

    const queryString = params.toString();
    return queryString ? `/library?${queryString}` : '/library';
  }

  useEffect(() => {
    async function loadLibrary() {
      try {
        const [savedFolders, savedGames, savedSystems, savedFavourites] = await Promise.all([
          getLocalLibraryFolders(),
          getLocalLibraryGames(),
          getLocalLibrarySetting('selectedSystems', []),
          getLocalLibrarySetting('favourites', []),
        ]);
        const localGames = savedGames.filter((game) => game.source !== 'internet-archive-mame');
        setFolders(savedFolders);
        setGames(localGames);
        if (isVip) {
          setStatus('Connecting VIP MAME library...');
          const catalog = await apiFetch('/auth/vip/mame/catalog');
          const sampleNames = new Set(Array.isArray(catalog.samples) ? catalog.samples : []);
          const localArcadeKeys = new Set(
            localGames
              .filter((game) => game.system === 'arcade')
              .map((game) => arcadeRomKey(game.fileName)),
          );
          const archiveGames = (Array.isArray(catalog.roms) ? catalog.roms : [])
            .filter((fileName) => !localArcadeKeys.has(arcadeRomKey(fileName)))
            .map((fileName) => {
              const romKey = arcadeRomKey(fileName);
              const parentRomKey = canonicalArcadeParentKey(romKey);
              const title = cleanArcadeDisplayTitle(mame2003PlusTitles[romKey]?.title)
                || titleFromFileName(fileName);
              const sampleFileName = [romKey, parentRomKey]
                .map((key) => `${key}.zip`)
                .find((name) => sampleNames.has(name)) || '';
              return {
                id: `archive-mame:${romKey}`,
                title,
                fileName,
                path: `Internet Archive/roms/${fileName}`,
                system: 'arcade',
                roomSystem: 'arcade',
                romKey,
                parentRomKey,
                source: 'internet-archive-mame',
                archiveSampleFileName: sampleFileName,
              };
            });
          setGames([...localGames, ...archiveGames]);
          setStatus(`VIP MAME library ready: ${archiveGames.length} remote games.`);
        } else {
          setGames(localGames);
          setStatus(localGames.length ? 'Library ready' : 'Choose a ROM folder to build your local library.');
        }
        const availableSystemIds = new Set(availableSystems.map((system) => system.id));
        const availableSavedSystems = savedSystems.filter((systemId) => availableSystemIds.has(systemId));
        setSelectedSystems(availableSavedSystems.length ? availableSavedSystems : availableSystems.map((system) => system.id));
        setFavourites(savedFavourites);
      } catch (err) {
        setStatus(`Could not load local library: ${err.message}`);
      }
    }

    loadLibrary();
  }, [availableSystems, isVip]);

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

  const groupedGames = useMemo(
    () => groupLibraryGames(
      games.filter((game) => (
        !isLikelySupportRom(game)
        && (showArcadeClones || game.system !== 'arcade' || isArcadeParentRom(game))
      )),
      { showArcadeClones },
    ),
    [games, showArcadeClones],
  );
  const systemCounts = useMemo(() => buildSystemCounts(groupedGames), [groupedGames]);
  const visibleSystems = useMemo(
    () => availableSystems.filter((system) => (systemCounts[system.id] || 0) > 0 || folders.some((folder) => folder.system === system.id)),
    [availableSystems, folders, systemCounts],
  );
  const activeSystemDetails = activeSystem === 'all' || activeSystem === 'favourites'
    ? null
    : SYSTEM_BY_ID[activeSystem];
  const activeSystemFolder = activeSystemDetails
    ? folders.find((folder) => folder.system === activeSystemDetails.id)
    : null;
  const favouriteSet = useMemo(() => new Set(favourites), [favourites]);
  const activeLibraryGames = useMemo(() => {
    return groupedGames
      .filter((game) => (
        activeSystem === 'all'
        || game.system === activeSystem
        || (activeSystem === 'favourites' && game.variants.some((variant) => favouriteSet.has(variant.id)))
      ));
  }, [activeSystem, favouriteSet, groupedGames]);
  const activeLibraryCountLabel = activeSystem === 'all'
    ? 'indexed games'
    : activeSystem === 'favourites'
      ? 'favourites'
      : `${activeSystemDetails?.label || 'platform'} games`;
  const letterSourceGames = useMemo(() => {
    return activeLibraryGames
      .filter((game) => !showBoxArtOnly || (Boolean(game.boxArtUrl) && !brokenBoxArtIds.has(game.id)))
      .filter((game) => matchesLibraryQuery(game, query))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [activeLibraryGames, brokenBoxArtIds, query, showBoxArtOnly]);
  const alphabetCounts = useMemo(() => {
    const counts = Object.fromEntries(LIBRARY_ALPHABET.map((letter) => [letter, 0]));
    letterSourceGames.forEach((game) => {
      const initial = getLibraryTitleInitial(game.title);
      counts[initial] = (counts[initial] || 0) + 1;
    });
    return counts;
  }, [letterSourceGames]);
  const filteredGames = useMemo(() => {
    if (letterFilter === 'all') return letterSourceGames;
    return letterSourceGames.filter((game) => getLibraryTitleInitial(game.title) === letterFilter);
  }, [letterFilter, letterSourceGames]);
  const hiddenArcadeCloneCount = useMemo(
    () => {
      if (activeSystem !== 'all' && activeSystem !== 'arcade' && activeSystem !== 'favourites') return 0;
      return games
        .filter((game) => activeSystem !== 'favourites' || favouriteSet.has(game.id))
        .filter((game) => game.system === 'arcade' && !isArcadeParentRom(game))
        .length;
    },
    [activeSystem, favouriteSet, games],
  );
  const hiddenVariantCount = useMemo(
    () => filteredGames.reduce((count, game) => count + Math.max(0, (game.variantCount || 1) - 1), 0),
    [filteredGames],
  );
  const displayedGames = useMemo(() => filteredGames.slice(0, renderLimit), [filteredGames, renderLimit]);
  const canShowMoreGames = filteredGames.length > displayedGames.length;

  useEffect(() => {
    setRenderLimit(LIBRARY_PAGE_SIZE);
  }, [activeSystem, letterFilter, query, showArcadeClones, showBoxArtOnly]);

  useEffect(() => {
    if (letterFilter !== 'all' && !alphabetCounts[letterFilter]) {
      setLetterFilter('all');
    }
  }, [alphabetCounts, letterFilter]);

  useEffect(() => {
    if (!canShowMoreGames) return undefined;

    function loadMoreNearPageBottom() {
      const documentElement = document.documentElement;
      const distanceFromBottom = documentElement.scrollHeight - window.scrollY - window.innerHeight;
      if (distanceFromBottom > 1000) return;
      setRenderLimit((limit) => Math.min(filteredGames.length, limit + LIBRARY_PAGE_SIZE));
    }

    window.addEventListener('scroll', loadMoreNearPageBottom, { passive: true });
    loadMoreNearPageBottom();
    return () => window.removeEventListener('scroll', loadMoreNearPageBottom);
  }, [canShowMoreGames, filteredGames.length]);

  async function toggleFavourite(game) {
    const variantIds = new Set((game.variants || [game]).map((variant) => variant.id));
    const isFavourite = [...variantIds].some((id) => favouriteSet.has(id));
    const next = isFavourite
      ? favourites.filter((id) => !variantIds.has(id))
      : [...favourites, game.id];
    setFavourites(next);
    await saveLocalLibrarySetting('favourites', next);
  }

  async function finishSetup() {
    await saveLocalLibrarySetting('librarySetupComplete', true);
    if (onComplete) {
      onComplete();
      return;
    }
    navigate('/library');
  }

  async function pickSystemFolder(targetSystemId) {
    if (!canUseDirectoryPicker()) {
      setStatus('Folder scanning needs Chrome, Edge, Brave, or another Chromium browser.');
      return;
    }
    if (window.isSecureContext === false) {
      setStatus('Folder scanning needs localhost or HTTPS before the browser will allow folder access.');
      return;
    }

    const targetSystem = targetSystemId ? SYSTEM_BY_ID[targetSystemId] : null;
    if (!targetSystem) {
      setStatus('Choose a system first, then add that system folder.');
      return;
    }

    let directoryHandle;
    try {
      directoryHandle = await window.showDirectoryPicker({ mode: 'read' });
    } catch (err) {
      if (err?.name === 'AbortError') {
        setStatus('Folder selection cancelled.');
      } else if (err?.name === 'SecurityError' || err?.name === 'NotAllowedError') {
        setStatus('Brave blocked folder access. Allow file and folder access for this site or turn Shields off for localhost, then try Add folder again.');
      } else {
        setStatus(`Folder picker failed: ${err?.message || 'Browser blocked folder access.'}`);
      }
      setScanProgress(null);
      return;
    }

    await scanSystemFolder(targetSystem, directoryHandle);
  }

  async function scanSystemFolder(targetSystem, directoryHandle) {
    try {
      const folderId = `system:${targetSystem.id}`;
      const nextGames = [];
      const sampleHandles = [];
      let scanned = 0;
      let skippedSupport = 0;
      setScanProgress({ scanned: 0, matched: 0 });
      setStatus(`Scanning ${directoryHandle.name} for ${targetSystem.label}...`);

      for await (const entry of walkDirectory(directoryHandle)) {
        scanned += 1;
        const extension = getFileExtension(entry.name);
        const pathParts = entry.path.split(/[\\/]+/).map((part) => part.toLowerCase());
        const inSamplesFolder = pathParts.includes('samples');

        if (targetSystem.id === 'arcade' && inSamplesFolder && ['zip', '7z'].includes(extension)) {
          sampleHandles.push({
            key: entry.name.replace(/\.(zip|7z)$/i, '').toLowerCase(),
            name: entry.name,
            path: entry.path,
            handle: entry.handle,
          });
          continue;
        }

        if (isLikelySupportRom(entry.name)) {
          skippedSupport += 1;
          continue;
        }

        const system = targetSystem.extensions.includes(extension)
          ? targetSystem
          : null;
        if (system) {
          const romKey = system.id === 'arcade' ? arcadeRomKey(entry.name) : '';
          const parentRomKey = romKey ? canonicalArcadeParentKey(romKey) : '';
          const arcadeTitle = romKey
            ? cleanArcadeDisplayTitle(mame2003PlusTitles[romKey]?.title || mame2003PlusTitles[parentRomKey]?.title || '')
            : '';
          nextGames.push({
            id: `${folderId}:${entry.path}`,
            folderId,
            folderName: directoryHandle.name,
            folderSystem: targetSystem.id,
            title: arcadeTitle || titleFromFileName(entry.name),
            fileName: entry.name,
            path: entry.path,
            extension,
            system: system.id,
            roomSystem: system.roomSystem,
            romKey,
            parentRomKey,
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
        system: targetSystem.id,
        systemLabel: targetSystem.label,
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
      if (!selectedSystems.includes(targetSystem.id)) {
        const nextSelectedSystems = [...selectedSystems, targetSystem.id];
        setSelectedSystems(nextSelectedSystems);
        await saveLocalLibrarySetting('selectedSystems', nextSelectedSystems);
      }
      setFolders(mergedFolders);
      setGames(mergedGames);
      setScanProgress(null);
      setStatus(`Found ${nextGames.length} ${targetSystem.label} file${nextGames.length === 1 ? '' : 's'} in ${directoryHandle.name}${sampleHandles.length ? `, plus ${sampleHandles.length} MAME sample zip${sampleHandles.length === 1 ? '' : 's'}` : ''}${skippedSupport ? `, skipped ${skippedSupport} support file${skippedSupport === 1 ? '' : 's'}` : ''}.`);
    } catch (err) {
      setStatus(`Scan failed: ${err?.message || 'Could not read that folder.'}`);
      setScanProgress(null);
    }
  }

  async function clearSystemFolder(systemId) {
    const system = SYSTEM_BY_ID[systemId];
    if (!system) return;

    const removedGameIds = new Set(
      games
        .filter((game) => game.system === systemId || game.folderSystem === systemId || game.folderId === `system:${systemId}`)
        .map((game) => game.id),
    );
    const nextFolders = folders.filter((folder) => folder.system !== systemId && folder.id !== `system:${systemId}`);
    const nextGames = games.filter((game) => (
      game.system !== systemId
      && game.folderSystem !== systemId
      && game.folderId !== `system:${systemId}`
    ));
    const nextFavourites = favourites.filter((id) => !removedGameIds.has(id));

    try {
      await Promise.all([
        saveLocalLibraryFolders(nextFolders),
        saveLocalLibraryGames(nextGames),
        saveLocalLibrarySetting('favourites', nextFavourites),
      ]);
      setFolders(nextFolders);
      setGames(nextGames);
      setFavourites(nextFavourites);
      setStatus(`${system.label} folder cleared. Your ROM files were not changed.`);
    } catch (err) {
      setStatus(`Could not clear ${system.label}: ${err.message}`);
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
        source: game.source || 'local',
        archiveSampleFileName: game.archiveSampleFileName || '',
      }));

      const room = await apiFetch('/rooms/create', {
        method: 'POST',
        body: JSON.stringify({
          system: game.roomSystem,
          party_max_players: 2,
        }),
      });
      const nextParams = new URLSearchParams({
        localGame: game.id,
        returnTo: buildLibraryReturnPath(),
      });
      navigate(`/room/${room.room_code}?${nextParams.toString()}`);
    } catch (err) {
      setStatus(`Could not start ${game.title}: ${err.message}`);
    } finally {
      setLaunchingId(null);
    }
  }

  async function handleJoinRoom(event) {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code || loadingJoin) return;

    setLoadingJoin(true);
    setStatus(`Joining room ${code}...`);
    try {
      const room = await apiFetch('/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ room_code: code }),
      });
      const nextParams = new URLSearchParams({
        returnTo: buildLibraryReturnPath(),
      });
      navigate(`/room/${room.room_code}?${nextParams.toString()}`);
    } catch (err) {
      setStatus(`Could not join room ${code}: ${err.message}`);
    } finally {
      setLoadingJoin(false);
    }
  }

  function leaveLibrary() {
    if (mediaProgress && !window.confirm('Box art download is still running. Leave this page anyway?')) {
      return;
    }
    navigate('/lobby');
  }

  async function launchSystemRoom(system) {
    if (!system) return;

    setLaunchingSystemId(system.id);
    setStatus(`Opening ${system.label} room...`);
    try {
      const room = await apiFetch('/rooms/create', {
        method: 'POST',
        body: JSON.stringify({
          system: system.roomSystem,
          party_max_players: 2,
        }),
      });
      const nextParams = new URLSearchParams({
        returnTo: buildLibraryReturnPath({ system: system.id }),
      });
      navigate(`/room/${room.room_code}?${nextParams.toString()}`);
    } catch (err) {
      setStatus(`Could not open ${system.label}: ${err.message}`);
    } finally {
      setLaunchingSystemId(null);
    }
  }

  async function downloadBoxArt() {
    const skippedArcadeClones = filteredGames.filter((game) => game.system === 'arcade' && !isArcadeParentRom(game) && !game.boxArtUrl).length;
    const targets = filteredGames.filter((game) => (
      isArcadeParentRom(game)
      && (!game.boxArtUrl || brokenBoxArtIds.has(game.id) || isExternalBoxArtUrl(game.boxArtUrl))
    ));
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
            setBrokenBoxArtIds((current) => {
              if (!current.has(game.id)) return current;
              const next = new Set(current);
              next.delete(game.id);
              return next;
            });
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
            <p>{onboarding ? (games.length ? 'Your browser already has a scanned library. Pick a platform and keep playing.' : 'Choose each system folder once and your games become a console-style library.') : 'Pick a platform, browse the wall, and launch straight into a room.'}</p>
          </div>
          <div className="local-library-actions">
            <span>Choose a system below, then add its ROM folder.</span>
            <span>{folders.length ? `${folders.length} folder${folders.length === 1 ? '' : 's'} connected` : 'No folders connected yet'}</span>
            {!onboarding ? (
              <form className="quick-join library-quick-join" onSubmit={handleJoinRoom}>
                <label>
                  <span>Join room</span>
                  <input
                    placeholder="ABC123"
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                    maxLength={8}
                  />
                </label>
                <button type="submit" disabled={!joinCode || loadingJoin}>
                  {loadingJoin ? 'Joining...' : 'Join'}
                </button>
              </form>
            ) : null}
          </div>
        </section>

        {onboarding ? (
          <section className="setup-wizard library-overview-strip" aria-label="Library overview">
            <div className="setup-step active">
              <span>1</span>
              <strong>Select systems</strong>
              <small>{visibleSystems.length || selectedSystems.length} visible</small>
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
        ) : null}

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
              <div className="library-panel-head">
                <h2>Platforms</h2>
                <button type="button" className="secondary" onClick={() => setActiveSystem('all')}>All</button>
              </div>
              <div className="system-picker-list platform-rail">
                {availableSystems.map((system) => {
                  const linkedFolder = folders.find((folder) => folder.system === system.id);
                  const count = systemCounts[system.id] || 0;
                  const folderLabel = linkedFolder ? linkedFolder.name : 'No folder connected';
                  return (
                    <div key={system.id} className={activeSystem === system.id ? 'system-picker-row enabled' : 'system-picker-row'}>
                      <button
                        type="button"
                        className="platform-select-button"
                        onClick={() => setActiveSystem(system.id)}
                        title={`${system.label} - ${folderLabel}`}
                      >
                        <span className="platform-logo-badge" aria-hidden="true">
                          {system.logo ? (
                            <img
                              className={`platform-rail-logo platform-rail-logo-${system.id}`}
                              src={system.logo}
                              alt=""
                            />
                          ) : (
                            <span>{system.shortLabel}</span>
                          )}
                        </span>
                        <span className="platform-title-stack">
                          <strong>{system.label}</strong>
                        </span>
                        <small>{count}</small>
                      </button>
                      <button
                        type="button"
                        className="secondary platform-config-button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          pickSystemFolder(system.id);
                        }}
                        title={`Configure ${system.label}`}
                        aria-label={`Configure ${system.label}`}
                      >
                        <i className="bi bi-gear-fill" aria-hidden="true" />
                      </button>
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
                    <div key={folder.id} className="library-folder-row">
                      <div>
                        <strong>{folder.systemLabel || folder.system || 'Library'}</strong>
                        <span>{folder.name}</span>
                        <small>{folder.gameCount || 0} game{folder.gameCount === 1 ? '' : 's'}{folder.sampleCount ? `, ${folder.sampleCount} samples` : ''}</small>
                      </div>
                      {folder.system ? (
                        <button
                          type="button"
                          className="secondary folder-clear-button"
                          onClick={() => clearSystemFolder(folder.system)}
                          title={`Clear ${folder.systemLabel || folder.system} folder`}
                          aria-label={`Clear ${folder.systemLabel || folder.system} folder`}
                        >
                          <i className="bi bi-trash3" aria-hidden="true" />
                        </button>
                      ) : null}
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
            <div className="local-library-titlebar">
              <div>
                <p className="lobby-eyebrow">{activeSystem === 'favourites' ? 'Saved Picks' : activeSystemDetails?.shortLabel || 'All Platforms'}</p>
                <h2>{activeSystem === 'favourites' ? 'Favourites' : activeSystemDetails?.label || 'All Games'}</h2>
                <span>{filteredGames.length} shown from {activeLibraryGames.length} {activeLibraryCountLabel}</span>
              </div>
              {activeSystemDetails ? (
                <div className="local-library-title-actions">
                  <div className="platform-manage-card">
                    <strong>Manage platform</strong>
                    <span>{activeSystemFolder ? activeSystemFolder.name : 'No folder connected'}</span>
                    <small>{activeSystemFolder ? `${activeSystemFolder.gameCount || 0} indexed file${activeSystemFolder.gameCount === 1 ? '' : 's'}` : 'Open a room or add a folder.'}</small>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => launchSystemRoom(activeSystemDetails)}
                    disabled={launchingSystemId === activeSystemDetails.id}
                  >
                    {launchingSystemId === activeSystemDetails.id ? 'Opening...' : 'Open room'}
                  </button>
                  <button type="button" onClick={() => pickSystemFolder(activeSystemDetails.id)}>
                    {activeSystemFolder ? 'Change folder' : 'Add folder'}
                  </button>
                  {activeSystemFolder ? (
                    <button
                      type="button"
                      className="secondary danger-soft-button"
                      onClick={() => clearSystemFolder(activeSystemDetails.id)}
                    >
                      Clear folder
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="local-library-toolbar">
              <div className="library-filter-tabs" aria-label="Library filters">
                <button type="button" className={activeSystem === 'all' ? 'active' : 'secondary'} onClick={() => setActiveSystem('all')}>
                  All
                </button>
                <button type="button" className={activeSystem === 'favourites' ? 'active' : 'secondary'} onClick={() => setActiveSystem('favourites')}>
                  Favourites
                </button>
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
              <label className="library-clone-toggle">
                <input
                  type="checkbox"
                  checked={showBoxArtOnly}
                  onChange={(event) => setShowBoxArtOnly(event.target.checked)}
                />
                <span>Box art only</span>
              </label>
              <button type="button" className="secondary download-media-button" onClick={downloadBoxArt} disabled={!filteredGames.length || Boolean(mediaProgress)}>
                {mediaProgress ? `Box art ${mediaProgress.checked}/${mediaProgress.total}` : 'Download box art'}
              </button>
            </div>
            <div className="library-alpha-strip" aria-label="Filter games by first letter">
              <button
                type="button"
                className={letterFilter === 'all' ? 'active' : 'secondary'}
                onClick={() => setLetterFilter('all')}
              >
                All
              </button>
              {LIBRARY_ALPHABET.map((letter) => {
                const count = alphabetCounts[letter] || 0;
                return (
                  <button
                    key={letter}
                    type="button"
                    className={letterFilter === letter ? 'active' : 'secondary'}
                    onClick={() => setLetterFilter(letter)}
                    disabled={!count}
                    title={`${count} ${count === 1 ? 'game' : 'games'} beginning with ${letter}`}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>

            <div className="library-summary-strip">
              <strong>{filteredGames.length}</strong>
              <span>shown from {activeLibraryGames.length} {activeLibraryCountLabel}{letterFilter !== 'all' ? ` - ${letterFilter}` : ''}{hiddenVariantCount ? ` - ${hiddenVariantCount} variants grouped` : ''}{showBoxArtOnly ? ' - box art only' : ''}{!showArcadeClones && hiddenArcadeCloneCount ? ` - ${hiddenArcadeCloneCount} MAME clones hidden` : ''}{mediaProgress ? ` - found ${mediaProgress.found}` : ''}</span>
            </div>
            {mediaProgress ? (
              <div className="media-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax={mediaProgress.total} aria-valuenow={mediaProgress.checked}>
                <span style={{ width: `${Math.round((mediaProgress.checked / mediaProgress.total) * 100)}%` }} />
              </div>
            ) : null}

            {filteredGames.length ? (
              <div className="local-game-grid">
                {displayedGames.map((game) => {
                  const system = SYSTEM_BY_ID[game.system];
                  const favourite = game.variants.some((variant) => favouriteSet.has(variant.id));
                  const hasBoxArt = Boolean(game.boxArtUrl) && !brokenBoxArtIds.has(game.id);
                  return (
                    <article key={game.id} className={hasBoxArt ? 'local-game-card has-box-art' : 'local-game-card'}>
                      <div className={hasBoxArt ? 'local-game-art has-art' : 'local-game-art'}>
                        {hasBoxArt ? (
                          <>
                            <img
                              src={game.boxArtUrl}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                              onError={() => {
                                setBrokenBoxArtIds((current) => {
                                  if (current.has(game.id)) return current;
                                  const next = new Set(current);
                                  next.add(game.id);
                                  return next;
                                });
                              }}
                            />
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
                        {game.variantCount > 1 ? (
                          <em>{game.variantCount} versions</em>
                        ) : null}
                        <button
                          type="button"
                          className={favourite ? 'active icon-button' : 'secondary icon-button'}
                          onClick={() => toggleFavourite(game)}
                          title={favourite ? 'Remove favourite' : 'Add favourite'}
                          aria-label={favourite ? `Remove ${game.title} from favourites` : `Add ${game.title} to favourites`}
                        >
                          <i className={favourite ? 'bi bi-star-fill' : 'bi bi-star'} aria-hidden="true" />
                        </button>
                      </div>
                      <h3>{game.title}</h3>
                      <p>{system?.label || 'Unknown system'}</p>
                      <small>{game.variantCount > 1 ? `${game.variantCount} versions available` : 'Ready to play'}</small>
                      <button type="button" onClick={() => launchGame(game)} disabled={launchingId === game.id}>
                        {launchingId === game.id ? 'Starting...' : 'Play'}
                      </button>
                    </article>
                  );
                })}
                {canShowMoreGames ? <div className="library-scroll-status">More games load as you scroll</div> : null}
              </div>
            ) : (
              <div className="empty-local-library">
                <strong>{games.length ? 'No games match that filter' : 'No local library yet'}</strong>
                <span>
                  {games.length
                    ? 'Try another system or search term.'
                    : activeSystemDetails
                      ? `Open a ${activeSystemDetails.label} room and upload one game, or add a folder when you are ready.`
                      : 'Pick a system to open a room, or add folders when you are ready.'}
                </span>
                {activeSystemDetails ? (
                  <button
                    type="button"
                    onClick={() => launchSystemRoom(activeSystemDetails)}
                    disabled={launchingSystemId === activeSystemDetails.id}
                  >
                    {launchingSystemId === activeSystemDetails.id ? 'Opening...' : `Open ${activeSystemDetails.label} room`}
                  </button>
                ) : null}
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
