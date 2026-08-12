import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { unzipSync, zipSync } from 'fflate';
import { API_BASE_URL, apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';
import RoomChat from '../components/RoomChat';
import SocialSidebar from '../components/SocialSidebar';
import { getLocalLibraryFolder, getLocalLibraryGame, getLocalLibraryGames } from '../localLibraryDb';
import { registerRuntimeRelease, takeRuntimeRelease } from '../features/localLibrary/storage/runtimeFileRegistry';
import { normaliseFilename } from '../features/localLibrary/core/normalise';
import { scanFiles as scanLocalReleaseFiles } from '../features/localLibrary/core/scanner';
import { groupGames as groupLocalReleaseFiles } from '../features/localLibrary/core/group';
import { resolveRelease } from '../features/localLibrary/storage/preferredReleaseStorage';
import {
  extractPrepared7zFile,
  takePreparedTournamentMameFile,
  takePreparedVipAmigaFile,
  takePreparedVipAmstradFile,
  takePreparedVipC64File,
  takePreparedVipMameFile,
  takePreparedVipMastersystemFile,
  takePreparedVipMegadriveFile,
  takePreparedVipNesFile,
  takePreparedVipPcengineFile,
  takePreparedVipSpectrumFile,
} from '../vipMameCache';
import useSignaling from '../hooks/useSignaling';
import { buildRtcConfig, waitForIceGatheringComplete } from '../utils/webrtc';
import amstradControlProfiles from '../data/amstradControlProfiles.json';
import { getMameTitleDatabase } from '../data/mameTitleLookup';
import ControllerSetupWizardAutomatic from '../components/ControllerSetupWizardAutomatic';
import { getControllerMapping } from '../utils/controllerMappingStorage';
import { applyCustomMapping } from '../utils/applyControllerMapping';
import { supportsControllerMapping } from '../utils/defaultControllerMappings';

const KICKSTART_DB_NAME = 'oldstylegaming-kickstarts';
const KICKSTART_STORE_NAME = 'roms';
const AMIGA_KICKSTART_KEY = 'amiga-a500-kickstart';
const AMIGA_AGA_KICKSTART_KEY = 'amiga-aga-a1200-kickstart';
const PLAYSTATION_BIOS_KEY = 'playstation-bios';
const SATURN_BIOS_KEY = 'saturn-bios';
const ATARI_ST_TOS_KEY = 'atari-st-tos';
const X68000_FIRMWARE_KEY = 'x68000-firmware';
const CONTROL_MATCH_LIMIT = 6;
const HOST_VOLUME_STORAGE_KEY = 'host-emulator-volume';
const PREFERRED_LIBRARY_VARIANTS_KEY = 'localLibraryPreferredVariants';
const BUILTIN_MAME_LEADERBOARD_ROMS = new Set([
  'dkong',
]);
const mame2003PlusTitles = getMameTitleDatabase();

function amigaRoomGameTitle(game) {
  const fileName = String(game.fileName || game.title || '');
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const withoutVersion = baseName.replace(
    /(?:[_\s-]+v\d+(?:\.\d+)*(?:[a-z])?)(?:[_\s-].*)?$/i,
    '',
  );
  return normaliseFilename(withoutVersion || baseName).cleanedTitle || game.title || baseName;
}

function amigaRoomGameVersion(game) {
  return String(game.fileName || '').match(
    /(?:^|[_\s-])v(\d+(?:\.\d+)*(?:[a-z])?)(?:[_\s-]|$)/i,
  )?.[1] || '';
}

function groupAmigaRoomGames(games) {
  let preferredVariants = {};
  try {
    preferredVariants = JSON.parse(localStorage.getItem(PREFERRED_LIBRARY_VARIANTS_KEY)) || {};
  } catch {
    preferredVariants = {};
  }

  const groups = new Map();
  games.forEach((game) => {
    const title = amigaRoomGameTitle(game);
    const key = title.toLocaleLowerCase();
    groups.set(key, [...(groups.get(key) || []), game]);
  });

  return [...groups.values()].map((variants) => {
    const sorted = variants.slice().sort((left, right) => {
      const leftVersion = amigaRoomGameVersion(left);
      const rightVersion = amigaRoomGameVersion(right);
      if (leftVersion && rightVersion && leftVersion !== rightVersion) {
        return rightVersion.localeCompare(leftVersion, undefined, { numeric: true, sensitivity: 'base' });
      }
      return String(left.fileName || '').localeCompare(String(right.fileName || ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });
    const defaultGame = sorted[0];
    const selected = sorted.find((game) => game.id === preferredVariants[defaultGame.id]) || defaultGame;
    return {
      ...selected,
      title: amigaRoomGameTitle(defaultGame),
      variants: sorted,
      variantCount: sorted.length,
    };
  });
}
const ROOM_SYSTEM_OPTIONS = [
  ['cpc', 'Amstrad CPC'],
  ['cpc_party', 'Amstrad CPC Party'],
  ['spectrum', 'ZX Spectrum'],
  ['c64', 'Commodore 64'],
  ['atarist', 'Atari ST'],
  ['amiga', 'Amiga'],
  ['amiga_link', 'Amiga Link Play'],
  ['amiga_aga', 'Amiga AGA'],
  ['mastersystem', 'Sega Master System'],
  ['megadrive', 'Mega Drive'],
  ['nes', 'NES'],
  ['snes', 'SNES'],
  ['pcengine', 'PC Engine / TurboGrafx-16'],
  ['x68000', 'Sharp X68000'],
  ['playstation', 'Sony PlayStation'],
  ['arcade', 'MAME Arcade'],
];

function buildX68000FirmwarePayload(fileName, archiveBytes) {
  const archive = unzipSync(new Uint8Array(archiveBytes));
  const supportedNames = new Set(['iplrom.dat', 'cgrom.dat', 'iplrom30.dat', 'iplromco.dat', 'iplromxv.dat']);
  const files = [];

  Object.entries(archive).forEach(([name, bytes]) => {
    const baseName = name.split(/[\\/]/).pop()?.toLowerCase();
    if (baseName && supportedNames.has(baseName)) {
      files.push({ fileName: `keropi/${baseName}`, bytes });
    }
  });

  if (!files.some((file) => file.fileName === 'keropi/iplrom.dat')
      || !files.some((file) => file.fileName === 'keropi/cgrom.dat')) {
    throw new Error('X68000 firmware must contain iplrom.dat and cgrom.dat');
  }

  return { type: 'x68000_firmware', fileName, bytes: new Uint8Array(archiveBytes), files };
}

function getSafeLibraryReturnPath(value) {
  if (!value) return '/library';

  try {
    const url = new URL(value, window.location.origin);
    if (url.origin === window.location.origin && url.pathname === '/library') {
      return `${url.pathname}${url.search}`;
    }
    if (url.origin === window.location.origin && /^\/tournaments\/[A-Z0-9]+$/i.test(url.pathname)) {
      return url.pathname;
    }
  } catch {
    if (value === '/library' || value.startsWith('/library?')) {
      return value;
    }
    if (/^\/tournaments\/[A-Z0-9]+$/i.test(value)) return value;
  }

  return '/library';
}

const CONTROL_ACTION_LABELS = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  upLeft: 'Up left',
  upRight: 'Up right',
  downLeft: 'Down left',
  downRight: 'Down right',
  fire1: 'Fire 1',
  fire2: 'Fire 2',
  pause: 'Pause',
  start: 'Start',
  quit: 'Quit',
};

const CONTROL_DIRECTIONS = [
  ['upLeft', 'Up left'],
  ['up', 'Up'],
  ['upRight', 'Up right'],
  ['left', 'Left'],
  ['fire1', 'Fire'],
  ['right', 'Right'],
  ['downLeft', 'Down left'],
  ['down', 'Down'],
  ['downRight', 'Down right'],
];

const CONTROL_UTILITY_ACTIONS = ['fire2', 'pause', 'start', 'quit'];
const ATARI8_ZIP_EXTENSIONS = ['.atr', '.xfd', '.atx', '.xex', '.com', '.car', '.rom', '.bin', '.cas'];
const ATARI8_ZIP_EXTENSION_PRIORITY = ['.xex', '.com', '.car', '.rom', '.bin', '.atr', '.xfd', '.atx', '.cas'];
const SNES_ZIP_EXTENSIONS = ['.sfc', '.smc', '.fig', '.swc', '.bsx', '.gd3', '.gd7', '.dx2'];
const SNES_UNWANTED_ENTRY_PATTERNS = [
  /\[t[+-][^\]]*\]/i,
  /\[h[^\]]*\]/i,
  /\[b[^\]]*\]/i,
  /\[o[^\]]*\]/i,
  /\[a[^\]]*\]/i,
  /\[p[^\]]*\]/i,
  /\[f[^\]]*\]/i,
  /\b(trainer|trained|translation|translated|hack|bad|overdump|alternate|prototype|proto|beta|sample|demo)\b/i,
];
const ROM_ZIP_EXTENSIONS = {
  cpc: ['.dsk'],
  cpc_party: ['.dsk'],
  spectrum: ['.tap', '.tzx', '.z80', '.sna', '.szx'],
  amiga: ['.lha', '.slave', '.hdf', '.adf', '.adz', '.dms', '.ipf'],
  amiga_aga: ['.lha', '.slave', '.hdf', '.adf', '.adz', '.dms', '.ipf'],
  c64: ['.d64', '.g64', '.f64', '.t64', '.p00', '.p01', '.tap', '.prg', '.crt'],
  mastersystem: ['.sms'],
  megadrive: ['.bin', '.gen', '.md', '.smd'],
  nes: ['.nes'],
  snes: ['.sfc', '.smc', '.fig', '.swc', '.bsx', '.gd3', '.gd7', '.dx2'],
  pcengine: ['.pce', '.sgx'],
  x68000: ['.dim', '.img', '.d88', '.88d', '.hdm', '.dup', '.2hd', '.xdf', '.hdf', '.cmd', '.m3u'],
  playstation: ['.cue', '.bin', '.chd', '.pbp', '.iso'],
  saturn: ['.cue', '.bin', '.chd', '.iso'],
  saturn_beetle: ['.cue', '.bin', '.chd', '.iso'],
};
const MULTI_FILE_ZIP_SYSTEMS = new Set(['amiga', 'amiga_aga', 'c64', 'x68000', 'playstation', 'saturn', 'saturn_beetle']);
const ATARI8_MODEL_OPTIONS = [
  ['400/800', '400/800'],
  ['1200xl', '1200XL'],
  ['xl/xe', 'XL/XE'],
  ['xegs', 'XEGS'],
];
const ATARI8_RAM_OPTIONS = {
  '400/800': [16, 48],
  '1200xl': [16, 64, 128, 192, 320, 576, 1088],
  'xl/xe': [16, 64, 128, 192, 320, 576, 1088],
  xegs: [16, 64, 128, 192, 320, 576, 1088],
};
const DEFAULT_ATARI8_CONFIG = {
  model: 'xl/xe',
  memory: 320,
  basicDisabled: true,
  tv: 'pal',
  separateAnticAccess: false,
  os: 'atarixx',
};
const ATARI8_OS_OPTIONS = [
  ['atarixx', 'Atari++'],
  ['altirra', 'Altirra'],
];
const ATARI8_ROOM_VERSION = '2026-07-02-4';
const ATARI8_AUTO_PROFILES = [
  {
    pattern: /(^|[^a-z0-9])yoomp([^a-z0-9]|$)/i,
    label: 'Yoomp high-RAM PAL Atari++ profile',
    config: { ...DEFAULT_ATARI8_CONFIG, os: 'atarixx' },
  },
];

function normalizeAtari8Config(config) {
  const model = ATARI8_RAM_OPTIONS[config.model] ? config.model : DEFAULT_ATARI8_CONFIG.model;
  const ramOptions = ATARI8_RAM_OPTIONS[model];
  const memory = ramOptions.includes(Number(config.memory))
    ? Number(config.memory)
    : model === '400/800' ? 48 : 64;

  return {
    model,
    memory,
    basicDisabled: Boolean(config.basicDisabled),
    tv: config.tv === 'pal' ? 'pal' : 'ntsc',
    separateAnticAccess: memory > 64 && Boolean(config.separateAnticAccess),
    os: config.os === 'altirra' ? 'altirra' : 'atarixx',
  };
}

function buildAtari8EmulatorSrc(config) {
  const normalizedConfig = normalizeAtari8Config(config);
  const params = new URLSearchParams({
    v: ATARI8_ROOM_VERSION,
    model: normalizedConfig.model,
    memory: String(normalizedConfig.memory),
    basic: normalizedConfig.basicDisabled ? 'off' : 'on',
    tv: normalizedConfig.tv,
    antic: normalizedConfig.separateAnticAccess ? '1' : '0',
    os: normalizedConfig.os,
  });
  return `/atari8/?${params.toString()}`;
}

function findAtari8AutoProfile(fileNames) {
  const joinedNames = fileNames.filter(Boolean).join(' ');
  return ATARI8_AUTO_PROFILES.find((profile) => profile.pattern.test(joinedNames)) || null;
}

function normaliseSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(side|disk|disc|tape|part|set)\s*[a-z0-9]+\b/g, ' ')
    .replace(/\b(europe|uk|usa|france|germany|spain|italy|amstrad|cpc|dsk|cracked|crack|trainer|budget|re-release)\b/g, ' ')
    .replace(/\b(the|of|and|a|an)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function searchTokens(value) {
  return normaliseSearchText(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

function tokenSimilarity(leftTokens, rightTokens) {
  if (!leftTokens.length || !rightTokens.length) return 0;

  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  const shared = Array.from(left).filter((token) => right.has(token)).length;
  const coverage = shared / Math.max(left.size, right.size);
  const precision = shared / Math.min(left.size, right.size);

  return Math.round((coverage * 70) + (precision * 30));
}

function scoreControlProfile(fileName, profile) {
  const queryText = normaliseSearchText(fileName);
  const queryTokens = searchTokens(fileName);
  const candidates = [profile.gameSlug, profile.title, profile.source?.manualFile];

  return Math.max(...candidates.map((candidate) => {
    const candidateText = normaliseSearchText(candidate);
    const candidateTokens = searchTokens(candidate);
    let score = tokenSimilarity(queryTokens, candidateTokens);

    if (candidateText && queryText === candidateText) {
      score = Math.max(score, 120);
    } else if (candidateText && (queryText.includes(candidateText) || candidateText.includes(queryText))) {
      score = Math.max(score, 96);
    }

    return score;
  }));
}

function findControlProfileMatches(fileName) {
  if (!fileName) return [];

  return amstradControlProfiles
    .map((profile) => ({
      profile,
      score: scoreControlProfile(fileName, profile),
    }))
    .filter((match) => match.score >= 45)
    .sort((left, right) => right.score - left.score || left.profile.title.localeCompare(right.profile.title))
    .slice(0, CONTROL_MATCH_LIMIT);
}

function shouldAutoSelectControlMatch(matches) {
  if (!matches.length) return false;

  const [best, next] = matches;
  return best.score >= 110 || (best.score >= 92 && (!next || best.score - next.score >= 12));
}

function cpcDiskText(bytes, offset, length) {
  let text = '';
  for (let index = 0; index < length && offset + index < bytes.length; index += 1) {
    const value = bytes[offset + index] & 0x7f;
    if (value >= 32 && value <= 126) {
      text += String.fromCharCode(value);
    }
  }
  return text.trim();
}

function getCpcDskTrackLayout(bytes) {
  const header = cpcDiskText(bytes, 0, 48);
  const extended = header.includes('EXTENDED CPC DSK');
  if (!header.includes('CPC') || !header.includes('Disk')) return null;

  const tracks = bytes[0x30] || 0;
  const sides = bytes[0x31] || 1;
  const count = Math.max(0, tracks * sides);
  if (!count) return null;

  const sizes = [];
  if (extended) {
    for (let index = 0; index < count; index += 1) {
      sizes.push((bytes[0x34 + index] || 0) * 256);
    }
  } else {
    const size = bytes[0x32] | ((bytes[0x33] || 0) << 8);
    for (let index = 0; index < count; index += 1) {
      sizes.push(size);
    }
  }

  return { sizes };
}

function extractCpcDskCatalog(bytes) {
  const layout = getCpcDskTrackLayout(bytes);
  if (!layout) return [];

  const entries = [];
  const seen = new Set();
  let trackOffset = 256;

  // The CP/M directory lives on the first track. Later tracks can reuse the
  // same sector IDs for game data and must not be treated as catalogue rows.
  layout.sizes.slice(0, 1).forEach((trackSize) => {
    if (!trackSize || trackOffset + 256 > bytes.length) {
      trackOffset += trackSize || 0;
      return;
    }

    const trackHeader = cpcDiskText(bytes, trackOffset, 32);
    if (!trackHeader.includes('Track-Info')) {
      trackOffset += trackSize;
      return;
    }

    const sectorCount = bytes[trackOffset + 0x15] || 0;
    let dataOffset = trackOffset + 0x100;

    for (let sector = 0; sector < sectorCount; sector += 1) {
      const entryOffset = trackOffset + 0x18 + sector * 8;
      const sectorId = bytes[entryOffset + 2];
      const sectorLength = (
        bytes[entryOffset + 6] | ((bytes[entryOffset + 7] || 0) << 8)
      ) || (128 << (bytes[entryOffset + 3] || 2));

      if (sectorId >= 0xc1 && sectorId <= 0xc4) {
        const end = Math.min(dataOffset + sectorLength, bytes.length);
        for (let offset = dataOffset; offset + 32 <= end; offset += 32) {
          const user = bytes[offset];
          if (user > 15) continue;

          const base = cpcDiskText(bytes, offset + 1, 8).replace(/\s+/g, '').trim();
          const ext = cpcDiskText(bytes, offset + 9, 3).replace(/\s+/g, '').trim().toUpperCase();
          // CPC loaders are often deliberately extensionless (for example
          // HARVEY); rejecting them makes us autorun HARVEY1.BIN data instead.
          if (!base) continue;

          const key = `${base}.${ext}`.toUpperCase();
          if (seen.has(key)) continue;
          seen.add(key);
          entries.push({ base, ext, name: key });
        }
      }

      dataOffset += sectorLength;
    }

    trackOffset += trackSize;
  });

  return entries;
}

function pickCpcAutoloadEntry(entries, fileName) {
  if (!entries.length) return null;

  const basEntries = entries.filter((entry) => entry.ext === 'BAS');
  if (basEntries.length === 1) return basEntries[0];

  const runnable = entries.filter((entry) => !entry.ext || ['BAS', 'BIN'].includes(entry.ext));
  const candidates = runnable.length ? runnable : entries;
  const diskTokens = searchTokens(fileName);
  const loaderWords = /\b(loader|load|menu|disc|disk|start|boot|run|intro)\b/i;
  const badWords = /\b(screen|title|pic|font|charset|chars|data|table|music|sound|score|scores|hiscore|hi|readme|doc)\b/i;

  const ranked = candidates
    .map((entry) => {
      const baseTokens = searchTokens(entry.base);
      let score = tokenSimilarity(baseTokens, diskTokens) * 4;

      if (!entry.ext) score += 35;
      if (entry.ext === 'BAS') score += 30;
      if (loaderWords.test(entry.base)) score += 20;
      if (badWords.test(entry.base)) score -= 40;

      return { entry, score };
    })
    .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name));

  return ranked[0]?.entry || null;
}

function detectCpcAutoloadCommand(bytes, fileName) {
  const entry = pickCpcAutoloadEntry(extractCpcDskCatalog(bytes), fileName);
  return entry ? `RUN"${entry.base}` : null;
}

function atari8ZipEntryPriority(entryName) {
  const lowerName = entryName.toLowerCase();
  const index = ATARI8_ZIP_EXTENSION_PRIORITY.findIndex((extension) => lowerName.endsWith(extension));
  return index === -1 ? ATARI8_ZIP_EXTENSION_PRIORITY.length : index;
}

function formatControlAction(action) {
  return CONTROL_ACTION_LABELS[action] || action.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
}

function formatControlValue(value) {
  return String(value || '')
    .replace(/CURSOR_/g, '')
    .replace(/_/g, ' ')
    .trim();
}

function openKickstartDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = window.indexedDB.open(KICKSTART_DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(KICKSTART_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open Kickstart storage'));
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Kickstart storage request failed'));
  });
}

function roomSystemLabel(system) {
  return ROOM_SYSTEM_OPTIONS.find(([value]) => value === system)?.[1] || 'Amstrad CPC';
}

async function expandAtari8ZipFile(file) {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const entries = Object.entries(archive)
    .filter(([entryName]) => {
      const lowerName = entryName.toLowerCase();
      return !lowerName.endsWith('/') && ATARI8_ZIP_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
    })
    .sort(([leftName], [rightName]) => {
      const leftPriority = atari8ZipEntryPriority(leftName);
      const rightPriority = atari8ZipEntryPriority(rightName);
      return leftPriority - rightPriority || leftName.localeCompare(rightName, undefined, { numeric: true, sensitivity: 'base' });
    });

  if (!entries.length) {
    throw new Error('Atari 8-bit zip files need to contain an .atr, .xex, .car, .rom, .bin, or .cas file');
  }

  const [entryName, bytes] = entries[0];
  const fileName = entryName.split(/[\\/]/).pop() || entryName;
  return { fileName, bytes };
}

function scoreSnesZipEntry(entryName) {
  const fileName = entryName.split(/[\\/]/).pop() || entryName;
  const lowerName = fileName.toLowerCase();
  let score = 0;

  if (lowerName.endsWith('.sfc')) score += 8;
  if (lowerName.endsWith('.smc')) score += 6;
  if (/\((usa|u|world|europe|eur|e)\)/i.test(fileName)) score += 24;
  if (/\((japan|j)\)/i.test(fileName)) score -= 8;
  if (/\[!\]/i.test(fileName)) score += 8;
  if (!/\[[^\]]+\]/.test(fileName)) score += 35;

  for (const pattern of SNES_UNWANTED_ENTRY_PATTERNS) {
    if (pattern.test(fileName)) score -= 60;
  }

  score -= entryName.split(/[\\/]/).length;
  return score;
}

async function expandSnesZipFile(file) {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const entries = Object.entries(archive)
    .filter(([entryName]) => {
      const lowerName = entryName.toLowerCase();
      return !lowerName.endsWith('/') && SNES_ZIP_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
    })
    .sort(([leftName], [rightName]) => (
      scoreSnesZipEntry(rightName) - scoreSnesZipEntry(leftName)
      || leftName.localeCompare(rightName, undefined, { numeric: true, sensitivity: 'base' })
    ));

  if (!entries.length) {
    throw new Error('SNES zip files need to contain a .sfc, .smc, .fig, .swc, .bsx, .gd3, .gd7, or .dx2 ROM file');
  }

  const [entryName, bytes] = entries[0];
  const fileName = entryName.split(/[\\/]/).pop() || entryName;
  return { fileName, bytes, archiveEntryName: entryName };
}

async function expandRomZipFile(file, system) {
  const supportedExtensions = ROM_ZIP_EXTENSIONS[system];
  if (!supportedExtensions) {
    throw new Error(`${roomSystemLabel(system)} zip files are not supported`);
  }

  let archive;
  try {
    archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    throw new Error(`Could not unzip ${file.name}: ${error.message}`);
  }

  const isAmigaSystem = system === 'amiga' || system === 'amiga_aga';
  const archiveFiles = Object.entries(archive).filter(([entryName]) => {
    const normalized = entryName.replace(/\\/g, '/');
    return !normalized.endsWith('/')
      && !normalized.split('/').some((part) => part === '..' || part.toLowerCase() === '__macosx');
  });
  const whdLoadSlave = isAmigaSystem
    ? archiveFiles.find(([entryName]) => entryName.toLowerCase().endsWith('.slave'))
    : null;
  if (whdLoadSlave) {
    return archiveFiles
      .sort(([leftName], [rightName]) => (
        Number(!leftName.toLowerCase().endsWith('.slave')) - Number(!rightName.toLowerCase().endsWith('.slave'))
        || leftName.localeCompare(rightName, undefined, { numeric: true, sensitivity: 'base' })
      ))
      .map(([entryName, bytes]) => ({
        fileName: entryName.split(/[\\/]/).pop() || entryName,
        bytes,
        archiveEntryName: entryName.replace(/\\/g, '/').replace(/^\/+/, ''),
        whdLoadArchive: true,
      }));
  }

  const entries = archiveFiles
    .filter(([entryName]) => {
      const lowerName = entryName.toLowerCase();
      return !lowerName.endsWith('/')
        && !lowerName.split(/[\\/]/).some((part) => part === '__macosx')
        && supportedExtensions.some((extension) => lowerName.endsWith(extension));
    })
    .sort(([leftName], [rightName]) => {
      const leftLower = leftName.toLowerCase();
      const rightLower = rightName.toLowerCase();
      const leftPriority = supportedExtensions.findIndex((extension) => leftLower.endsWith(extension));
      const rightPriority = supportedExtensions.findIndex((extension) => rightLower.endsWith(extension));
      return leftPriority - rightPriority
        || leftName.localeCompare(rightName, undefined, { numeric: true, sensitivity: 'base' });
    });

  if (!entries.length) {
    throw new Error(
      `${roomSystemLabel(system)} zip files need to contain ${supportedExtensions.join(', ')} ROM files`,
    );
  }

  const selectedEntries = MULTI_FILE_ZIP_SYSTEMS.has(system) ? entries : entries.slice(0, 1);
  return selectedEntries.map(([entryName, bytes]) => ({
    fileName: entryName.split(/[\\/]/).pop() || entryName,
    bytes,
    archiveEntryName: entryName,
  }));
}

function clearAtari8SessionStorage() {
  try {
    const keys = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith('a8.')) {
        keys.push(key);
      }
    }
    keys.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // Run without storage access if the browser blocks it.
  }
}

function buildAmigaKickstartPayload(system, fileName, bytes) {
  if (system !== 'amiga_link') {
    return {
      type: 'amiga_kickstart',
      fileName,
      bytes,
    };
  }

  return {
    type: 'amiga_kickstart',
    fileName,
    bytes,
    kickstart_rom: bytes,
  };
}

async function saveStoredKickstart(key, fileName, bytes) {
  const db = await openKickstartDb();

  try {
    const transaction = db.transaction(KICKSTART_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(KICKSTART_STORE_NAME);
    await requestToPromise(store.put({ fileName, bytes }, key));
  } finally {
    db.close();
  }
}

async function loadStoredKickstart(key) {
  const db = await openKickstartDb();

  try {
    const transaction = db.transaction(KICKSTART_STORE_NAME, 'readonly');
    const store = transaction.objectStore(KICKSTART_STORE_NAME);
    const stored = await requestToPromise(store.get(key));

    if (!stored?.fileName || !stored?.bytes) return null;

    return {
      fileName: stored.fileName,
      bytes: new Uint8Array(stored.bytes),
    };
  } finally {
    db.close();
  }
}

export default function RoomPage() {
  const navigate = useNavigate();
  const { roomCode } = useParams();
  const [searchParams] = useSearchParams();
  const username = localStorage.getItem('username');
  const isSuperAdmin = localStorage.getItem('isSuperAdmin') === 'true';
  const hasVipAccess = localStorage.getItem('isVip') === 'true'
    || localStorage.getItem('isAdmin') === 'true'
    || isSuperAdmin;
  const legacySoloMode = searchParams.get('mode') === 'solo';
  const localGameId = searchParams.get('localGame');
  const localReleaseId = searchParams.get('localRelease');
  const tournamentCode = searchParams.get('tournament')?.toUpperCase() || '';
  const libraryReturnPath = getSafeLibraryReturnPath(searchParams.get('returnTo'));
  const [obsCaptureMode, setObsCaptureMode] = useState(false);

  useEffect(() => {
    document.title = obsCaptureMode ? 'Old Style Gaming - OBS Game Window' : 'Old Style Gaming - Game Capture';

    return () => {
      document.title = 'Old Style Gaming';
    };
  }, [obsCaptureMode]);

  const [room, setRoom] = useState(null);
  const [status, setStatus] = useState('Loading room...');
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [hostStarted, setHostStarted] = useState(false);
  const [guestPrepared, setGuestPrepared] = useState(false);
  const [loadedDiskName, setLoadedDiskName] = useState('');
  const [arcadeRomFolderName, setArcadeRomFolderName] = useState('');
  const [arcadeRomEntries, setArcadeRomEntries] = useState([]);
  const [arcadeSampleCount, setArcadeSampleCount] = useState(0);
  const [arcadeRomSearch, setArcadeRomSearch] = useState('');
  const [showArcadeCloneRoms, setShowArcadeCloneRoms] = useState(false);
  const [arcadeRomScanning, setArcadeRomScanning] = useState(false);
  const [loadedAgaDiskCount, setLoadedAgaDiskCount] = useState(0);
  const [currentAgaDiskIndex, setCurrentAgaDiskIndex] = useState(0);
  const [localReleaseFiles, setLocalReleaseFiles] = useState([]);
  const [currentLocalReleaseIndex, setCurrentLocalReleaseIndex] = useState(0);
  const [kickstartRomName, setKickstartRomName] = useState('');
  const [x68000FirmwareName, setX68000FirmwareName] = useState('');
  const [vipKickstartBusy, setVipKickstartBusy] = useState(false);
  const [playstationBiosName, setPlaystationBiosName] = useState('');
  const [inputCaptured, setInputCaptured] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isScreenFullscreen, setIsScreenFullscreen] = useState(false);
  const [roomCodeCopied, setRoomCodeCopied] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [soloInviteRoom, setSoloInviteRoom] = useState(null);
  const [soloInviteBusy, setSoloInviteBusy] = useState(false);
  const [localGamePickerOpen, setLocalGamePickerOpen] = useState(false);
  const [localGameSearch, setLocalGameSearch] = useState('');
  const [localRoomGames, setLocalRoomGames] = useState([]);
  const [localGameReloadToken, setLocalGameReloadToken] = useState(0);
  const [emulatorFrameLoadCount, setEmulatorFrameLoadCount] = useState(0);
  const [roomSessionKey, setRoomSessionKey] = useState(0);
  const [emulatorSessionKey, setEmulatorSessionKey] = useState(0);
  const [selectedRoomSystem, setSelectedRoomSystem] = useState('cpc');
  const [switchingSystem, setSwitchingSystem] = useState(false);
  const [inputDebug, setInputDebug] = useState({
    mask: 0,
    source: 'none',
    events: [],
  });
  const [hostDisplayName, setHostDisplayName] = useState('');
  const [guestDisplayName, setGuestDisplayName] = useState('');
  const [activePartyPlayer, setActivePartyPlayer] = useState(1);
  const [partyPlayerNumber, setPartyPlayerNumber] = useState(null);
  const [partyRoster, setPartyRoster] = useState([]);
  const [arcadeQueueStatus, setArcadeQueueStatus] = useState({
    queued: false,
    queuePosition: null,
    role: 'Spectator',
  });
  const [mameLeaderboard, setMameLeaderboard] = useState([]);
  const [mameLeaderboardSupported, setMameLeaderboardSupported] = useState(false);
  const [tournamentTitle, setTournamentTitle] = useState('');
  const [mameScoreStatus, setMameScoreStatus] = useState('');
  const [mameScoreBusy, setMameScoreBusy] = useState(false);
  const [mameScoreChangeToken, setMameScoreChangeToken] = useState(0);
  const [amigaLeaderboard, setAmigaLeaderboard] = useState([]);
  const [amigaScoreStatus, setAmigaScoreStatus] = useState('');
  const [amigaScoreBusy, setAmigaScoreBusy] = useState(false);
  const [amigaScoreGame, setAmigaScoreGame] = useState(null);
  const [remotePlaybackBlocked, setRemotePlaybackBlocked] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [serialActivity, setSerialActivity] = useState({ sent: 0, received: 0 });

  useEffect(() => {
    if (!tournamentCode) {
      setTournamentTitle('');
      return undefined;
    }

    try {
      const pendingGame = JSON.parse(sessionStorage.getItem('oldstylegaming:pendingLocalGame') || 'null');
      if (pendingGame?.tournamentCode === tournamentCode && pendingGame.tournamentName) {
        setTournamentTitle(pendingGame.tournamentName);
      }
    } catch {
      // The API lookup below remains the authoritative fallback.
    }

    let cancelled = false;
    apiFetch(`/auth/tournaments/${encodeURIComponent(tournamentCode)}`)
      .then((details) => {
        if (!cancelled) setTournamentTitle(details?.name || tournamentCode);
      })
      .catch(() => {
        if (!cancelled) setTournamentTitle((current) => current || tournamentCode);
      });
    return () => { cancelled = true; };
  }, [tournamentCode]);

  const remoteMediaStreamRef = useRef(null);
  const remoteVoiceStreamRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteVoiceAudioRef = useRef(null);
  const emulatorFrameRef = useRef(null);
  const mirrorCanvasRef = useRef(null);
  const mirrorLoopRef = useRef(null);
  const mirrorKeepaliveTimerRef = useRef(null);
  const mirrorCaptureTrackRef = useRef(null);
  const fileInputRef = useRef(null);
  const swapDiskInputRef = useRef(null);
  const kickstartInputRef = useRef(null);
  const x68000FirmwareInputRef = useRef(null);
  const atariTosInputRef = useRef(null);
  const playstationBiosInputRef = useRef(null);
  const pcRef = useRef(null);
  const dataChannelRef = useRef(null);
  const serialChannelRef = useRef(null);
  const serialOfferStartedRef = useRef(false);
  const handleGuestPayloadOnHostRef = useRef(null);
  const localOfferRef = useRef(null);
  const hostVideoStreamRef = useRef(null);
  const hostAudioStreamRef = useRef(null);
  const hostRawAudioStreamRef = useRef(null);
  const hostAudioGraphRef = useRef(null);
  const hostVolumeRef = useRef(1);
  const emulatorPausedRef = useRef(false);
  const partyHostPeersRef = useRef(new Map());
  const pendingPartyGuestsRef = useRef(new Map());
  const hostStartingRef = useRef(false);
  const hostStartedRef = useRef(false);
  const localLibraryLoadAttemptedRef = useRef(false);
  const loadedDiskNameRef = useRef('');
  const mameScoreBaselineRef = useRef(null);
  const tournamentScoreArmedAtRef = useRef(0);
  const mameScoreProcessedTokenRef = useRef(0);
  const amigaScoreBaselineRef = useRef(null);
  const guestPreparedRef = useRef(false);
  const gamepadIndexRef = useRef(null);
  const [controllerSetupOpen, setControllerSetupOpen] = useState(false);
  const [controllerCapturingInput, setControllerCapturingInput] = useState(false);
  const inputSessionIdRef = useRef(`${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const inputSequenceRef = useRef(0);
  const localJoystickMaskRef = useRef(0);
  const localMicStreamRef = useRef(null);
  const localMicSenderRef = useRef(null);
  const micRenegotiationNeededRef = useRef(false);
  const lastRemoteInputSessionRef = useRef('');
  const lastRemoteInputSeqRef = useRef(0);
  const lastRemoteInputAtRef = useRef(0);
  const remoteJoystickMaskRef = useRef(0);
  const pendingIceCandidatesRef = useRef([]);
  const isHostRef = useRef(false);
  const signalingClientIdRef = useRef(window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const activeGuestSignalIdRef = useRef('');
  const activePeerSignalIdRef = useRef('');
  const sentStoredKickstartFrameRef = useRef(0);
  const savedSystemMediaRef = useRef(new Map());
  const arcadeSampleHandlesRef = useRef(new Map());
  const [micEnabled, setMicEnabled] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [micStatus, setMicStatus] = useState('Mic off');
  const [micDevices, setMicDevices] = useState([]);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState('');
  const [hostVolume, setHostVolume] = useState(() => {
    const storedVolume = Number(window.localStorage?.getItem(HOST_VOLUME_STORAGE_KEY));
    return Number.isFinite(storedVolume) ? Math.min(1, Math.max(0, storedVolume)) : 1;
  });
  const [emulatorPaused, setEmulatorPaused] = useState(false);
  const [c64WarpEnabled, setC64WarpEnabled] = useState(false);
  const [c64JoystickPortsSwapped, setC64JoystickPortsSwapped] = useState(false);
  const [c64MediaCount, setC64MediaCount] = useState(0);
  const [c64MediaIndex, setC64MediaIndex] = useState(0);
  const [atari8Config, setAtari8Config] = useState(DEFAULT_ATARI8_CONFIG);
  const [atariTosName, setAtariTosName] = useState('');
  const [atariStMediaCount, setAtariStMediaCount] = useState(0);
  const [atariStMediaIndex, setAtariStMediaIndex] = useState(0);
  const [controlProfileMatches, setControlProfileMatches] = useState([]);
  const [selectedControlProfile, setSelectedControlProfile] = useState(null);
  const [controlProfileDrawerOpen, setControlProfileDrawerOpen] = useState(false);

  const userId = useMemo(() => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return Number(payload.sub);
    } catch {
      return null;
    }
  }, []);

  const isHost = room ? room.owner_user_id === userId : null;
  const roomSystem = room?.system || 'cpc';
  const isCpcParty = roomSystem === 'cpc_party';
  const isCpcSystem = roomSystem === 'cpc' || roomSystem === 'cpc_party';
  const isSpectrum = roomSystem === 'spectrum';
  const isAmiga = roomSystem === 'amiga';
  const isAmigaLink = roomSystem === 'amiga_link';
  const isAmigaAga = roomSystem === 'amiga_aga';
  const isPuaeAmiga = isAmiga || isAmigaAga;
  const isAmigaFamily = isAmiga || isAmigaLink || isAmigaAga;
  const canControlLocalEmulator = isHost || isAmigaLink;
  const isMasterSystem = roomSystem === 'mastersystem';
  const isMegaDrive = roomSystem === 'megadrive';
  const isSegaConsole = isMasterSystem || isMegaDrive;
  const isNes = roomSystem === 'nes';
  const isSnes = roomSystem === 'snes';
  const isPcEngine = roomSystem === 'pcengine';
  const isX68000 = roomSystem === 'x68000';
  const isPlayStation = roomSystem === 'playstation';
  const isBeetleSaturn = roomSystem === 'saturn_beetle';
  const isSaturn = roomSystem === 'saturn' || isBeetleSaturn;
  const isDiscConsole = isPlayStation || isSaturn;
  const isC64 = roomSystem === 'c64';
  const isAtari8 = roomSystem === 'atari8';
  const isAtariSt = roomSystem === 'atarist';
  const isMouseComputer = isAmigaFamily || isAtariSt || isX68000;
  const isArcade = roomSystem === 'arcade';
  const isSoloMode = isArcade ? !Boolean(room?.arcade_multiplayer) : legacySoloMode;
  const supportsMameScoreboard = isArcade;
  const supportsAmigaScoreboard = isPuaeAmiga && Boolean(amigaScoreGame);
  const kickstartStorageKey = isAmiga || isAmigaLink ? AMIGA_KICKSTART_KEY : isAmigaAga ? AMIGA_AGA_KICKSTART_KEY : isPlayStation ? PLAYSTATION_BIOS_KEY : isAtariSt ? ATARI_ST_TOS_KEY : isX68000 ? X68000_FIRMWARE_KEY : '';
  const partyMaxPlayers = Math.min(20, Math.max(2, Number(room?.party_max_players) || 2));
  const arcadeControlSlots = 2;
  const isC64Party = isC64 && !isSoloMode && partyMaxPlayers > 2;
  const isArcadeParty = isArcade && !isSoloMode;
  const isSharedCpcParty = isCpcParty;
  const isMultiPeerParty = isSharedCpcParty || isC64Party || isArcadeParty;
  const currentPartyPlayerNumber = isHost ? 1 : partyPlayerNumber || 2;
  const canSendPlayerInput = isHost || !isArcadeParty || Boolean(partyPlayerNumber);
  const isDirectJoystickSystem = isAmigaFamily || isSegaConsole || isNes || isSnes || isPcEngine || isX68000 || isDiscConsole || isC64 || isAtari8 || isAtariSt || isArcade;
  const autoCaptureController = isArcade || isSegaConsole || isNes || isSnes || isPcEngine || isDiscConsole;
  const showFullscreenArcadeLeaderboard = isScreenFullscreen && supportsMameScoreboard && Boolean(loadedDiskName) && !remoteConnected;
  const systemLabel = isCpcParty ? 'Amstrad CPC Party' : isAmigaAga ? 'Amiga AGA' : isAmigaLink ? 'Amiga Link Play' : isAmiga ? 'Amiga' : isMasterSystem ? 'Sega Master System' : isMegaDrive ? 'Mega Drive' : isNes ? 'NES' : isSnes ? 'SNES' : isPcEngine ? 'PC Engine / TurboGrafx-16' : isX68000 ? 'Sharp X68000' : isPlayStation ? 'Sony PlayStation' : isBeetleSaturn ? 'Sega Saturn Webretro Core' : isSaturn ? 'Sega Saturn' : isC64 ? 'Commodore 64' : isAtari8 ? 'Atari 400/800 XL' : isAtariSt ? 'Atari ST' : isArcade ? 'MAME Arcade' : isSpectrum ? 'ZX Spectrum' : 'Amstrad CPC';

  useEffect(() => {
    setSelectedRoomSystem(roomSystem);
  }, [roomSystem]);

  const atari8RamOptions = ATARI8_RAM_OPTIONS[atari8Config.model] || ATARI8_RAM_OPTIONS[DEFAULT_ATARI8_CONFIG.model];
  const atari8EmulatorSrc = useMemo(() => {
    return buildAtari8EmulatorSrc(atari8Config);
  }, [atari8Config]);

  const emulatorSrc = isPuaeAmiga
    ? `/amiga-aga/launcher.html?model=${isAmigaAga ? 'A1200' : 'A500'}&v=2026-08-12-1`
    : isAmigaLink
    ? '/amiga/launcher.html?v=2026-07-07-1'
    : isSegaConsole ? `/megadrive/launcher.html?system=${isMasterSystem ? 'mastersystem' : 'megadrive'}&v=2026-07-18-1` : isNes ? '/nes/launcher.html?v=2026-07-07-1' : isSnes ? '/snes/launcher.html?v=2026-08-09-1' : isPcEngine ? '/pcengine/launcher.html?v=2026-08-04-1' : isX68000 ? '/x68000/launcher.html?v=2026-08-05-6' : isPlayStation ? '/playstation/launcher.html?v=2026-07-07-1' : isBeetleSaturn ? '/webretro-saturn/index.html?core=yabause&nobundle&noautorefocus&v=2026-07-29-2' : isSaturn ? '/saturn/launcher.html?v=2026-07-27-3' : isC64 ? '/c64/launcher.html?v=2026-07-31-5' : isAtari8 ? atari8EmulatorSrc : isAtariSt ? '/atarist/launcher.html?v=2026-07-07-1' : isArcade ? '/arcade/launcher.html?v=2026-08-03-3' : isSpectrum ? '/spectrum/index.html?v=2026-08-03-1' : isCpcSystem ? '/emulator-cpcbox/index.html?v=2026-07-07-1' : '/emulator/index.html?v=2026-06-01-1';
  const emulatorTitle = `${systemLabel} Emulator`;
  const acceptedMedia = isAmigaFamily
    ? '.adf,.adz,.dms,.ipf,.hdf,.lha,.zip,.7z'
    : isMasterSystem ? '.sms,.zip,.7z' : isMegaDrive ? '.bin,.gen,.md,.smd,.zip,.7z' : isNes ? '.nes,.zip,.7z' : isSnes ? '.sfc,.smc,.fig,.swc,.bsx,.gd3,.gd7,.dx2,.zip,.7z' : isPcEngine ? '.pce,.sgx,.zip,.7z' : isX68000 ? '.dim,.img,.d88,.88d,.hdm,.dup,.2hd,.xdf,.hdf,.cmd,.m3u,.zip' : isPlayStation ? '.cue,.bin,.chd,.pbp,.iso,.zip,.7z' : isSaturn ? '.cue,.bin,.chd,.iso,.zip,.7z' : isC64 ? '.d64,.t64,.tap,.prg,.crt,.zip,.7z' : isAtari8 ? '.atr,.xfd,.atx,.xex,.com,.car,.rom,.bin,.cas,.zip,.7z' : isAtariSt ? '.st,.msa,.stx,.ipf,.zip,.7z' : isArcade ? '.zip,.7z' : isSpectrum ? '.tap,.tzx,.z80,.sna,.szx,.zip,.7z' : '.dsk';
  const mediaLabel = isAmigaAga ? 'Load Amiga AGA file' : isAmiga || isAmigaLink ? 'Load Amiga file' : isMasterSystem ? 'Load Master System ROM' : isMegaDrive ? 'Load Mega Drive ROM' : isNes ? 'Load NES ROM' : isSnes ? 'Load SNES ROM' : isPcEngine ? loadedDiskName ? 'Change PC Engine game' : 'Load PC Engine ROM' : isX68000 ? loadedDiskName ? 'Change X68000 game' : 'Load X68000 game' : isPlayStation ? loadedDiskName ? 'Change PlayStation game' : 'Load PlayStation game' : isSaturn ? loadedDiskName ? 'Change Saturn game' : 'Load Saturn game' : isC64 ? 'Load C64 file' : isAtari8 ? loadedDiskName ? 'Change Atari 8-bit file' : 'Load Atari 8-bit file' : isAtariSt ? 'Load Atari ST disk' : isArcade ? 'Load MAME ROM' : isSpectrum ? 'Load Spectrum file' : 'Load .dsk';
  const controlLabel = !room
    ? 'Loading controls'
    : isSoloMode
      ? isAmigaFamily
        ? 'P1 Amiga controls + keyboard/mouse'
        : isMasterSystem ? 'P1 controller 1 / Button 1 / Button 2 / Pause' : isMegaDrive ? 'P1 controller 1 / A B C / Start' : isNes ? 'P1 controller 1 / A B / Start / Select' : isSnes ? 'P1 SNES pad / B Y A X / L R / Select / Start' : isPcEngine ? 'P1 controller 1 / I II / Run / Select' : isDiscConsole ? `P1 ${isSaturn ? 'Saturn' : 'PlayStation'} controller` : isC64 ? 'P1 C64 joystick + keyboard' : isAtari8 ? 'P1 Atari joystick + keyboard' : isAtariSt ? 'P1 Atari ST joystick + keyboard/mouse' : isArcade ? 'P1 arcade controls' : isSpectrum ? 'P1 Sinclair controls' : isSharedCpcParty ? `P${currentPartyPlayerNumber} / turn: P${activePartyPlayer}` : 'Cursor keys + X / Z'
      : isAmigaFamily
      ? 'P1 port 2 / P2 port 1 + keyboard/mouse'
      : isMasterSystem ? (isHost ? 'P1 controller 1 / Button 1 / Button 2 / Pause' : 'P2 controller 2 / Button 1 / Button 2') : isMegaDrive ? (isHost ? 'P1 controller 1 / A B C / Start' : 'P2 controller 2 / A B C / Start') : isNes ? (isHost ? 'P1 controller 1 / A B / Start / Select' : 'P2 controller 2 / A B / Start / Select') : isSnes ? `${isHost ? 'P1' : 'P2'} SNES pad / B Y A X / L R / Select / Start` : isPcEngine ? (isHost ? 'P1 controller 1 / I II / Run / Select' : 'P2 controller 2 / I II / Run / Select') : isDiscConsole ? `${isHost ? 'P1' : 'P2'} ${isSaturn ? 'Saturn' : 'PlayStation'} controller` : isC64Party ? `P${currentPartyPlayerNumber} C64 joystick` : isC64 ? (isHost ? 'P1 C64 joystick' : 'P2 C64 joystick') : isAtari8 ? (isHost ? 'P1 Atari joystick + keyboard' : 'P2 Atari joystick') : isAtariSt ? (isHost ? 'P1 Atari ST joystick + keyboard/mouse' : 'P2 Atari ST joystick') : isArcadeParty ? `P${currentPartyPlayerNumber} arcade controls` : isArcade ? (isHost ? 'P1 arcade controls' : 'P2 arcade controls') : isSpectrum ? 'P1 Sinclair 1 / P2 Sinclair 2' : isSharedCpcParty ? `You: P${currentPartyPlayerNumber} / turn: P${activePartyPlayer}` : isHost ? 'Cursor keys + X / Z' : 'Q A O P / F / G';
  const roleLabel = !room
    ? 'Loading...'
    : isSoloMode ? 'Solo' : isHost ? 'Host' : 'Guest';
  const playerOneName = hostDisplayName || (isHost ? username : 'Host');
  const playerTwoName = guestDisplayName || (!isHost ? username : 'Guest');
  const normalPlayerSummary = `P1: ${playerOneName} / P2: ${playerTwoName}`;
  const assignedControlLabel = isSoloMode
    ? `P1: ${username || playerOneName}`
    : isSharedCpcParty
    ? `You: P${currentPartyPlayerNumber} / turn: P${activePartyPlayer}`
    : isC64Party
      ? `P${currentPartyPlayerNumber}: ${isHost ? playerOneName : username || playerTwoName} / C64 joystick`
    : isArcadeParty
      ? partyPlayerNumber || isHost
        ? `P${currentPartyPlayerNumber}: ${isHost ? playerOneName : username || playerTwoName} / controller ${currentPartyPlayerNumber}`
        : arcadeQueueStatus.queued
          ? `Spectator / queue #${arcadeQueueStatus.queuePosition || '?'}`
          : 'Spectator'
    : isDirectJoystickSystem
      ? `${isHost ? `P1: ${playerOneName}` : `P2: ${playerTwoName}`} / controller ${isHost ? '1' : '2'}`
      : isHost
        ? `P1: ${playerOneName}`
        : `P2: ${playerTwoName}`;
  const partyPlayerNameByNumber = useMemo(() => {
    const names = new Map();
    partyRoster.forEach((player) => {
      names.set(player.playerNumber, player.username);
    });
    return names;
  }, [partyRoster]);
  const activePartyPlayerName = partyPlayerNameByNumber.get(activePartyPlayer);
  const arcadeParentRomCount = useMemo(
    () => arcadeRomEntries.filter((entry) => !entry.isClone).length,
    [arcadeRomEntries],
  );
  const arcadeCloneRomCount = arcadeRomEntries.length - arcadeParentRomCount;
  const filteredArcadeRomEntries = useMemo(() => {
    const query = arcadeRomSearch.trim().toLowerCase();
    const visibleEntries = showArcadeCloneRoms
      ? arcadeRomEntries
      : arcadeRomEntries.filter((entry) => !entry.isClone);
    const entries = query
      ? visibleEntries.filter((entry) => (
        entry.name.toLowerCase().includes(query)
        || entry.displayName.toLowerCase().includes(query)
        || entry.path.toLowerCase().includes(query)
        || entry.parentTitle.toLowerCase().includes(query)
      ))
      : visibleEntries;

    return entries.slice(0, 120);
  }, [arcadeRomEntries, arcadeRomSearch, showArcadeCloneRoms]);
  const filteredLocalRoomGames = useMemo(() => {
    const query = localGameSearch.trim().toLowerCase();
    const matches = query
      ? localRoomGames.filter((game) => (
        game.title.toLowerCase().includes(query)
        || game.fileName.toLowerCase().includes(query)
        || game.path.toLowerCase().includes(query)
      ))
      : localRoomGames;

    return matches.slice(0, 180);
  }, [localGameSearch, localRoomGames]);

  useEffect(() => {
    isHostRef.current = isHost === true;
  }, [isHost]);

  useEffect(() => {
    hostVolumeRef.current = hostVolume;
    window.localStorage?.setItem(HOST_VOLUME_STORAGE_KEY, String(hostVolume));
    applyHostVolume(hostVolume);
  }, [hostVolume]);

  useEffect(() => {
    return () => {
      cleanupHostAudioGraph({ stopInput: true });
    };
  }, []);

  useEffect(() => {
    setEmulatorFrameLoadCount(0);
    sentStoredKickstartFrameRef.current = 0;
    if (isAtari8) {
      clearAtari8SessionStorage();
    }
  }, [emulatorSrc, emulatorSessionKey]);

  useEffect(() => {
    if (isSharedCpcParty || !navigator.mediaDevices?.addEventListener) {
      return undefined;
    }

    const handleDeviceChange = () => {
      refreshMicrophoneDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    refreshMicrophoneDevices();

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [isSharedCpcParty]);

  useEffect(() => {
    if (!room || !username) return;

    if (isHost) {
      setHostDisplayName(username);
    } else {
      setGuestDisplayName(username);
    }
  }, [isHost, room, username]);

  useEffect(() => {
    if (!isMultiPeerParty || !isHost) {
      setPartyRoster([]);
      return;
    }

    refreshPartyRoster();
  }, [isHost, isMultiPeerParty, username]);

  const addLog = useCallback((message) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()} - ${message}`, ...prev].slice(0, 80));
  }, []);

  useEffect(() => {
    if (!isHost || !roomSystem) {
      setLocalRoomGames([]);
      return undefined;
    }

    let cancelled = false;

    async function loadLocalRoomGames() {
      try {
        const games = await getLocalLibraryGames();
        if (cancelled) return;
        const matchingGames = games.filter((game) => game.roomSystem === roomSystem);
        const roomGames = roomSystem === 'amiga_aga' || roomSystem === 'amiga'
          ? groupAmigaRoomGames(matchingGames)
          : matchingGames;
        setLocalRoomGames(roomGames.sort((left, right) => left.title.localeCompare(right.title)));
      } catch (err) {
        if (!cancelled) {
          addLog(`Local library list unavailable: ${err.message}`);
          setLocalRoomGames([]);
        }
      }
    }

    loadLocalRoomGames();
    return () => {
      cancelled = true;
    };
  }, [addLog, isHost, roomSystem]);

  const playRemoteVideo = useCallback(() => {
    const video = remoteVideoRef.current;
    if (!video?.srcObject) return;

    video.playsInline = true;
    video.muted = false;
    video.volume = 1;
    const playPromise = video.play?.();
    if (!playPromise?.catch) {
      setRemotePlaybackBlocked(false);
      return;
    }

    playPromise
      .then(() => setRemotePlaybackBlocked(false))
      .catch(() => {
        setRemotePlaybackBlocked(true);
        addLog('Remote video is ready; tap Capture to start playback');
      });
  }, [addLog]);

  const sendSignalRef = useRef(() => false);

  function clearMirrorCanvas(message = 'Loading emulator...') {
    const canvas = mirrorCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#d8d8d4';
    context.font = '20px sans-serif';
    context.textAlign = 'center';
    context.fillText(message, canvas.width / 2, canvas.height / 2);
  }

  function stopMirrorLoop() {
    if (mirrorLoopRef.current) {
      cancelAnimationFrame(mirrorLoopRef.current);
      mirrorLoopRef.current = null;
    }
    if (mirrorKeepaliveTimerRef.current) {
      window.clearInterval(mirrorKeepaliveTimerRef.current);
      mirrorKeepaliveTimerRef.current = null;
    }
    mirrorCaptureTrackRef.current = null;
  }

  function cleanupHostAudioGraph({ stopInput = false } = {}) {
    const graph = hostAudioGraphRef.current;
    hostAudioGraphRef.current = null;

    graph?.output?.getTracks?.().forEach((track) => track.stop());
    if (stopInput) {
      graph?.input?.getTracks?.().forEach((track) => track.stop());
    }
    graph?.context?.close?.().catch(() => {});

    if (stopInput) {
      hostRawAudioStreamRef.current = null;
    }
  }

  function applyHostVolume(value = hostVolumeRef.current) {
    hostVolumeRef.current = Math.min(1, Math.max(0, Number(value) || 0));
    const graph = hostAudioGraphRef.current;

    if (graph?.gain && graph?.context) {
      graph.gain.gain.setValueAtTime(hostVolumeRef.current, graph.context.currentTime);
    }
  }

  function buildHostAudioStream(rawAudioStream) {
    const previousRawAudioStream = hostRawAudioStreamRef.current;
    // Solo-to-multiplayer recapture reuses the iframe's source stream. Keep
    // that source alive while replacing only the gain/output graph.
    cleanupHostAudioGraph({
      stopInput: Boolean(previousRawAudioStream && previousRawAudioStream !== rawAudioStream),
    });
    hostRawAudioStreamRef.current = rawAudioStream || null;

    if (!rawAudioStream?.getAudioTracks?.().length) {
      return null;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      rawAudioStream.getAudioTracks().forEach((track) => {
        track.enabled = !emulatorPausedRef.current;
      });
      return rawAudioStream;
    }

    try {
      const context = new AudioContextClass();
      const source = context.createMediaStreamSource(rawAudioStream);
      const gain = context.createGain();
      const destination = context.createMediaStreamDestination();

      gain.gain.value = hostVolumeRef.current;
      source.connect(gain);
      gain.connect(destination);
      destination.stream.getAudioTracks().forEach((track) => {
        track.enabled = !emulatorPausedRef.current;
      });
      hostAudioGraphRef.current = {
        context,
        source,
        gain,
        output: destination.stream,
        input: rawAudioStream,
      };
      context.resume?.().catch(() => {
        addLog('Cabinet audio is waiting for browser playback permission');
      });
      return destination.stream;
    } catch (err) {
      addLog(`Volume control unavailable: ${err.message}`);
      rawAudioStream.getAudioTracks().forEach((track) => {
        track.enabled = !emulatorPausedRef.current;
      });
      return rawAudioStream;
    }
  }

  function setHostPaused(nextPaused) {
    emulatorPausedRef.current = nextPaused;
    setEmulatorPaused(nextPaused);
  }

  function resetLiveRoomSession(message = 'Room session reset', { preservePeer = false } = {}) {
    stopMirrorLoop();
    cleanupHostAudioGraph({ stopInput: true });
    setHostPaused(false);

    clearMirrorCanvas(message);

    if (!preservePeer) {
      dataChannelRef.current?.close();
      serialChannelRef.current?.close();
      dataChannelRef.current = null;
      serialChannelRef.current = null;
      serialOfferStartedRef.current = false;
      localOfferRef.current = null;
      pendingIceCandidatesRef.current = [];
      activeGuestSignalIdRef.current = '';
      activePeerSignalIdRef.current = '';
      remoteMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteVoiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteMediaStreamRef.current = null;
      remoteVoiceStreamRef.current = null;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      setRemotePlaybackBlocked(false);
      if (remoteVoiceAudioRef.current) {
        remoteVoiceAudioRef.current.pause();
        remoteVoiceAudioRef.current.srcObject = null;
      }

      for (const [guestId] of partyHostPeersRef.current) {
        closePartyPeer(guestId);
      }
      partyHostPeersRef.current.clear();
      pendingPartyGuestsRef.current.clear();
      pcRef.current?.close();
      pcRef.current = null;
    }

    setHostStarted(false);
    hostStartedRef.current = false;
    hostStartingRef.current = false;
    if (!preservePeer) {
      setGuestPrepared(false);
      guestPreparedRef.current = false;
      setRemoteConnected(false);
    }
    setLoadedDiskName('');
    setInputCaptured(false);
    setEmulatorFrameLoadCount(0);
    sentStoredKickstartFrameRef.current = 0;
    if (!preservePeer) {
      setPartyPlayerNumber(null);
      setPartyRoster([]);
      setGuestDisplayName('');
      setRemoteConnected(false);
      setRoomSessionKey((key) => key + 1);
    }
    setActivePartyPlayer(1);
    setEmulatorSessionKey((key) => key + 1);
    setStatus(message);
    addLog(message);
  }

  function applyRoomSystemUpdate(nextRoom, messagePrefix = 'Room switched', { preservePeer = false } = {}) {
    if (!nextRoom?.system) return;
    setRoom(nextRoom);
    setSelectedRoomSystem(nextRoom.system);
    resetLiveRoomSession(`${messagePrefix} to ${roomSystemLabel(nextRoom.system)}`, { preservePeer });
  }

  function updateAtari8Config(patch) {
    const next = normalizeAtari8Config({ ...atari8Config, ...patch });
    const changed = JSON.stringify(next) !== JSON.stringify(atari8Config);
    if (!changed) return;

    setAtari8Config(next);
    if (isAtari8) {
      resetLiveRoomSession('Atari machine settings changed', { preservePeer: true });
    }
  }

  const addInputDebug = useCallback((message, mask = null, source = null) => {
    setInputDebug((prev) => ({
      mask: mask ?? prev.mask,
      source: source ?? prev.source,
      events: [`${new Date().toLocaleTimeString()} - ${message}`, ...prev.events].slice(0, 14),
    }));
  }, []);

  function shouldHandleKey(event) {
    const tag = event.target?.tagName?.toLowerCase();

    return (
      tag !== 'input'
      && tag !== 'textarea'
      && tag !== 'button'
      && tag !== 'a'
      && !event.metaKey
      && (!event.altKey || event.key === 'Alt')
    );
  }

  function shouldHandleHostKey(event) {
    const tag = event.target?.tagName?.toLowerCase();

    return (
      tag !== 'input'
      && tag !== 'textarea'
      && tag !== 'select'
      && !event.target?.isContentEditable
      && !event.metaKey
      && !event.altKey
    );
  }

  function getKeyboardKey(event) {
    if (event.code === 'Space' || event.key === 'Spacebar' || event.keyCode === 32) {
      return ' ';
    }

    return event.key;
  }

  function keyToJoystickBit(key) {
    switch (key) {
      case 'q':
      case 'Q':
        return 1;
      case 'a':
      case 'A':
        return 2;
      case 'o':
      case 'O':
        return 4;
      case 'p':
      case 'P':
        return 8;
      case 'f':
      case 'F':
        return 16;
      case 'g':
      case 'G':
        return 32;
      default:
        return 0;
    }
  }

  function nonStandardGamepadDirections(pad, deadzone) {
    const directions = { left: false, right: false, up: false, down: false };

    // Fight sticks and USB encoder boards commonly expose the lever on one of
    // these additional axis pairs instead of the standard axes 0/1.
    for (const [xIndex, yIndex] of [[2, 3], [4, 5], [6, 7]]) {
      if (xIndex >= pad.axes.length || yIndex >= pad.axes.length) continue;
      const x = Number(pad.axes[xIndex]) || 0;
      const y = Number(pad.axes[yIndex]) || 0;
      directions.left ||= x < -deadzone;
      directions.right ||= x > deadzone;
      directions.up ||= y < -deadzone;
      directions.down ||= y > deadzone;
    }

    // Some DirectInput devices expose the D-pad as a single eight-way POV
    // axis. Chromium/Firefox use eighth-turn values from -1 (up) through 1
    // (up-left), with an out-of-range value for neutral.
    for (const axisIndex of [9]) {
      if (axisIndex >= pad.axes.length) continue;
      const value = Number(pad.axes[axisIndex]);
      if (!Number.isFinite(value) || value < -1.05 || value > 1.05) continue;
      const position = Math.max(0, Math.min(7, Math.round((value + 1) * 3.5)));
      directions.up ||= position === 0 || position === 1 || position === 7;
      directions.right ||= position >= 1 && position <= 3;
      directions.down ||= position >= 3 && position <= 5;
      directions.left ||= position >= 5 && position <= 7;
    }

    return directions;
  }

  function gamepadToJoystickMask(pad, system = roomSystem) {
    if (supportsControllerMapping(system) && pad.id) {
      const customMapping = getControllerMapping(system, pad.id);
      if (customMapping) {
        const customMask = applyCustomMapping(pad, customMapping);
        if (customMask !== null) return customMask;
      }
    }

    let mask = 0;
    const deadzone = 0.45;
    const fallback = pad.mapping === 'standard'
      ? { left: false, right: false, up: false, down: false }
      : nonStandardGamepadDirections(pad, deadzone);

    const left = pad.buttons[14]?.pressed || (pad.axes[0] ?? 0) < -deadzone || fallback.left;
    const right = pad.buttons[15]?.pressed || (pad.axes[0] ?? 0) > deadzone || fallback.right;
    const up = pad.buttons[12]?.pressed || (pad.axes[1] ?? 0) < -deadzone || fallback.up;
    const down = pad.buttons[13]?.pressed || (pad.axes[1] ?? 0) > deadzone || fallback.down;
    const isMultiButtonSystem = system === 'mastersystem' || system === 'megadrive' || system === 'nes' || system === 'snes' || system === 'pcengine' || system === 'playstation' || system === 'saturn' || system === 'saturn_beetle' || system === 'arcade';
    const fire = isMultiButtonSystem
      ? pad.buttons[0]?.pressed
      : [0, 1].some((index) => pad.buttons[index]?.pressed);
    const extra = isMultiButtonSystem
      ? pad.buttons[1]?.pressed
      : [2, 3].some((index) => pad.buttons[index]?.pressed);
    const third = isMultiButtonSystem && pad.buttons[2]?.pressed;
    const start = system === 'arcade'
      ? pad.buttons[9]?.pressed
      : [7, 9].some((index) => pad.buttons[index]?.pressed);

    if (up) mask |= 1;
    if (down) mask |= 2;
    if (left) mask |= 4;
    if (right) mask |= 8;
    if (fire) mask |= 16;
    if (extra) mask |= 32;
    if (start) mask |= 64;
    if (third) mask |= 128;
    if (system === 'arcade') {
      if (pad.buttons[3]?.pressed) mask |= 256;
      if (pad.buttons[4]?.pressed) mask |= 512;
      if (pad.buttons[5]?.pressed) mask |= 1024;
      if (pad.buttons[6]?.pressed) mask |= 2048;
      if (pad.buttons[8]?.pressed) mask |= 4096;
      if ((pad.axes[3] ?? 0) < -deadzone) mask |= 8192;
      if ((pad.axes[3] ?? 0) > deadzone) mask |= 16384;
      if ((pad.axes[2] ?? 0) < -deadzone) mask |= 32768;
      if ((pad.axes[2] ?? 0) > deadzone) mask |= 65536;
    }
    if (system === 'playstation' || system === 'saturn' || system === 'saturn_beetle') {
      if (pad.buttons[3]?.pressed) mask |= 256;
      if (pad.buttons[8]?.pressed) mask |= 512;
      if (pad.buttons[4]?.pressed) mask |= 1024;
      if (pad.buttons[5]?.pressed) mask |= 2048;
    }

    return mask;
  }

  function joystickMaskToLabels(mask) {
    if (isArcade) {
      return [
        ['Up', Boolean(mask & 1)],
        ['Down', Boolean(mask & 2)],
        ['Left', Boolean(mask & 4)],
        ['Right', Boolean(mask & 8)],
        ['Button 0', Boolean(mask & 16)],
        ['Button 1', Boolean(mask & 32)],
        ['Button 2', Boolean(mask & 128)],
        ['Button 3', Boolean(mask & 256)],
        ['Button 4', Boolean(mask & 512)],
        ['Button 5', Boolean(mask & 1024)],
        ['Button 6', Boolean(mask & 2048)],
        ['Coin', Boolean(mask & 4096)],
        ['Start', Boolean(mask & 64)],
        ['Fire up', Boolean(mask & 8192)],
        ['Fire down', Boolean(mask & 16384)],
        ['Fire left', Boolean(mask & 32768)],
        ['Fire right', Boolean(mask & 65536)],
      ];
    }

    return [
      ['Up', Boolean(mask & 1)],
      ['Down', Boolean(mask & 2)],
      ['Left', Boolean(mask & 4)],
      ['Right', Boolean(mask & 8)],
      ['Fire', Boolean(mask & 16)],
      ['Extra', Boolean(mask & 32)],
      ['Start', Boolean(mask & 64)],
      ['Third', Boolean(mask & 128)],
    ];
  }

  function formatInputPayload(payload) {
    if (!payload) return 'empty payload';

    if (payload.type === 'control') {
      return `P${payload.player} ${payload.key} ${payload.action}`;
    }

    if (payload.type === 'key') {
      return `P${payload.player} key ${payload.key} ${payload.action}`;
    }

    if (payload.type === 'joystick') {
      return `P${payload.player} mask ${payload.mask}`;
    }

    if (payload.type === 'input_state') {
      return `P${payload.player} state ${payload.mask} #${payload.seq}`;
    }

    if (payload.type === 'amiga_mouse_button') {
      return `Amiga mouse button ${payload.button} ${payload.action}`;
    }

    if (payload.type === 'amiga_mouse_move') {
      return `Amiga mouse move ${payload.movementX},${payload.movementY}`;
    }

    return `${payload.type || 'unknown'} input`;
  }

  function joystickMaskToKeys(mask, player) {
    const keys = player === 1
      ? { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', fire: 'x', extra: 'z' }
      : { up: 'q', down: 'a', left: 'o', right: 'p', fire: 'f', extra: 'g' };

    return [
      [keys.up, 1, Boolean(mask & 1)],
      [keys.down, 2, Boolean(mask & 2)],
      [keys.left, 4, Boolean(mask & 4)],
      [keys.right, 8, Boolean(mask & 8)],
      [keys.fire, 16, Boolean(mask & 16)],
      [keys.extra, 32, Boolean(mask & 32)],
    ];
  }

  function hostKeyToCpcKeyboardKey(key) {
    switch (key) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
      case ' ':
        return key;
      case 'z':
      case 'Z':
        return 'z';
      case 'm':
      case 'M':
        return 'm';
      case 'q':
      case 'Q':
        return 'q';
      case 'a':
      case 'A':
        return 'a';
      case 'o':
      case 'O':
        return 'o';
      case 'p':
      case 'P':
        return 'p';
      case 'f':
      case 'F':
        return 'f';
      case 'Enter':
        return 'Enter';
      case 'Tab':
        return 'Tab';
      case 'CapsLock':
        return 'CapsLock';
      case 'Control':
      case 'ControlLeft':
      case 'ControlRight':
        return 'Control';
      case 'Alt':
      case 'AltLeft':
      case 'AltRight':
        return 'Alt';
      case 'Shift':
      case 'ShiftLeft':
      case 'ShiftRight':
        return 'Shift';
      case 'Backspace':
        return 'Backspace';
      case 'Delete':
        return 'Delete';
      case 'Escape':
        return 'Escape';
      case 'Home':
        return 'Home';
      case 'End':
        return 'End';
      case 'PageUp':
        return 'PageUp';
      case 'PageDown':
        return 'PageDown';
      case 'F1':
      case 'F2':
      case 'F3':
      case 'F4':
      case 'F5':
      case 'F6':
      case 'F7':
      case 'F8':
      case 'F9':
      case 'F10':
      case 'F11':
      case 'F12':
        return key;
      default:
        return key.length === 1 ? key : null;
    }
  }

  function isMenuKey(key) {
    return [
      'Enter',
      'Tab',
      'CapsLock',
      'Shift',
      'ShiftLeft',
      'ShiftRight',
      'Control',
      'ControlLeft',
      'ControlRight',
      'Alt',
      'AltLeft',
      'AltRight',
      'Backspace',
      'Delete',
      'Escape',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'F1',
      'F2',
      'F3',
      'F4',
      'F5',
      'F6',
      'F7',
      'F8',
      'F9',
      'F10',
      'F11',
      'F12',
      ' ',
    ].includes(key);
  }

  function isGuestKeyboardKey(key) {
    return isMenuKey(key) || key.length === 1;
  }

  const forwardInputToEmulator = useCallback((payload) => {
    const frame = emulatorFrameRef.current;
    const targetWindow = frame?.contentWindow;

    if (!targetWindow) return;

    targetWindow.postMessage(payload, window.location.origin);
  }, []);

  const reloadC64Frame = useCallback(async ({ start = false } = {}) => {
    const frame = emulatorFrameRef.current;
    if (!frame || !isC64) return;

    stopMirrorLoop();

    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      const separator = emulatorSrc.includes('?') ? '&' : '?';
      frame.src = `${emulatorSrc}${separator}runtime=${Date.now()}`;
    });

    if (!start) return;

    frame.contentWindow?.postMessage({ type: 'c64_start', soloMode: isSoloMode }, window.location.origin);
    const emulatorCanvas = await waitForEmulatorCanvas(frame);
    startMirrorLoop(emulatorCanvas);
  }, [emulatorSrc, isC64, isSoloMode]);

  const reloadAtari8Frame = useCallback(async (configOverride = atari8Config) => {
    const frame = emulatorFrameRef.current;
    if (!frame || !isAtari8) return null;

    stopMirrorLoop();

    const src = buildAtari8EmulatorSrc(configOverride);
    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      const separator = src.includes('?') ? '&' : '?';
      frame.src = `${src}${separator}runtime=${Date.now()}`;
    });

    if (hostStartedRef.current) {
      const emulatorCanvas = await waitForEmulatorCanvas(frame);
      startMirrorLoop(emulatorCanvas);
    }

    return frame;
  }, [atari8Config, isAtari8]);

  const reloadAtariStFrame = useCallback(async ({ start = false } = {}) => {
    const frame = emulatorFrameRef.current;
    if (!frame || !isAtariSt) return;

    stopMirrorLoop();

    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      const separator = emulatorSrc.includes('?') ? '&' : '?';
      frame.src = `${emulatorSrc}${separator}runtime=${Date.now()}`;
    });

    if (!start) return;
    frame.contentWindow?.postMessage({ type: 'atarist_start', soloMode: isSoloMode }, window.location.origin);
    const emulatorCanvas = await waitForEmulatorCanvas(frame);
    startMirrorLoop(emulatorCanvas);
  }, [emulatorSrc, isAtariSt, isSoloMode]);

  const reloadAmigaAgaFrame = useCallback(async () => {
    const frame = emulatorFrameRef.current;
    if (!frame || !isPuaeAmiga) return null;

    stopMirrorLoop();

    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      const separator = emulatorSrc.includes('?') ? '&' : '?';
      frame.src = `${emulatorSrc}${separator}runtime=${Date.now()}`;
    });

    const storedKickstart = await loadStoredKickstart(kickstartStorageKey);
    if (storedKickstart) {
      frame.contentWindow?.postMessage(
        buildAmigaKickstartPayload(roomSystem, storedKickstart.fileName, storedKickstart.bytes),
        window.location.origin,
      );
    }

    const emulatorCanvas = await waitForEmulatorCanvas(frame);
    startMirrorLoop(emulatorCanvas);
    return frame;
  }, [emulatorSrc, isPuaeAmiga, kickstartStorageKey, roomSystem]);

  const reloadPcEngineFrame = useCallback(async () => {
    const frame = emulatorFrameRef.current;
    if (!frame || (!isPcEngine && !isX68000)) return;

    stopMirrorLoop();

    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      const separator = emulatorSrc.includes('?') ? '&' : '?';
      frame.src = `${emulatorSrc}${separator}runtime=${Date.now()}`;
    });

    const emulatorCanvas = await waitForEmulatorCanvas(frame);
    startMirrorLoop(emulatorCanvas);

    const previousAudioTrack = hostAudioStreamRef.current?.getAudioTracks?.()[0] || null;
    const rawAudioStream = await waitForHostAudioStream(frame);
    const nextAudioStream = buildHostAudioStream(rawAudioStream);
    const nextAudioTrack = nextAudioStream?.getAudioTracks?.()[0] || null;

    if (!isSoloMode && previousAudioTrack && nextAudioTrack) {
      const audioSender = pcRef.current?.getSenders?.().find((sender) => sender.track === previousAudioTrack);
      await audioSender?.replaceTrack(nextAudioTrack);
    }

    hostAudioStreamRef.current = nextAudioStream || null;
  }, [emulatorSrc, isPcEngine, isSoloMode, isX68000]);

  const reloadNesFrame = useCallback(async () => {
    const frame = emulatorFrameRef.current;
    if (!frame || !isNes) return null;

    stopMirrorLoop();

    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      const separator = emulatorSrc.includes('?') ? '&' : '?';
      frame.src = `${emulatorSrc}${separator}runtime=${Date.now()}`;
    });

    return frame;
  }, [emulatorSrc, isNes]);

  const reloadPlayStationFrame = useCallback(async () => {
    const frame = emulatorFrameRef.current;
    if (!frame || !isDiscConsole) return;

    stopMirrorLoop();

    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      const separator = emulatorSrc.includes('?') ? '&' : '?';
      frame.src = `${emulatorSrc}${separator}runtime=${Date.now()}`;
    });

    const storedBios = isSaturn
      ? savedSystemMediaRef.current.get(SATURN_BIOS_KEY)
      : await loadStoredKickstart(PLAYSTATION_BIOS_KEY);
    if (storedBios) {
      frame.contentWindow?.postMessage({
        type: isSaturn ? 'saturn_bios' : 'playstation_bios',
        fileName: storedBios.fileName,
        bytes: storedBios.bytes,
      }, window.location.origin);
    }

    const emulatorCanvas = await waitForEmulatorCanvas(frame);
    startMirrorLoop(emulatorCanvas);

    const previousAudioTrack = hostAudioStreamRef.current?.getAudioTracks?.()[0] || null;
    const rawAudioStream = await waitForHostAudioStream(frame);
    const nextAudioStream = buildHostAudioStream(rawAudioStream);
    const nextAudioTrack = nextAudioStream?.getAudioTracks?.()[0] || null;

    if (!isSoloMode && previousAudioTrack && nextAudioTrack) {
      const audioSender = pcRef.current?.getSenders?.().find((sender) => sender.track === previousAudioTrack);
      await audioSender?.replaceTrack(nextAudioTrack);
    }

    hostAudioStreamRef.current = nextAudioStream || null;
  }, [emulatorSrc, isDiscConsole, isSaturn, isSoloMode]);

  const reloadArcadeFrame = useCallback(async () => {
    const frame = emulatorFrameRef.current;
    if (!frame || !isArcade) return null;

    stopMirrorLoop();

    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      const separator = emulatorSrc.includes('?') ? '&' : '?';
      frame.src = `${emulatorSrc}${separator}runtime=${Date.now()}`;
    });

    return frame;
  }, [emulatorSrc, isArcade]);

  async function replaceHostMediaStreams(nextVideoStream, nextAudioStream = null) {
    const previousVideoStream = hostVideoStreamRef.current;
    const previousAudioStream = hostAudioStreamRef.current;
    const controlledAudioStream = buildHostAudioStream(nextAudioStream);
    const nextVideoTrack = nextVideoStream?.getVideoTracks?.()[0] || null;
    const nextAudioTrack = controlledAudioStream?.getAudioTracks?.()[0] || null;

    if (!nextVideoTrack) {
      throw new Error('New arcade video stream missing');
    }

    const peerConnections = isMultiPeerParty
      ? Array.from(partyHostPeersRef.current.values()).map((peer) => peer.pc).filter(Boolean)
      : [pcRef.current].filter(Boolean);

    for (const pc of peerConnections) {
      const videoSender = pc.getSenders?.().find((sender) => sender.track?.kind === 'video');
      const audioSender = pc.getSenders?.().find((sender) => sender.track?.kind === 'audio' && nextAudioTrack);

      if (videoSender) {
        await videoSender.replaceTrack(nextVideoTrack);
      } else if (!isSoloMode) {
        pc.addTrack(nextVideoTrack, nextVideoStream);
      }

      if (nextAudioTrack) {
        if (audioSender) {
          await audioSender.replaceTrack(nextAudioTrack);
        } else if (!isSoloMode) {
          pc.addTrack(nextAudioTrack, controlledAudioStream);
        }
      }
    }

    previousVideoStream?.getTracks?.().forEach((track) => track.stop());
    previousAudioStream?.getTracks?.().forEach((track) => track.stop());
    hostVideoStreamRef.current = nextVideoStream;
    mirrorCaptureTrackRef.current = nextVideoTrack;
    hostAudioStreamRef.current = controlledAudioStream || null;
  }

  const configureSerialChannel = useCallback((channel) => {
    serialChannelRef.current = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      addLog('Amiga serial link connected');
      setStatus('Amiga serial link connected');
    };
    channel.onclose = () => {
      addLog('Amiga serial link closed');
      setStatus('Amiga serial link closed');
    };
    channel.onmessage = (event) => {
      const bytes = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : event.data instanceof Blob
          ? null
          : new Uint8Array([Number(event.data) & 255]);

      if (bytes) {
        setSerialActivity((activity) => ({ ...activity, received: activity.received + bytes.length }));
        bytes.forEach((value) => forwardInputToEmulator({ type: 'amiga_serial_in', value }));
        return;
      }

      event.data.arrayBuffer().then((buffer) => {
        const bytesFromBlob = new Uint8Array(buffer);
        setSerialActivity((activity) => ({ ...activity, received: activity.received + bytesFromBlob.length }));
        bytesFromBlob.forEach((value) => forwardInputToEmulator({ type: 'amiga_serial_in', value }));
      });
    };
  }, [addLog, forwardInputToEmulator]);

  useEffect(() => {
    if (!isX68000) return undefined;

    function handleX68000Trace(event) {
      if (event.origin !== window.location.origin) return;
      if (event.source !== emulatorFrameRef.current?.contentWindow) return;
      const message = event.data || {};
      if (message.type !== 'x68000_trace') return;
      addLog(`PX68k #${message.sequence} ${message.stage}${message.detail ? ` — ${message.detail}` : ''}`);
    }

    window.addEventListener('message', handleX68000Trace);
    return () => window.removeEventListener('message', handleX68000Trace);
  }, [addLog, isX68000]);

  const handleHostDataMessage = useCallback((rawMessage) => {
    try {
      const parsed = JSON.parse(rawMessage);

      if (parsed.type === 'arcade_seat_update') {
        setPartyPlayerNumber(parsed.playerNumber || null);
        setArcadeQueueStatus({
          queued: Boolean(parsed.queued),
          queuePosition: parsed.queuePosition || null,
          role: parsed.role || (parsed.playerNumber ? `P${parsed.playerNumber}` : 'Spectator'),
        });
        addLog(parsed.playerNumber
          ? `You are now P${parsed.playerNumber}`
          : parsed.queued
            ? `You are queue #${parsed.queuePosition || '?'}`
            : 'You are watching as a spectator');
      }
    } catch (err) {
      addLog(`Host message parse error: ${err.message}`);
    }
  }, [addLog]);

  useEffect(() => {
    if (!isAmigaLink) return undefined;

    function handleAmigaSerialOutput(event) {
      if (event.origin !== window.location.origin) return;
      if (event.source !== emulatorFrameRef.current?.contentWindow) return;
      if (event.data?.type !== 'amiga_serial_out') return;

      const channel = serialChannelRef.current;
      if (channel?.readyState === 'open') {
        channel.send(new Uint8Array([Number(event.data.value) & 255]));
        setSerialActivity((activity) => ({ ...activity, sent: activity.sent + 1 }));
      }
    }

    window.addEventListener('message', handleAmigaSerialOutput);
    return () => window.removeEventListener('message', handleAmigaSerialOutput);
  }, [isAmigaLink]);

  useEffect(() => {
    function handleArcadeMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (event.source !== emulatorFrameRef.current?.contentWindow) return;

      const message = event.data || {};
      if (message.type === 'arcade_score_files_changed') {
        setMameScoreChangeToken((token) => token + 1);
        return;
      }
      if (message.type !== 'arcade_log') return;

      const prefix = message.level === 'error' ? 'Arcade error' : 'Arcade';
      addLog(`${prefix}: ${message.message}`);
    }

    window.addEventListener('message', handleArcadeMessage);

    return () => {
      window.removeEventListener('message', handleArcadeMessage);
    };
  }, [addLog]);

  useEffect(() => {
    if (!isC64) return undefined;

    function handleC64Message(event) {
      if (event.origin !== window.location.origin) return;
      if (event.source !== emulatorFrameRef.current?.contentWindow) return;

      const message = event.data || {};
      if (message.type !== 'c64_media_status') return;

      setC64MediaCount(Number(message.count) || 0);
      setC64MediaIndex(Number(message.current) || 0);
      if (message.message) {
        addLog(message.message);
        setStatus(message.message);
      }
    }

    window.addEventListener('message', handleC64Message);
    return () => window.removeEventListener('message', handleC64Message);
  }, [addLog, isC64]);

  useEffect(() => {
    if (!isAtariSt) return undefined;

    function handleAtariStMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (event.source !== emulatorFrameRef.current?.contentWindow) return;
      const message = event.data || {};
      if (message.type !== 'atarist_media_status') return;

      setAtariStMediaCount(Number(message.count) || 0);
      setAtariStMediaIndex(Number(message.current) || 0);
      if (message.message) {
        addLog(message.message);
        setStatus(message.message);
      }
    }

    window.addEventListener('message', handleAtariStMessage);
    return () => window.removeEventListener('message', handleAtariStMessage);
  }, [addLog, isAtariSt]);

  useEffect(() => {
    if (!isPuaeAmiga) return undefined;

    function handleAmigaAgaMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (event.source !== emulatorFrameRef.current?.contentWindow) return;

      const message = event.data || {};
      if (message.type !== 'amiga_aga_disk_status') return;

      setLoadedAgaDiskCount(Number(message.count) || 0);
      setCurrentAgaDiskIndex(Number(message.current) || 0);
      if (message.message) {
        addLog(message.message);
        setStatus(message.message);
      }
    }

    window.addEventListener('message', handleAmigaAgaMessage);
    return () => window.removeEventListener('message', handleAmigaAgaMessage);
  }, [addLog, isPuaeAmiga]);

  useEffect(() => {
    if (!isHost || !emulatorFrameLoadCount || !kickstartStorageKey) return undefined;
    if (sentStoredKickstartFrameRef.current === emulatorFrameLoadCount) return undefined;

    let cancelled = false;
    const timers = [];
    sentStoredKickstartFrameRef.current = emulatorFrameLoadCount;
    const timer = window.setTimeout(async () => {
      try {
        let storedKickstart = savedSystemMediaRef.current.get(kickstartStorageKey);
        if (!storedKickstart) {
          storedKickstart = await loadStoredKickstart(kickstartStorageKey);
          if (storedKickstart) {
            savedSystemMediaRef.current.set(kickstartStorageKey, storedKickstart);
          }
        }

        if (!storedKickstart && isX68000 && hasVipAccess) {
          const token = localStorage.getItem('token');
          const response = await fetch(`${API_BASE_URL}/auth/vip/amiga/x68000-firmware`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.detail || 'VIP X68000 firmware could not be downloaded');
          }
          storedKickstart = {
            fileName: 'x68000-firmware.zip',
            bytes: new Uint8Array(await response.arrayBuffer()),
          };
          savedSystemMediaRef.current.set(kickstartStorageKey, storedKickstart);
          await saveStoredKickstart(kickstartStorageKey, storedKickstart.fileName, storedKickstart.bytes);
        }

        if (cancelled || !storedKickstart) return;

        const payload = isX68000
          ? buildX68000FirmwarePayload(storedKickstart.fileName, storedKickstart.bytes)
          : isDiscConsole
          ? {
            type: isSaturn ? 'saturn_bios' : 'playstation_bios',
            fileName: storedKickstart.fileName,
            bytes: storedKickstart.bytes,
          }
          : isAtariSt
            ? {
              type: 'atarist_tos',
              fileName: storedKickstart.fileName,
              bytes: storedKickstart.bytes,
            }
            : buildAmigaKickstartPayload(roomSystem, storedKickstart.fileName, storedKickstart.bytes);

        [0, 350, 900, 1600].forEach((delay) => {
          const retryTimer = window.setTimeout(() => {
            if (!cancelled) {
              forwardInputToEmulator(payload);
            }
          }, delay);
          timers.push(retryTimer);
        });

        if (isX68000) {
          setX68000FirmwareName(`${storedKickstart.fileName} (saved locally)`);
          addLog(`Loaded saved X68000 firmware: ${storedKickstart.fileName}`);
        } else if (isDiscConsole) {
          setPlaystationBiosName(`${storedKickstart.fileName} (saved locally)`);
          addLog(`Loaded saved ${isSaturn ? 'Saturn' : 'PlayStation'} BIOS: ${storedKickstart.fileName}`);
        } else if (isAtariSt) {
          setAtariTosName(`${storedKickstart.fileName} (saved locally)`);
          addLog(`Loaded saved Atari TOS: ${storedKickstart.fileName}`);
        } else {
          setKickstartRomName(`${storedKickstart.fileName} (saved)`);
          addLog(`Loaded saved Kickstart ROM: ${storedKickstart.fileName}`);
        }
      } catch (err) {
        if (!cancelled) {
          addLog(`Saved Kickstart unavailable: ${err.message}`);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      timers.forEach((retryTimer) => window.clearTimeout(retryTimer));
    };
  }, [addLog, emulatorFrameLoadCount, forwardInputToEmulator, hasVipAccess, isAtariSt, isDiscConsole, isHost, isSaturn, isX68000, kickstartStorageKey, emulatorSessionKey, roomSystem]);

  const forwardExtraButtonAsKey = useCallback((mask, player, previousMask) => {
    const extraBit = 32;
    const active = Boolean(mask & extraBit);
    const wasActive = Boolean(previousMask & extraBit);

    if (active === wasActive) return;

    const key = player === 1 ? 'z' : 'g';
    const action = active ? 'down' : 'up';

    addInputDebug(`forward P${player} extra key ${key} ${action}`, mask, player === 1 ? 'host local' : 'guest remote');
    forwardInputToEmulator({
      type: 'amstrad_remote_control',
      player,
      key,
      action,
    });
  }, [addInputDebug, forwardInputToEmulator]);

  const forwardJoystickMaskAsKeys = useCallback((mask, player, previousMask) => {
    joystickMaskToKeys(mask, player).forEach(([key, bit, active]) => {
      const wasActive = Boolean(previousMask & bit);

      if (active === wasActive) return;

      const action = active ? 'down' : 'up';

      addInputDebug(`forward held P${player} key ${key} ${action}`, mask, 'shared joystick');
      forwardInputToEmulator({
        type: 'amstrad_remote_control',
        player,
        key,
        action,
      });
    });
  }, [addInputDebug, forwardInputToEmulator]);

  const releaseCpcPartySharedInput = useCallback((previousMask = 63) => {
    if (!isSharedCpcParty) return;

    forwardJoystickMaskAsKeys(0, 1, previousMask);
    forwardInputToEmulator({
      type: 'amstrad_remote_joystick',
      player: 1,
      mask: 0,
    });
    forwardInputToEmulator({
      type: 'amstrad_remote_joystick',
      player: 2,
      mask: 0,
    });
  }, [forwardInputToEmulator, forwardJoystickMaskAsKeys, isSharedCpcParty]);

  const sendLocalJoystickMask = useCallback((mask) => {
    if (!canSendPlayerInput && mask) {
      addInputDebug('ignored spectator input', mask, 'spectator');
      return;
    }

    const player = isHost ? 1 : isMultiPeerParty ? currentPartyPlayerNumber : 2;
    const joystickMask = isDirectJoystickSystem ? mask : mask & 31;
    const previousMask = localJoystickMaskRef.current;
    const payload = {
      type: 'joystick',
      player,
      mask,
    };

    addInputDebug(`local P${player} joystick mask ${mask}`, mask, isHost ? 'host local' : 'guest local');

    if (isAmigaLink) {
      forwardInputToEmulator({
        type: 'amstrad_remote_joystick',
        player: 1,
        mask: joystickMask,
      });
      localJoystickMaskRef.current = mask;
      return;
    }

    if (isHost) {
      if (isSharedCpcParty && activePartyPlayer !== 1) {
        if (previousMask) {
          releaseCpcPartySharedInput(previousMask);
        }
        localJoystickMaskRef.current = 0;
        addInputDebug(`ignored host input, party turn is P${activePartyPlayer}`, 0, 'party turn');
        return;
      }

      if (isSharedCpcParty) {
        forwardInputToEmulator({
          type: 'amstrad_remote_joystick',
          player: 1,
          mask: joystickMask,
        });
        forwardExtraButtonAsKey(mask, 1, previousMask);
        localJoystickMaskRef.current = mask;
        return;
      }

      forwardInputToEmulator({
        type: 'amstrad_remote_joystick',
        player,
        mask: joystickMask,
      });
      if (!isDirectJoystickSystem) {
        forwardExtraButtonAsKey(mask, player, previousMask);
      }
      localJoystickMaskRef.current = mask;
      return;
    }

    const channel = dataChannelRef.current;
    if (channel?.readyState === 'open') {
      localJoystickMaskRef.current = mask;
      const statePayload = {
        type: 'input_state',
        player,
        sessionId: inputSessionIdRef.current,
        seq: inputSequenceRef.current + 1,
        mask,
        ts: performance.now(),
      };

      inputSequenceRef.current = statePayload.seq;
      addInputDebug(`send to host ${formatInputPayload(statePayload)}`);
      channel.send(JSON.stringify(statePayload));
    } else {
      addInputDebug(`not sent, channel closed ${formatInputPayload(payload)}`);
    }
  }, [activePartyPlayer, addInputDebug, canSendPlayerInput, currentPartyPlayerNumber, forwardExtraButtonAsKey, forwardInputToEmulator, isAmigaLink, isDirectJoystickSystem, isHost, isMultiPeerParty, isSharedCpcParty, releaseCpcPartySharedInput]);

  const releaseInputCapture = useCallback(() => {
    sendLocalJoystickMask(0);
    if (isCpcSystem) {
      forwardInputToEmulator({ type: 'amstrad_release_all' });
    }
    setInputCaptured(false);
    if (document.pointerLockElement && document.exitPointerLock) {
      document.exitPointerLock();
    }
  }, [forwardInputToEmulator, isCpcSystem, sendLocalJoystickMask]);

  const captureInput = useCallback((event = null) => {
    setInputCaptured(true);
    hostAudioGraphRef.current?.context?.resume?.().catch(() => {});
    forwardInputToEmulator({
      type: 'amstrad_audio_unlock',
    });

    const captureTarget = event?.currentTarget;
    if (
      isAmigaFamily
      && captureTarget
      && ['CANVAS', 'VIDEO'].includes(captureTarget.tagName)
      && document.pointerLockElement !== captureTarget
    ) {
      captureTarget.requestPointerLock?.();
    }

    const channel = dataChannelRef.current;
    if (!isHost && channel?.readyState === 'open') {
      channel.send(JSON.stringify({ type: 'audio_unlock' }));
    }

    playRemoteVideo();
  }, [forwardInputToEmulator, isAmigaFamily, isHost, playRemoteVideo]);

  useEffect(() => {
    if (!room || !autoCaptureController) return;
    captureInput();
  }, [autoCaptureController, captureInput, emulatorFrameLoadCount, room?.room_code]);

  const forwardAmigaMouse = useCallback((payload) => {
    if (!isMouseComputer) return;

    if (canControlLocalEmulator) {
      forwardInputToEmulator(payload);
      return;
    }

    const channel = dataChannelRef.current;
    if (channel?.readyState === 'open') {
      channel.send(JSON.stringify(payload));
    }
  }, [canControlLocalEmulator, forwardInputToEmulator, isMouseComputer]);

  const handleAmigaPointerDown = useCallback((event) => {
    if (!isMouseComputer) return;

    captureInput();
    const button = event.button === 2 ? 3 : 1;
    const payload = {
      type: 'amiga_mouse_button',
      button,
      action: 'down',
    };

    addInputDebug(`Amiga mouse button ${button} down`, null, isHost ? 'host mouse' : 'guest mouse');
    forwardAmigaMouse(payload);
    event.preventDefault();
  }, [addInputDebug, captureInput, forwardAmigaMouse, isHost, isMouseComputer]);

  const handleAmigaPointerUp = useCallback((event) => {
    if (!isMouseComputer) return;

    const button = event.button === 2 ? 3 : 1;
    const payload = {
      type: 'amiga_mouse_button',
      button,
      action: 'up',
    };

    addInputDebug(`Amiga mouse button ${button} up`, null, isHost ? 'host mouse' : 'guest mouse');
    forwardAmigaMouse(payload);
    event.preventDefault();
  }, [addInputDebug, forwardAmigaMouse, isHost, isMouseComputer]);

  const handleAmigaPointerMove = useCallback((event) => {
    if (!isMouseComputer || !inputCaptured) return;
    if (!event.movementX && !event.movementY) return;

    forwardAmigaMouse({
      type: 'amiga_mouse_move',
      movementX: event.movementX,
      movementY: event.movementY,
    });
  }, [forwardAmigaMouse, inputCaptured, isMouseComputer]);

  useEffect(() => {
    if (!isMouseComputer || !inputCaptured) return undefined;

    function handleLockedMouseMove(event) {
      if (!document.pointerLockElement) return;
      if (!event.movementX && !event.movementY) return;

      forwardAmigaMouse({
        type: 'amiga_mouse_move',
        movementX: event.movementX,
        movementY: event.movementY,
      });
    }

    window.addEventListener('mousemove', handleLockedMouseMove);

    return () => {
      window.removeEventListener('mousemove', handleLockedMouseMove);
    };
  }, [forwardAmigaMouse, inputCaptured, isMouseComputer]);

  const sendAmigaMouseClick = useCallback((button) => {
    if (!isMouseComputer) return;

    captureInput();
    addInputDebug(`Amiga mouse button ${button} pulse`, null, isHost ? 'host mouse' : 'guest mouse');
    forwardAmigaMouse({
      type: 'amiga_mouse_button',
      button,
      action: 'down',
    });
    window.setTimeout(() => {
      forwardAmigaMouse({
        type: 'amiga_mouse_button',
        button,
        action: 'up',
      });
    }, 140);
  }, [addInputDebug, captureInput, forwardAmigaMouse, isHost, isMouseComputer]);

  const setPartyTurn = useCallback((playerNumber) => {
    if (!isSharedCpcParty || !isHost) return;

    const nextPlayer = Math.min(partyMaxPlayers, Math.max(1, playerNumber));

    if (localJoystickMaskRef.current) {
      releaseCpcPartySharedInput(localJoystickMaskRef.current);
      localJoystickMaskRef.current = 0;
    }

    if (remoteJoystickMaskRef.current) {
      releaseCpcPartySharedInput(remoteJoystickMaskRef.current);
      remoteJoystickMaskRef.current = 0;
    }

    for (const peer of partyHostPeersRef.current.values()) {
      if (!peer.joystickMask) continue;
      releaseCpcPartySharedInput(peer.joystickMask);
      peer.joystickMask = 0;
    }

    releaseCpcPartySharedInput();
    setActivePartyPlayer(nextPlayer);
    sendSignalRef.current({
      type: 'party-turn',
      playerNumber: nextPlayer,
    });
    addInputDebug(`party turn switched to P${nextPlayer}`, 0, 'party turn');
    addLog(`Party turn switched to player ${nextPlayer}`);
  }, [addInputDebug, addLog, isHost, isSharedCpcParty, partyMaxPlayers, releaseCpcPartySharedInput]);

  const nextPartyTurn = useCallback(() => {
    setPartyTurn(activePartyPlayer >= partyMaxPlayers ? 1 : activePartyPlayer + 1);
  }, [activePartyPlayer, partyMaxPlayers, setPartyTurn]);

  useEffect(() => {
    if (!inputCaptured) {
      return undefined;
    }

    let animationFrame = 0;
    let lastMask = -1;

    function findGamepad(pads) {
      if (gamepadIndexRef.current !== null && pads[gamepadIndexRef.current]) {
        return pads[gamepadIndexRef.current];
      }

      const pad = pads.find(Boolean);
      if (pad) {
        gamepadIndexRef.current = pad.index;
      }

      return pad;
    }

    function pollGamepad() {
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      const pad = findGamepad(pads);

      if (pad) {
        // Suppress input while controller configuration is capturing
        if (controllerCapturingInput) {
          if (lastMask !== 0) {
            lastMask = 0;
            sendLocalJoystickMask(0);
          }
        } else {
          const mask = gamepadToJoystickMask(pad);

          if (mask !== lastMask) {
            lastMask = mask;
            sendLocalJoystickMask(mask);
          }
        }
      }

      animationFrame = requestAnimationFrame(pollGamepad);
    }

    pollGamepad();

    return () => {
      cancelAnimationFrame(animationFrame);
      sendLocalJoystickMask(0);
    };
  }, [controllerCapturingInput, inputCaptured, sendLocalJoystickMask]);

  useEffect(() => {
    function handleGamepadConnected(event) {
      gamepadIndexRef.current = event.gamepad.index;
      addLog(`Gamepad connected: ${event.gamepad.id}`);
    }

    function handleGamepadDisconnected(event) {
      if (gamepadIndexRef.current === event.gamepad.index) {
        gamepadIndexRef.current = null;
        sendLocalJoystickMask(0);
      }

      addLog('Gamepad disconnected');
    }

    window.addEventListener('gamepadconnected', handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnected);

    return () => {
      window.removeEventListener('gamepadconnected', handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnected);
    };
  }, [addLog, sendLocalJoystickMask]);

  useEffect(() => {
    if (isHost !== false || !inputCaptured) {
      return undefined;
    }

    const sendSnapshot = () => {
      const mask = localJoystickMaskRef.current;
      const channel = dataChannelRef.current;

      if (channel?.readyState !== 'open') return;

      inputSequenceRef.current += 1;
      channel.send(JSON.stringify({
        type: 'input_state',
        player: currentPartyPlayerNumber,
        sessionId: inputSessionIdRef.current,
        seq: inputSequenceRef.current,
        mask,
        ts: performance.now(),
      }));
    };

    const snapshotTimer = window.setInterval(sendSnapshot, 33);
    sendSnapshot();

    return () => {
      window.clearInterval(snapshotTimer);
    };
  }, [currentPartyPlayerNumber, inputCaptured, isHost]);

  useEffect(() => {
    if (isHost !== true) {
      return undefined;
    }

    const staleRemoteInputTimer = window.setInterval(() => {
      if (isMultiPeerParty) {
        for (const peer of partyHostPeersRef.current.values()) {
          if (!peer.joystickMask) continue;
          if (!peer.lastInputAt) continue;
          if (performance.now() - peer.lastInputAt < 180) continue;

          addInputDebug(`P${peer.playerNumber} input timed out, releasing held input`, 0, 'guest remote');
          if (isSharedCpcParty) {
            releaseCpcPartySharedInput(peer.joystickMask);
          } else {
            forwardInputToEmulator({
              type: 'amstrad_remote_joystick',
              player: peer.playerNumber,
              mask: 0,
            });
          }
          peer.joystickMask = 0;
        }
        return;
      }

      if (remoteJoystickMaskRef.current === 0) return;
      if (!lastRemoteInputAtRef.current) return;
      if (performance.now() - lastRemoteInputAtRef.current < 180) return;

      const previousMask = remoteJoystickMaskRef.current;

      addInputDebug('guest input timed out, releasing held input', 0, 'guest remote');
      if (isDirectJoystickSystem) {
        forwardInputToEmulator({
          type: 'amstrad_remote_joystick',
          player: 2,
          mask: 0,
        });
      } else {
        forwardJoystickMaskAsKeys(0, isSharedCpcParty ? 1 : 2, previousMask);
      }
      remoteJoystickMaskRef.current = 0;
    }, 90);

    return () => {
      window.clearInterval(staleRemoteInputTimer);
    };
  }, [addInputDebug, forwardInputToEmulator, forwardJoystickMaskAsKeys, isDirectJoystickSystem, isHost, isMultiPeerParty, isSharedCpcParty, releaseCpcPartySharedInput]);

  useEffect(() => {
    if (isHost !== true || isDirectJoystickSystem) {
      return undefined;
    }

    const pumpRemoteHeldKeys = window.setInterval(() => {
      if (isSharedCpcParty) {
        const activePeer = Array.from(partyHostPeersRef.current.values()).find((peer) => peer.playerNumber === activePartyPlayer);
        const mask = activePartyPlayer === 1 ? localJoystickMaskRef.current : activePeer?.joystickMask || 0;

        if (!mask) return;

        forwardInputToEmulator({
          type: 'amstrad_remote_joystick',
          player: 1,
          mask: mask & 31,
        });
        return;
      }

      const mask = remoteJoystickMaskRef.current;

      if (!mask) return;

      joystickMaskToKeys(mask, 2).forEach(([key, , active]) => {
        if (!active) return;

        forwardInputToEmulator({
          type: 'amstrad_remote_control',
          player: 2,
          key,
          action: 'down',
        });
      });
    }, 50);

    return () => {
      window.clearInterval(pumpRemoteHeldKeys);
    };
  }, [activePartyPlayer, forwardInputToEmulator, isDirectJoystickSystem, isHost, isSharedCpcParty]);

  useEffect(() => {
    if (isHost !== false) {
      return undefined;
    }

    function releaseGuestInput() {
      sendLocalJoystickMask(0);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        releaseGuestInput();
      }
    }

    window.addEventListener('blur', releaseGuestInput);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('blur', releaseGuestInput);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isHost, sendLocalJoystickMask]);

  const handleGuestPayloadOnHost = useCallback((rawMessage, partyPlayerOverride = null, partyPeerState = null) => {
    try {
      const parsed = JSON.parse(rawMessage);
      addInputDebug(`host received ${formatInputPayload(parsed)}`, parsed.mask ?? null, 'guest remote');

      const getRemoteMask = () => (partyPeerState ? partyPeerState.joystickMask || 0 : remoteJoystickMaskRef.current);
      const setRemoteMask = (mask) => {
        if (partyPeerState) {
          partyPeerState.joystickMask = mask;
        } else {
          remoteJoystickMaskRef.current = mask;
        }
      };
      const getLastSession = () => (partyPeerState ? partyPeerState.lastSession || '' : lastRemoteInputSessionRef.current);
      const setLastSession = (sessionId) => {
        if (partyPeerState) {
          partyPeerState.lastSession = sessionId;
        } else {
          lastRemoteInputSessionRef.current = sessionId;
        }
      };
      const getLastSeq = () => (partyPeerState ? partyPeerState.lastSeq || 0 : lastRemoteInputSeqRef.current);
      const setLastSeq = (seq) => {
        if (partyPeerState) {
          partyPeerState.lastSeq = seq;
        } else {
          lastRemoteInputSeqRef.current = seq;
        }
      };
      const markInputAt = () => {
        if (partyPeerState) {
          partyPeerState.lastInputAt = performance.now();
        } else {
          lastRemoteInputAtRef.current = performance.now();
        }
      };
      const getInputPlayer = (fallbackPlayer = parsed.player) => {
        if (partyPeerState) return partyPeerState.playerNumber || partyPlayerOverride || null;
        if (isSharedCpcParty) return partyPlayerOverride || 2;
        return fallbackPlayer;
      };

      if (parsed.type === 'arcade_join_queue' && partyPeerState?.guestId) {
        queueArcadePeer(partyPeerState.guestId, partyPeerState);
        return;
      }

      if (parsed.type === 'arcade_leave_queue' && partyPeerState?.guestId) {
        removeArcadePeerFromQueue(partyPeerState.guestId, partyPeerState);
        return;
      }

      if (parsed.type === 'arcade_release_slot' && partyPeerState?.guestId) {
        releaseArcadePlayer(partyPeerState.guestId);
        return;
      }

      if (isArcadeParty && partyPeerState && !partyPeerState.playerNumber && parsed.type !== 'audio_unlock') {
        addInputDebug(`ignored spectator ${parsed.type || 'input'}`, parsed.mask ?? null, 'spectator');
        return;
      }

      if (parsed.type === 'key') {
        const player = getInputPlayer(parsed.player);
        if (!player) return;

        if (isSharedCpcParty && activePartyPlayer !== player) {
          addInputDebug(`ignored guest key, party turn is P${activePartyPlayer}`, null, 'party turn');
          return;
        }

        addInputDebug(`forward to emulator ${formatInputPayload(parsed)}`);
        if (isAtari8) {
          forwardInputToEmulator({
            type: 'atari8_keyboard',
            action: parsed.action,
            key: parsed.key,
            code: parsed.code || '',
          });
          return;
        }

        forwardInputToEmulator({
          type: 'amstrad_remote_control',
          key: parsed.key,
          action: parsed.action,
          player: isSharedCpcParty ? 1 : player,
        });
      }

      if (parsed.type === 'control') {
        const player = getInputPlayer(parsed.player);
        if (!player) return;

        if (isSharedCpcParty && activePartyPlayer !== player) {
          addInputDebug(`ignored guest control, party turn is P${activePartyPlayer}`, null, 'party turn');
          return;
        }

        addInputDebug(`forward to emulator ${formatInputPayload(parsed)}`);
        forwardInputToEmulator({
          type: 'amstrad_remote_control',
          key: parsed.key,
          action: parsed.action,
          player: isSharedCpcParty ? 1 : player,
        });
      }

      if (parsed.type === 'audio_unlock') {
        addInputDebug('guest requested host audio unlock', null, 'guest remote');
        hostAudioGraphRef.current?.context?.resume?.().catch(() => {});
        forwardInputToEmulator({
          type: 'amstrad_audio_unlock',
        });
      }

      if (parsed.type === 'amiga_mouse_button' || parsed.type === 'amiga_mouse_move') {
        addInputDebug(`forward to emulator ${formatInputPayload(parsed)}`, null, 'guest mouse');
        forwardInputToEmulator(parsed);
      }

      if (parsed.type === 'input_state') {
        const player = getInputPlayer(parsed.player === 2 ? 2 : 1);
        if (!player) return;
        const mask = parsed.mask | 0;
        const seq = Number(parsed.seq) || 0;
        const sessionId = String(parsed.sessionId || 'legacy');

        if (sessionId !== getLastSession()) {
          const previousMask = getRemoteMask();

          if (previousMask) {
            if (isSharedCpcParty) {
              releaseCpcPartySharedInput(previousMask);
            } else if (isDirectJoystickSystem) {
              forwardInputToEmulator({
                type: 'amstrad_remote_joystick',
                player,
                mask: 0,
              });
            } else {
              forwardJoystickMaskAsKeys(0, player, previousMask);
            }
          }

          setLastSession(sessionId);
          setLastSeq(0);
          setRemoteMask(0);
          addInputDebug(`guest input session ${sessionId}`, 0, 'guest remote');
        }

        if (seq && seq <= getLastSeq()) {
          addInputDebug(`ignored old P${player} state #${seq}`, getRemoteMask(), 'guest remote');
          return;
        }

        const previousMask = getRemoteMask();

        setLastSeq(seq || getLastSeq());
        markInputAt();
        if (mask !== previousMask) {
          addInputDebug(`host received P${player} state ${mask} #${seq}`, mask, 'guest remote');
        }
        if (isSharedCpcParty && activePartyPlayer !== player) {
          if (previousMask) {
            releaseCpcPartySharedInput(previousMask);
          }
          setRemoteMask(0);
          addInputDebug(`ignored guest state, party turn is P${activePartyPlayer}`, 0, 'party turn');
          return;
        }

        if (isSharedCpcParty) {
          forwardInputToEmulator({
            type: 'amstrad_remote_joystick',
            player: 1,
            mask: mask & 31,
          });
          forwardExtraButtonAsKey(mask, 1, previousMask);
        } else if (isDirectJoystickSystem) {
          forwardInputToEmulator({
            type: 'amstrad_remote_joystick',
            player,
            mask,
          });
        } else {
          forwardJoystickMaskAsKeys(mask, isSharedCpcParty ? 1 : player, previousMask);
        }
        setRemoteMask(mask);
      }

      if (parsed.type === 'joystick') {
        const player = getInputPlayer(parsed.player === 2 ? 2 : 1);
        if (!player) return;
        const mask = parsed.mask | 0;
        const previousMask = getRemoteMask();

        markInputAt();
        addInputDebug(`host received P${player} held mask ${mask}`, mask, 'guest remote');
        if (isSharedCpcParty && activePartyPlayer !== player) {
          if (previousMask) {
            releaseCpcPartySharedInput(previousMask);
          }
          setRemoteMask(0);
          addInputDebug(`ignored guest held mask, party turn is P${activePartyPlayer}`, 0, 'party turn');
          return;
        }

        if (isSharedCpcParty) {
          forwardInputToEmulator({
            type: 'amstrad_remote_joystick',
            player: 1,
            mask: mask & 31,
          });
          forwardExtraButtonAsKey(mask, 1, previousMask);
        } else if (isDirectJoystickSystem) {
          forwardInputToEmulator({
            type: 'amstrad_remote_joystick',
            player,
            mask,
          });
        } else {
          forwardJoystickMaskAsKeys(mask, isSharedCpcParty ? 1 : player, previousMask);
        }
        setRemoteMask(mask);
      }
    } catch (err) {
      addLog(`Input parse error: ${err.message}`);
      addInputDebug(`parse error ${err.message}`);
    }
  }, [activePartyPlayer, addInputDebug, addLog, forwardExtraButtonAsKey, forwardInputToEmulator, forwardJoystickMaskAsKeys, isAtari8, isDirectJoystickSystem, isSharedCpcParty, releaseCpcPartySharedInput]);

  useEffect(() => {
    handleGuestPayloadOnHostRef.current = handleGuestPayloadOnHost;
  }, [handleGuestPayloadOnHost]);

  const onSignalMessage = useCallback(async (message) => {
    if (message.to && message.to !== signalingClientIdRef.current) {
      return;
    }

    if (message.type === 'system') {
      addLog(message.message);
      return;
    }

    if (message.type === 'room-chat') {
      setChatMessages((items) => [...items.slice(-99), {
        id: message.id || `${Date.now()}-${Math.random()}`,
        username: message.username || 'Player',
        message: String(message.message || '').slice(0, 300),
        time: message.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        mine: false,
      }]);
      return;
    }

    if (message.type === 'room-system-changed' && message.room) {
      applyRoomSystemUpdate(message.room, `${message.username || 'Host'} switched the room`);
      setLocalGamePickerOpen(false);
      return;
    }

    if (message.type === 'arcade-mode-changed' && message.room) {
      setRoom(message.room);
      setStatus(message.room.arcade_multiplayer ? 'Multiplayer cabinet opened' : 'Cabinet switched to single player');
      setRoomSessionKey((key) => key + 1);
      return;
    }

    if (message.type === 'party-room-full') {
      setStatus('Party room full');
      setError('This party room has no free live player slots.');
      addLog('Party room full');
      return;
    }

    if (message.type === 'party-assigned') {
      setPartyPlayerNumber(message.playerNumber || null);
      setArcadeQueueStatus({
        queued: false,
        queuePosition: null,
        role: message.playerNumber ? `P${message.playerNumber}` : 'Spectator',
      });
      addLog(message.playerNumber ? `Assigned party player P${message.playerNumber}` : 'Moved to spectator');
      return;
    }

    if (message.type === 'party-spectator') {
      setPartyPlayerNumber(null);
      setArcadeQueueStatus({
        queued: false,
        queuePosition: null,
        role: 'Spectator',
      });
      addLog('Joined as spectator');
      return;
    }

    if (message.type === 'party-turn') {
      setActivePartyPlayer(message.playerNumber || 1);
      addInputDebug(`party turn is P${message.playerNumber || 1}`, 0, 'party turn');
      return;
    }

    if (isHost && isMultiPeerParty) {
      if (message.type === 'peer-ready' && message.role === 'guest') {
        await createPartyPeerForGuest(message);
        return;
      }

      if (message.type === 'answer') {
        const peer = partyHostPeersRef.current.get(message.from);
        if (!peer) {
          addLog('Ignored party answer from unknown guest');
          return;
        }

        await peer.pc.setRemoteDescription(message.answer);

        const candidates = peer.pendingIceCandidates;
        peer.pendingIceCandidates = [];
        for (const candidate of candidates) {
          try {
            await peer.pc.addIceCandidate(candidate);
            addLog(`Added queued ICE candidate for P${peer.playerNumber}`);
          } catch (err) {
            addLog(`Party ICE error: ${err.message}`);
          }
        }

        addLog(`Received answer from P${peer.playerNumber}`);
        return;
      }

      if (message.type === 'ice-candidate' && message.candidate) {
        const peer = partyHostPeersRef.current.get(message.from);
        if (!peer) {
          addLog('Ignored party ICE from unknown guest');
          return;
        }

        if (!peer.pc.remoteDescription) {
          peer.pendingIceCandidates.push(message.candidate);
          addLog(`Queued ICE candidate for P${peer.playerNumber}`);
          return;
        }

        try {
          await peer.pc.addIceCandidate(message.candidate);
          addLog(`Added ICE candidate for P${peer.playerNumber}`);
        } catch (err) {
          addLog(`Party ICE error: ${err.message}`);
        }
        return;
      }

      return;
    }

    if (message.type === 'peer-ready') {
      if (message.role === 'host') {
        setHostDisplayName(message.username || 'Host');
      }

      if (message.role === 'guest') {
        setGuestDisplayName(message.username || 'Guest');
      }
    }

    const pc = pcRef.current;

    if (!pc) {
      addLog('Signal received before peer connection existed');
      return;
    }

    async function flushPendingIceCandidates() {
      if (!pc.remoteDescription) return;
      if (pendingIceCandidatesRef.current.length === 0) return;

      const candidates = pendingIceCandidatesRef.current;
      pendingIceCandidatesRef.current = [];

      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(candidate);
          addLog('Added queued ICE candidate');
        } catch (err) {
          addLog(`ICE error: ${err.message}`);
        }
      }
    }

    if (message.type === 'peer-ready') {
      if (isHost && message.role === 'guest') {
        if (!activeGuestSignalIdRef.current && message.from) {
          activeGuestSignalIdRef.current = message.from;
          activePeerSignalIdRef.current = message.from;
          addLog(`Live guest slot assigned to ${message.username || 'guest'}`);
        }

        if (activeGuestSignalIdRef.current && message.from && message.from !== activeGuestSignalIdRef.current) {
          sendSignalRef.current({
            type: 'live-slot-taken',
            to: message.from,
          });
          addLog(`Ignored extra guest ${message.username || message.from}`);
          return;
        }
      }

      if (isHost && localOfferRef.current && (!activeGuestSignalIdRef.current || message.from === activeGuestSignalIdRef.current)) {
        const sent = sendSignalRef.current({
          type: 'offer',
          to: activeGuestSignalIdRef.current || undefined,
          offer: localOfferRef.current,
        });

        addLog(sent ? 'Re-sent offer to ready guest' : 'Queued offer for ready guest');
      }

      return;
    }

    if (message.type === 'offer') {
      addLog('Received offer');
      if (message.from) {
        activePeerSignalIdRef.current = message.from;
      }

      if (pc.remoteDescription?.type === 'offer' && pc.remoteDescription.sdp === message.offer?.sdp) {
        addLog('Ignored duplicate offer');
        return;
      }

      if (pc.signalingState !== 'stable') {
        addLog(`Ignored offer while ${pc.signalingState}`);
        return;
      }

      await pc.setRemoteDescription(message.offer);
      await flushPendingIceCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGatheringComplete(pc);

      sendSignalRef.current({
        type: 'answer',
        to: message.from || undefined,
        answer: pc.localDescription,
      });

      addLog('Sent answer');
      setStatus('Answer sent');

      if (micRenegotiationNeededRef.current && pc.signalingState === 'stable') {
        micRenegotiationNeededRef.current = false;
        await renegotiatePeerConnection('Microphone');
      }
      return;
    }

    if (message.type === 'answer') {
      if (isHost && activeGuestSignalIdRef.current && message.from && message.from !== activeGuestSignalIdRef.current) {
        addLog('Ignored answer from extra guest');
        return;
      }

      addLog('Received answer');
      if (message.from) {
        activePeerSignalIdRef.current = message.from;
      }

      if (pc.signalingState !== 'have-local-offer') {
        addLog(`Ignored answer while ${pc.signalingState}`);
        return;
      }

      await pc.setRemoteDescription(message.answer);
      await flushPendingIceCandidates();
      setStatus('Peer connected');

      if (micRenegotiationNeededRef.current && pc.signalingState === 'stable') {
        micRenegotiationNeededRef.current = false;
        await renegotiatePeerConnection('microphone');
      }
      return;
    }

    if (message.type === 'ice-candidate' && message.candidate) {
      if (isHost && activeGuestSignalIdRef.current && message.from && message.from !== activeGuestSignalIdRef.current) {
        addLog('Ignored ICE candidate from extra guest');
        return;
      }

      if (!pc.remoteDescription) {
        pendingIceCandidatesRef.current.push(message.candidate);
        addLog('Queued ICE candidate until remote description');
        return;
      }

      try {
        await pc.addIceCandidate(message.candidate);
        addLog('Added ICE candidate');
      } catch (err) {
        addLog(`ICE error: ${err.message}`);
      }
    }
  }, [addLog, isHost, isMultiPeerParty, partyMaxPlayers]);

  const { send: sendSignal, isOpen: signalingOpen } = useSignaling(isSoloMode ? null : roomCode, onSignalMessage, signalingClientIdRef.current);

  function sendChatMessage(message) {
    if (!signalingOpen || isSoloMode) return;
    const chatMessage = {
      type: 'room-chat',
      id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      username: username || 'Player',
      message,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    sendSignal(chatMessage);
    setChatMessages((items) => [...items.slice(-99), { ...chatMessage, mine: true }]);
  }

  async function switchRoomSystem() {
    if (!room || !isHost || isSoloMode || switchingSystem || selectedRoomSystem === roomSystem) return;

    setSwitchingSystem(true);
    try {
      setError('');
      const nextPartyMax = selectedRoomSystem === 'cpc_party'
        ? Math.max(3, partyMaxPlayers || 4)
        : selectedRoomSystem === 'arcade'
          ? partyMaxPlayers || 2
          : 2;
      const nextRoom = await apiFetch(`/rooms/${roomCode}`, {
        method: 'PATCH',
        body: JSON.stringify({
          system: selectedRoomSystem,
          party_max_players: nextPartyMax,
        }),
      });

      applyRoomSystemUpdate(nextRoom, 'Room switched');
      localLibraryLoadAttemptedRef.current = false;
      setLocalGameSearch('');
      setLocalGamePickerOpen(true);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('localGame');
      nextParams.delete('mode');
      const query = nextParams.toString();
      navigate(`/room/${roomCode}${query ? `?${query}` : ''}`, { replace: true });
      sendSignal({
        type: 'room-system-changed',
        username: username || 'Host',
        room: nextRoom,
      });
    } catch (err) {
      setError(err.message);
      addLog(`Room switch failed: ${err.message}`);
    } finally {
      setSwitchingSystem(false);
    }
  }

  const displayedPlayers = isSoloMode
    ? [
      {
        playerNumber: 1,
        username: username || playerOneName,
        role: 'Solo',
        connected: true,
      },
    ]
    : isArcadeParty && !isHost
    ? [
      {
        playerNumber: partyPlayerNumber || 'spectator',
        username: username || playerTwoName,
        role: partyPlayerNumber ? `P${partyPlayerNumber}` : arcadeQueueStatus.queued ? `Queue #${arcadeQueueStatus.queuePosition || '?'}` : 'Spectator',
        connected: guestPrepared,
      },
    ]
    : isMultiPeerParty
    ? partyRoster
    : [
      {
        playerNumber: 1,
        username: playerOneName,
        role: 'Host',
        connected: Boolean(hostDisplayName),
      },
      {
        playerNumber: 2,
        username: playerTwoName,
        role: 'Guest',
        connected: Boolean(guestDisplayName),
      },
    ];
  const healthItems = isAmigaLink
    ? [
      {
        label: 'Signaling',
        ok: signalingOpen,
      },
      {
        label: 'Serial link',
        ok: serialChannelRef.current?.readyState === 'open',
      },
      {
        label: 'Local Amiga',
        ok: hostStarted,
      },
    ]
    : isSoloMode
    ? [
      {
        label: 'Local mode',
        ok: true,
      },
      {
        label: 'Emulator',
        ok: hostStarted,
      },
    ]
    : [
      {
        label: 'Signaling',
        ok: signalingOpen,
      },
      {
        label: isMultiPeerParty ? 'Players' : 'Peer',
        ok: remoteConnected,
      },
      {
        label: isHost ? 'Host stream' : 'Guest link',
        ok: isHost ? hostStarted : guestPrepared,
      },
    ];
  const selectedControlPlayers = useMemo(() => {
    if (!selectedControlProfile?.players) return [];

    return Object.entries(selectedControlProfile.players).map(([playerKey, player]) => {
      const emulatorInput = player?.emulatorInput || {};
      const displayOverlay = player?.displayOverlay || {};
      const directionEntries = CONTROL_DIRECTIONS.map(([action, label]) => ({
        action,
        label,
        key: formatControlValue(emulatorInput[action]),
        detail: displayOverlay[action] || '',
      }));
      const utilityEntries = CONTROL_UTILITY_ACTIONS
        .filter((action) => emulatorInput[action] || displayOverlay[action])
        .map((action) => ({
          action,
          label: formatControlAction(action),
          key: formatControlValue(emulatorInput[action]),
          detail: displayOverlay[action] || '',
        }));
      const overlayEntries = Object.entries(displayOverlay)
        .filter(([action, value]) => value && !CONTROL_DIRECTIONS.some(([direction]) => direction === action) && !CONTROL_UTILITY_ACTIONS.includes(action))
        .map(([action, value]) => [formatControlAction(action), value]);

      return {
        key: playerKey,
        label: playerKey.replace('player', 'Player '),
        directionEntries,
        utilityEntries,
        overlayEntries,
        hasInput: directionEntries.some((entry) => entry.key || entry.detail) || utilityEntries.length || overlayEntries.length,
      };
    });
  }, [selectedControlProfile]);

  useEffect(() => {
    sendSignalRef.current = sendSignal;
  }, [sendSignal]);

  useEffect(() => {
    loadedDiskNameRef.current = loadedDiskName;
    if (!room || !isHost) return;

    apiFetch(`/rooms/${roomCode}/heartbeat`, {
      method: 'POST',
      body: JSON.stringify({ game_name: loadedDiskName || null }),
    }).catch(() => {});
  }, [isHost, loadedDiskName, room, roomCode]);

  useEffect(() => {
    if (!isArcade || !loadedDiskName) {
      setMameLeaderboard([]);
      setMameLeaderboardSupported(false);
      mameScoreBaselineRef.current = null;
      return;
    }

    mameScoreBaselineRef.current = null;
    tournamentScoreArmedAtRef.current = tournamentCode ? Date.now() + 30000 : 0;
    refreshMameLeaderboard(loadedDiskName);
    if (!supportsMameScoreboard || !isHost) return undefined;

    const timer = window.setTimeout(() => {
      captureMameScoreBaseline(loadedDiskName).catch((err) => {
        addLog(`MAME score baseline failed: ${err.message}`);
      });
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [addLog, isArcade, isHost, loadedDiskName, supportsMameScoreboard]);

  useEffect(() => {
    amigaScoreBaselineRef.current = null;
    setAmigaScoreGame(null);
    if (!isPuaeAmiga || !loadedDiskName) {
      setAmigaLeaderboard([]);
      setAmigaScoreStatus('');
      return undefined;
    }

    let cancelled = false;
    apiFetch(`/scores/amiga/games/resolve?title=${encodeURIComponent(loadedDiskName)}`)
      .then((metadata) => {
        if (!cancelled) setAmigaScoreGame(metadata);
      })
      .catch(() => {
        if (!cancelled) {
          setAmigaLeaderboard([]);
          setAmigaScoreStatus('');
        }
      });
    return () => { cancelled = true; };
  }, [isPuaeAmiga, loadedDiskName]);

  useEffect(() => {
    amigaScoreBaselineRef.current = null;
    if (!supportsAmigaScoreboard) return undefined;

    refreshAmigaLeaderboard();
    if (!isHost) return undefined;

    let cancelled = false;
    const initialise = async () => {
      try {
        const captured = await captureAmigaScoreBaseline();
        if (!cancelled && !captured) setAmigaScoreStatus(`Waiting for ${amigaScoreGame.title} score table...`);
      } catch (err) {
        if (!cancelled) setAmigaScoreStatus(`Could not read the ${amigaScoreGame.title} score table yet.`);
        addLog(`Amiga score baseline failed: ${err.message}`);
      }
    };
    const startTimer = window.setTimeout(initialise, 3000);
    const pollTimer = window.setInterval(() => {
      if (!cancelled) submitAmigaScoreExtraction('automatic').catch((err) => {
        addLog(`Automatic Amiga score extraction failed: ${err.message}`);
      });
    }, 12000);
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      window.clearInterval(pollTimer);
    };
  }, [addLog, amigaScoreGame, isHost, roomSessionKey, supportsAmigaScoreboard]);

  useEffect(() => {
    if (
      !mameScoreChangeToken
      || mameScoreChangeToken <= mameScoreProcessedTokenRef.current
      || !isArcade
      || !isHost
      || !supportsMameScoreboard
      || !mameLeaderboardSupported
      || mameScoreBusy
    ) return undefined;

    setMameScoreStatus('New score data detected...');
    const timer = window.setTimeout(async () => {
      setMameScoreBusy(true);
      try {
        await submitMameScoreExtraction('automatic');
        mameScoreProcessedTokenRef.current = mameScoreChangeToken;
      } catch (err) {
        setMameScoreStatus('Automatic score check failed. You can still save it manually.');
        addLog(`Automatic MAME score extraction failed: ${err.message}`);
      } finally {
        setMameScoreBusy(false);
      }
    }, 4000);

    return () => window.clearTimeout(timer);
  }, [
    addLog,
    isArcade,
    isHost,
    mameLeaderboardSupported,
    mameScoreBusy,
    mameScoreChangeToken,
    supportsMameScoreboard,
  ]);

  useEffect(() => {
    async function loadRoom() {
      try {
        const data = await apiFetch(`/rooms/${roomCode}`);
        setRoom(data);
        setStatus('Room ready');
      } catch (err) {
        setError(err.message);
      }
    }

    loadRoom();
  }, [roomCode]);

  useEffect(() => {
    if (!room) return undefined;

    let cancelled = false;
    const sendHeartbeat = async () => {
      try {
        await apiFetch(`/rooms/${roomCode}/heartbeat`, {
          method: 'POST',
          body: JSON.stringify({
            game_name: isHost ? loadedDiskNameRef.current || null : null,
          }),
        });
      } catch (err) {
        if (!cancelled) {
          addLog(`Room activity update failed: ${err.message}`);
        }
      }
    };

    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      apiFetch(`/rooms/${roomCode}/heartbeat`, { method: 'DELETE' }).catch(() => {});
    };
  }, [addLog, isHost, room, roomCode]);

  useEffect(() => {
    if (!isSoloMode && signalingOpen) {
      addLog('Signaling socket open');
    }
  }, [isSoloMode, signalingOpen, addLog]);

  useEffect(() => {
    if (isSoloMode || !signalingOpen || !room) {
      return;
    }

    sendSignal({
      type: 'peer-ready',
      role: isHost ? 'host' : 'guest',
      username,
    });
  }, [isHost, isSoloMode, room, roomSessionKey, sendSignal, signalingOpen, username]);

  useEffect(() => {
    if (isSoloMode) {
      pcRef.current = null;
      return () => {
        stopMirrorLoop();
        cleanupHostAudioGraph({ stopInput: true });

        localMicStreamRef.current?.getTracks().forEach((track) => track.stop());
        localMicStreamRef.current = null;
        localMicSenderRef.current = null;
        hostVideoStreamRef.current = null;
        hostAudioStreamRef.current = null;
        hostRawAudioStreamRef.current = null;
        dataChannelRef.current?.close();
      };
    }

    const pc = new RTCPeerConnection(buildRtcConfig());
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const sent = sendSignalRef.current({
          type: 'ice-candidate',
          to: isHostRef.current ? activeGuestSignalIdRef.current || undefined : activePeerSignalIdRef.current || undefined,
          candidate: event.candidate,
        });

        addLog(sent ? 'Sent ICE candidate' : 'Queued ICE candidate');
      }
    };

    pc.onconnectionstatechange = () => {
      setStatus(`Connection state: ${pc.connectionState}`);
      addLog(`PC state: ${pc.connectionState}`);

      if (pc.connectionState === 'connected') {
        setRemoteConnected(true);
      }

      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        setRemoteConnected(false);
        if (isHostRef.current && !isMultiPeerParty) {
          activeGuestSignalIdRef.current = '';
          activePeerSignalIdRef.current = '';
          pendingIceCandidatesRef.current = [];
          localOfferRef.current = null;
          setGuestDisplayName('');
          setGuestPrepared(false);
          guestPreparedRef.current = false;
          if (pc.connectionState === 'failed') {
            pcRef.current?.close();
            pcRef.current = null;
            setHostStarted(false);
            hostStartedRef.current = false;
            hostStartingRef.current = false;
            setRoomSessionKey((key) => key + 1);
            setStatus('Guest left. Start host session again when the next player joins.');
          }
        }
      }
    };

    pc.ontrack = (event) => {
      if (event.track.kind === 'audio' && isHostRef.current) {
        if (!remoteVoiceStreamRef.current) {
          remoteVoiceStreamRef.current = new MediaStream();
        }

        const voiceStream = remoteVoiceStreamRef.current;
        const hasVoiceTrack = voiceStream.getTracks().some((track) => track.id === event.track.id);

        if (!hasVoiceTrack) {
          voiceStream.addTrack(event.track);
        }

        if (remoteVoiceAudioRef.current && remoteVoiceAudioRef.current.srcObject !== voiceStream) {
          remoteVoiceAudioRef.current.srcObject = voiceStream;
          remoteVoiceAudioRef.current.volume = 1;
          remoteVoiceAudioRef.current.play().catch(() => {
            addLog('Guest mic is connected; press Capture if audio is blocked');
          });
        }

        addLog('Remote microphone track attached');
        return;
      }

      if (!remoteMediaStreamRef.current) {
        remoteMediaStreamRef.current = new MediaStream();
      }

      const remoteStream = remoteMediaStreamRef.current;
      const hasTrack = remoteStream.getTracks().some((track) => track.id === event.track.id);

      if (!hasTrack) {
        remoteStream.addTrack(event.track);
      }

      if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
      }

      playRemoteVideo();
      addLog(`Remote ${event.track.kind} track attached`);
    };

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (isAmigaLink && channel.label === 'amiga-serial') {
        configureSerialChannel(channel);
        return;
      }

      dataChannelRef.current = channel;

      channel.onopen = () => {
        lastRemoteInputSessionRef.current = '';
        lastRemoteInputSeqRef.current = 0;
        lastRemoteInputAtRef.current = 0;
        remoteJoystickMaskRef.current = 0;
        addLog('Input data channel open');
      };
      channel.onmessage = (msg) => {
        if (isHostRef.current) {
          handleGuestPayloadOnHostRef.current?.(msg.data);
        } else {
          handleHostDataMessage(msg.data);
        }
      };
    };

    return () => {
      stopMirrorLoop();
      cleanupHostAudioGraph({ stopInput: true });

      localMicStreamRef.current?.getTracks().forEach((track) => track.stop());
      localMicStreamRef.current = null;
      localMicSenderRef.current = null;
      remoteVoiceAudioRef.current?.pause();
      remoteVoiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteVoiceStreamRef.current = null;
      for (const [guestId] of partyHostPeersRef.current) {
        closePartyPeer(guestId);
      }
      partyHostPeersRef.current.clear();
      pendingPartyGuestsRef.current.clear();
      hostVideoStreamRef.current = null;
      hostAudioStreamRef.current = null;
      hostRawAudioStreamRef.current = null;
      dataChannelRef.current?.close();
      serialChannelRef.current?.close();
      serialChannelRef.current = null;
      serialOfferStartedRef.current = false;
      pc.close();
    };
  }, [addLog, configureSerialChannel, handleHostDataMessage, isAmigaLink, isMultiPeerParty, isSoloMode, roomSessionKey]);

  useEffect(() => {
    if (!isAmigaLink || !isHost || !signalingOpen || !room || serialOfferStartedRef.current) return;

    const pc = pcRef.current;
    if (!pc) return;

    serialOfferStartedRef.current = true;
    const channel = pc.createDataChannel('amiga-serial');
    configureSerialChannel(channel);

    async function createSerialOffer() {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGatheringComplete(pc);
        localOfferRef.current = pc.localDescription;
        const sent = sendSignalRef.current({
          type: 'offer',
          to: activeGuestSignalIdRef.current || undefined,
          offer: localOfferRef.current,
        });
        addLog(sent ? 'Amiga serial offer sent' : 'Amiga serial offer queued');
        setStatus('Waiting for linked Amiga');
      } catch (err) {
        serialOfferStartedRef.current = false;
        setError(err.message);
        addLog(`Amiga serial link error: ${err.message}`);
      }
    }

    createSerialOffer();
  }, [addLog, configureSerialChannel, isAmigaLink, isHost, room, signalingOpen]);

  useEffect(() => {
    if (!canControlLocalEmulator) return undefined;

    function handleHostKeyDown(event) {
      if (!shouldHandleHostKey(event)) return;

      const key = getKeyboardKey(event);
      if (isAmigaFamily) {
        if (event.repeat) {
          event.preventDefault();
          return;
        }

        addInputDebug(`host Amiga key ${event.code} down`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'amiga_keyboard',
          player: 1,
          code: event.code,
          key: event.key,
          action: 'down',
        });

        event.preventDefault();
        return;
      }

      if (isAtari8) {
        if (event.repeat) {
          event.preventDefault();
          return;
        }

        addInputDebug(`host Atari key ${event.code} down`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'atari8_keyboard',
          action: 'down',
          key: event.key,
          code: event.code,
        });

        event.preventDefault();
        return;
      }

      const mappedKey = hostKeyToCpcKeyboardKey(key);

      if (mappedKey || isMenuKey(key)) {
        if (isSharedCpcParty && activePartyPlayer !== 1) {
          addInputDebug(`ignored host key, party turn is P${activePartyPlayer}`, null, 'party turn');
          event.preventDefault();
          return;
        }

        addInputDebug(`host key ${key} down -> ${mappedKey || key}`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'amstrad_remote_control',
          player: 1,
          key: mappedKey || key,
          action: 'down',
        });

        event.preventDefault();
      }
    }

    function handleHostKeyUp(event) {
      if (!shouldHandleHostKey(event)) return;

      const key = getKeyboardKey(event);
      if (isAmigaFamily) {
        addInputDebug(`host Amiga key ${event.code} up`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'amiga_keyboard',
          player: 1,
          code: event.code,
          key: event.key,
          action: 'up',
        });

        event.preventDefault();
        return;
      }

      if (isAtari8) {
        addInputDebug(`host Atari key ${event.code} up`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'atari8_keyboard',
          action: 'up',
          key: event.key,
          code: event.code,
        });

        event.preventDefault();
        return;
      }

      const mappedKey = hostKeyToCpcKeyboardKey(key);

      if (mappedKey || isMenuKey(key)) {
        if (isSharedCpcParty && activePartyPlayer !== 1) {
          event.preventDefault();
          return;
        }

        addInputDebug(`host key ${key} up -> ${mappedKey || key}`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'amstrad_remote_control',
          player: 1,
          key: mappedKey || key,
          action: 'up',
        });

        event.preventDefault();
      }
    }

    window.addEventListener('keydown', handleHostKeyDown, true);
    window.addEventListener('keyup', handleHostKeyUp, true);

    return () => {
      window.removeEventListener('keydown', handleHostKeyDown, true);
      window.removeEventListener('keyup', handleHostKeyUp, true);
    };
  }, [activePartyPlayer, addInputDebug, canControlLocalEmulator, forwardInputToEmulator, isAmigaFamily, isAtari8, isHost, isSharedCpcParty]);

  useEffect(() => {
    if (isHost !== false || isAmigaLink) return undefined;

    let guestJoystickMask = 0;

    function sendToHost(payload) {
      const channel = dataChannelRef.current;

      if (!channel || channel.readyState !== 'open') {
        return false;
      }

      channel.send(JSON.stringify(payload));
      return true;
    }

    function handleGuestKeyDown(event) {
      if (!shouldHandleKey(event)) return;
      if (!inputCaptured) return;

      const key = getKeyboardKey(event);
      const joyBit = keyToJoystickBit(key);

      if (joyBit) {
        if (event.repeat) {
          addInputDebug(`ignored repeat ${key}`, guestJoystickMask, 'guest keyboard');
          event.preventDefault();
          return;
        }

        guestJoystickMask |= joyBit;
        addInputDebug(`guest key ${key} down`, guestJoystickMask, 'guest keyboard');

        sendLocalJoystickMask(guestJoystickMask);

        event.preventDefault();
        return;
      }

      if (isGuestKeyboardKey(key)) {
        const payload = {
          type: 'key',
          player: 2,
          key,
          code: event.code,
          action: 'down',
        };

        addInputDebug(`guest send ${formatInputPayload(payload)}`);
        sendToHost(payload);

        event.preventDefault();
      }
    }

    function handleGuestKeyUp(event) {
      if (!shouldHandleKey(event)) return;
      if (!inputCaptured) return;

      const key = getKeyboardKey(event);
      const joyBit = keyToJoystickBit(key);

      if (joyBit) {
        guestJoystickMask &= ~joyBit;
        addInputDebug(`guest key ${key} up`, guestJoystickMask, 'guest keyboard');

        sendLocalJoystickMask(guestJoystickMask);

        event.preventDefault();
        return;
      }

      if (isGuestKeyboardKey(key)) {
        const payload = {
          type: 'key',
          player: 2,
          key,
          code: event.code,
          action: 'up',
        };

        addInputDebug(`guest send ${formatInputPayload(payload)}`);
        sendToHost(payload);

        event.preventDefault();
      }
    }

    window.addEventListener('keydown', handleGuestKeyDown);
    window.addEventListener('keyup', handleGuestKeyUp);

    return () => {
      window.removeEventListener('keydown', handleGuestKeyDown);
      window.removeEventListener('keyup', handleGuestKeyUp);
    };
  }, [addInputDebug, isAmigaLink, isHost, inputCaptured, sendLocalJoystickMask]);

  function startMirrorLoop(sourceCanvas) {
    const mirrorCanvas = mirrorCanvasRef.current;

    if (!mirrorCanvas) {
      throw new Error('Mirror canvas not found');
    }

    stopMirrorLoop();

    if (isArcade) {
      mirrorCanvas.width = 768;
      mirrorCanvas.height = 576;
    } else if (isMasterSystem) {
      // Genesis Plus GX leaves a 16px doubled overscan strip before the
      // Master System's 512x384 picture. Crop that strip and the unused
      // right/bottom framebuffer padding so the game fills the room screen.
      // the room screen instead of appearing as a small picture in black.
      mirrorCanvas.width = 512;
      mirrorCanvas.height = 384;
    } else if (isCpcSystem) {
      // CPCBox renders double-height CPC pixels into a 768x272 framebuffer.
      // Restore their display aspect in the room mirror and outgoing stream.
      mirrorCanvas.width = 768;
      mirrorCanvas.height = 544;
    } else {
      mirrorCanvas.width = sourceCanvas.width || 768;
      mirrorCanvas.height = sourceCanvas.height || 544;
    }

    const ctx = mirrorCanvas.getContext('2d');

    if (!ctx) {
      throw new Error('Could not get mirror canvas context');
    }

    ctx.imageSmoothingEnabled = false;

    function drawContained(sourceX, sourceY, sourceWidth, sourceHeight) {
      const scale = Math.min(mirrorCanvas.width / sourceWidth, mirrorCanvas.height / sourceHeight);
      const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
      const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
      const targetX = Math.round((mirrorCanvas.width - targetWidth) / 2);
      const targetY = Math.round((mirrorCanvas.height - targetHeight) / 2);

      ctx.clearRect(0, 0, mirrorCanvas.width, mirrorCanvas.height);
      ctx.drawImage(
        sourceCanvas,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        targetX,
        targetY,
        targetWidth,
        targetHeight,
      );
    }

    const requestCapturedFrame = () => {
      if (isArcade) return;
      mirrorCaptureTrackRef.current?.requestFrame?.();
    };

    const drawOnce = () => {
      try {
        const sourceWidth = sourceCanvas.width || sourceCanvas.clientWidth;
        const sourceHeight = sourceCanvas.height || sourceCanvas.clientHeight;
        if (!sourceWidth || !sourceHeight) {
          return false;
        }

        if (isArcade) {
          drawContained(0, 0, sourceWidth, sourceHeight);
        } else if (isMasterSystem && sourceWidth >= 640 && sourceHeight >= 480) {
          ctx.drawImage(sourceCanvas, 16, 0, 512, 384, 0, 0, mirrorCanvas.width, mirrorCanvas.height);
        } else {
          ctx.drawImage(sourceCanvas, 0, 0, mirrorCanvas.width, mirrorCanvas.height);
        }
        requestCapturedFrame();
        return true;
      } catch {
        // ignore transient draw issues
        return false;
      }
    };

    const draw = () => {
      drawOnce();

      mirrorLoopRef.current = requestAnimationFrame(draw);
    };

    draw();
    mirrorKeepaliveTimerRef.current = window.setInterval(() => {
      if (document.visibilityState === 'hidden' || !document.hasFocus()) {
        drawOnce();
      }
    }, 250);
    addLog('Mirror canvas loop started');
  }

  function findCanvasInDocument(doc, depth = 0) {
    if (!doc || depth > 3) return null;

    if (isDiscConsole) {
      const nativeDiscCanvas = doc.querySelector('#game canvas');
      if (
        nativeDiscCanvas
        && nativeDiscCanvas.width > 0
        && nativeDiscCanvas.height > 0
      ) {
        return nativeDiscCanvas;
      }
    }

    if (isAtariSt) {
      const nativeAtariCanvas = doc.querySelector('#game canvas');
      if (
        nativeAtariCanvas
        && nativeAtariCanvas.width > 0
        && nativeAtariCanvas.height > 0
      ) {
        return nativeAtariCanvas;
      }
    }

    const frames = Array.from(doc.querySelectorAll('iframe'));
    for (const frame of frames) {
      try {
        const nestedDoc = frame.contentDocument || frame.contentWindow?.document;
        const nestedCanvas = findCanvasInDocument(nestedDoc, depth + 1);
        if (nestedCanvas) return nestedCanvas;
      } catch {
        // Cross-origin frames cannot be captured into our mirror canvas.
      }
    }

    const canvases = Array.from(doc.querySelectorAll('canvas'));
    const canvas = canvases.find((candidate) => (
      candidate.id !== 'placeholder-canvas'
      && (!isAtariSt || candidate.id !== 'atarist-screen')
      && (!isArcade || candidate.id !== 'arcade-screen')
      && candidate.dataset.ignoreCapture !== 'true'
      && candidate.width > 0
      && candidate.height > 0
    ));

    if (canvas) return canvas;

    return null;
  }

  async function waitForEmulatorCanvas(iframe) {
    const startedAt = Date.now();
    const canvasTimeout = isAmigaFamily ? 30000 : 8000;

    while (Date.now() - startedAt < canvasTimeout) {
      const iframeDocument = iframe.contentDocument || iframe.contentWindow?.document;
      const emulatorCanvas = findCanvasInDocument(iframeDocument);

      if (emulatorCanvas) {
        return emulatorCanvas;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }

    throw new Error('Could not find emulator canvas in iframe');
  }

  function getHostAudioStream(iframe) {
    if (isPuaeAmiga) return iframe.contentWindow?.getAmigaAgaAudioStream?.() || null;
    if (isAmigaLink) return iframe.contentWindow?.getAmigaAudioStream?.() || null;
    if (isSegaConsole) return iframe.contentWindow?.getMegaDriveAudioStream?.() || null;
    if (isNes) return iframe.contentWindow?.getNesAudioStream?.() || null;
    if (isSnes) return iframe.contentWindow?.getSnesAudioStream?.() || null;
    if (isPcEngine || isX68000) return iframe.contentWindow?.getPcEngineAudioStream?.() || null;
    if (isDiscConsole) return iframe.contentWindow?.[isSaturn ? 'getSaturnAudioStream' : 'getPlayStationAudioStream']?.() || null;
    if (isC64) return iframe.contentWindow?.getC64AudioStream?.() || null;
    if (isAtari8) return null;
    if (isAtariSt) return iframe.contentWindow?.getAtariStAudioStream?.() || null;
    if (isArcade) return iframe.contentWindow?.getArcadeAudioStream?.() || null;
    if (isSpectrum) return iframe.contentWindow?.getSpectrumAudioStream?.() || null;
    return iframe.contentWindow?.getAmstradAudioStream?.() || null;
  }

  async function waitForHostAudioStream(iframe) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 3000) {
      const audioStream = getHostAudioStream(iframe);

      if (audioStream?.getAudioTracks?.().length > 0) {
        return audioStream;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }

    return getHostAudioStream(iframe);
  }

  function getNextPartyPlayerNumber() {
    const usedPlayers = new Set(
      Array.from(partyHostPeersRef.current.values())
        .map((peer) => peer.playerNumber)
        .filter(Boolean),
    );

    const finalPlayerNumber = isArcadeParty ? arcadeControlSlots : partyMaxPlayers;
    for (let playerNumber = 2; playerNumber <= finalPlayerNumber; playerNumber += 1) {
      if (!usedPlayers.has(playerNumber)) return playerNumber;
    }

    return null;
  }

  function getArcadeQueue() {
    return Array.from(partyHostPeersRef.current.entries())
      .filter(([, peer]) => peer.queued && !peer.playerNumber)
      .sort(([, left], [, right]) => (left.queuedAt || 0) - (right.queuedAt || 0));
  }

  function sendArcadeSeatUpdate(guestId, peer) {
    if (!isArcadeParty || !peer?.channel || peer.channel.readyState !== 'open') return;

    const queue = getArcadeQueue();
    const queueIndex = queue.findIndex(([queuedGuestId]) => queuedGuestId === guestId);

    peer.channel.send(JSON.stringify({
      type: 'arcade_seat_update',
      playerNumber: peer.playerNumber || null,
      queued: Boolean(peer.queued && !peer.playerNumber),
      queuePosition: queueIndex === -1 ? null : queueIndex + 1,
      role: peer.playerNumber ? `P${peer.playerNumber}` : peer.queued ? 'Queued' : 'Spectator',
    }));
  }

  function broadcastArcadeSeatUpdates() {
    if (!isArcadeParty) return;

    for (const [guestId, peer] of partyHostPeersRef.current.entries()) {
      sendArcadeSeatUpdate(guestId, peer);
    }
  }

  function refreshPartyRoster() {
    const queue = getArcadeQueue();
    const queuePositions = new Map(queue.map(([guestId], index) => [guestId, index + 1]));
    const players = [
      {
        playerNumber: 1,
        username: username || 'Host',
        connected: true,
        role: 'Host',
        active: true,
      },
      ...Array.from(partyHostPeersRef.current.values())
        .map((peer) => ({
          playerNumber: peer.playerNumber || `spectator-${peer.guestId}`,
          cabinetPlayerNumber: peer.playerNumber || null,
          username: peer.username || (peer.playerNumber ? `Player ${peer.playerNumber}` : 'Spectator'),
          connected: ['connected', 'completed'].includes(peer.pc?.iceConnectionState) || peer.pc?.connectionState === 'connected',
          role: peer.playerNumber ? 'Playing' : peer.queued ? `Queue #${queuePositions.get(peer.guestId) || '?'}` : 'Spectator',
          active: Boolean(peer.playerNumber),
          queued: Boolean(peer.queued && !peer.playerNumber),
          queuePosition: queuePositions.get(peer.guestId) || null,
          guestId: peer.guestId,
        }))
        .sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1;
          if (a.active && b.active) return a.cabinetPlayerNumber - b.cabinetPlayerNumber;
          if (a.queued !== b.queued) return a.queued ? -1 : 1;
          return (a.queuePosition || 999) - (b.queuePosition || 999) || String(a.username).localeCompare(String(b.username));
        }),
    ];

    setPartyRoster(players);
    broadcastArcadeSeatUpdates();
  }

  function releasePartyPeerInput(peer) {
    if (!peer?.joystickMask) return;

    if (isSharedCpcParty) {
      releaseCpcPartySharedInput(peer.joystickMask);
    } else {
      forwardInputToEmulator({
        type: 'amstrad_remote_joystick',
        player: peer.playerNumber || 2,
        mask: 0,
      });
    }

    peer.joystickMask = 0;
  }

  function promoteArcadeQueue() {
    if (!isArcadeParty || !isHost) return;

    let changed = false;
    let nextPlayerNumber = getNextPartyPlayerNumber();
    const queue = getArcadeQueue();

    for (const [guestId, peer] of queue) {
      if (!nextPlayerNumber) break;

      peer.playerNumber = nextPlayerNumber;
      peer.queued = false;
      peer.queuedAt = 0;
      changed = true;
      sendSignalRef.current({
        type: 'party-assigned',
        to: guestId,
        playerNumber: nextPlayerNumber,
      });
      addLog(`${peer.username || 'Spectator'} moved from queue to P${nextPlayerNumber}`);
      nextPlayerNumber = getNextPartyPlayerNumber();
    }

    if (changed) {
      refreshPartyRoster();
    } else {
      broadcastArcadeSeatUpdates();
    }
  }

  function queueArcadePeer(guestId, peer) {
    if (!isArcadeParty || !peer) return;

    if (peer.playerNumber) {
      sendArcadeSeatUpdate(guestId, peer);
      return;
    }

    if (!peer.queued) {
      peer.queued = true;
      peer.queuedAt = Date.now();
      addLog(`${peer.username || 'Spectator'} joined the arcade queue`);
    }

    promoteArcadeQueue();
    refreshPartyRoster();
  }

  function removeArcadePeerFromQueue(guestId, peer) {
    if (!isArcadeParty || !peer) return;

    peer.queued = false;
    peer.queuedAt = 0;
    addLog(`${peer.username || 'Spectator'} left the arcade queue`);
    refreshPartyRoster();
    sendArcadeSeatUpdate(guestId, peer);
  }

  function releaseArcadePlayer(guestId, { requeue = false } = {}) {
    if (!isArcadeParty || !isHost) return;

    const peer = partyHostPeersRef.current.get(guestId);
    if (!peer) return;

    releasePartyPeerInput(peer);
    peer.playerNumber = null;
    peer.queued = Boolean(requeue);
    peer.queuedAt = requeue ? Date.now() : 0;
    sendSignalRef.current({
      type: 'party-assigned',
      to: guestId,
      playerNumber: null,
    });
    addLog(`${peer.username || 'Player'} released their arcade controls`);
    promoteArcadeQueue();
    refreshPartyRoster();
  }

  function closePartyPeer(guestId) {
    const peer = partyHostPeersRef.current.get(guestId);
    if (!peer) return;

    releasePartyPeerInput(peer);

    peer.channel?.close();
    peer.pc?.close();
    partyHostPeersRef.current.delete(guestId);
    if (isArcadeParty) promoteArcadeQueue();
    refreshPartyRoster();
    setRemoteConnected(Array.from(partyHostPeersRef.current.values()).some((item) => item.pc?.connectionState === 'connected'));
  }

  async function createPartyPeerForGuest(guestMessage) {
    const guestId = guestMessage.from;
    if (!guestId || !isMultiPeerParty || !isHost) return;

    const existingPeer = partyHostPeersRef.current.get(guestId);
    if (existingPeer?.offer) {
      sendSignalRef.current({
        type: 'offer',
        to: guestId,
        offer: existingPeer.offer,
      });
      addLog(`Re-sent party offer to P${existingPeer.playerNumber}`);
      return;
    }

    if (!hostVideoStreamRef.current) {
      pendingPartyGuestsRef.current.set(guestId, guestMessage);
      addLog(`Queued party guest ${guestMessage.username || guestId} until stream starts`);
      return;
    }

    const playerNumber = getNextPartyPlayerNumber();
    if (!playerNumber && !isArcadeParty) {
      sendSignalRef.current({
        type: 'party-room-full',
        to: guestId,
      });
      addLog(`Party room full; rejected ${guestMessage.username || guestId}`);
      return;
    }

    const pc = new RTCPeerConnection(buildRtcConfig());
    const peerState = {
      pc,
      channel: null,
      playerNumber,
      joystickMask: 0,
      lastInputAt: 0,
      lastSeq: 0,
      lastSession: '',
      pendingIceCandidates: [],
      offer: null,
      username: guestMessage.username || (playerNumber ? `Player ${playerNumber}` : 'Spectator'),
      guestId,
      queued: false,
      queuedAt: 0,
    };

    partyHostPeersRef.current.set(guestId, peerState);
    refreshPartyRoster();

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      sendSignalRef.current({
        type: 'ice-candidate',
        to: guestId,
        candidate: event.candidate,
      });
    };

    pc.onconnectionstatechange = () => {
      addLog(`${peerState.playerNumber ? `P${peerState.playerNumber}` : 'Spectator'} connection: ${pc.connectionState}`);
      refreshPartyRoster();
      setRemoteConnected(Array.from(partyHostPeersRef.current.values()).some((item) => item.pc?.connectionState === 'connected'));

      if (['failed', 'closed'].includes(pc.connectionState)) {
        closePartyPeer(guestId);
      }
    };

    hostVideoStreamRef.current.getTracks().forEach((track) => {
      pc.addTrack(track, hostVideoStreamRef.current);
    });

    hostAudioStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, hostAudioStreamRef.current);
    });

    const channel = pc.createDataChannel('inputs');
    peerState.channel = channel;

    channel.onopen = () => {
      peerState.joystickMask = 0;
      peerState.lastInputAt = 0;
      peerState.lastSeq = 0;
      peerState.lastSession = '';
      addLog(`${peerState.playerNumber ? `P${peerState.playerNumber}` : 'Spectator'} input data channel open`);
      sendArcadeSeatUpdate(guestId, peerState);
    };
    channel.onmessage = (msg) => handleGuestPayloadOnHostRef.current?.(msg.data, peerState.playerNumber, peerState);
    channel.onclose = () => {
      releasePartyPeerInput(peerState);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);
    peerState.offer = pc.localDescription;

    if (playerNumber) {
      sendSignalRef.current({
        type: 'party-assigned',
        to: guestId,
        playerNumber,
      });
    } else {
      sendSignalRef.current({
        type: 'party-spectator',
        to: guestId,
      });
    }

    sendSignalRef.current({
      type: 'offer',
      to: guestId,
      offer: peerState.offer,
    });

    addLog(playerNumber ? `Party guest ${peerState.username} assigned P${playerNumber}` : `Party guest ${peerState.username} joined as spectator`);
    refreshPartyRoster();
    setStatus(`Party host ready: ${partyHostPeersRef.current.size} guest(s) connected`);
  }

  async function connectPendingPartyGuests() {
    if (!isMultiPeerParty || !isHost || !hostVideoStreamRef.current) return;

    const pendingGuests = Array.from(pendingPartyGuestsRef.current.values());
    pendingPartyGuestsRef.current.clear();

    for (const guestMessage of pendingGuests) {
      await createPartyPeerForGuest(guestMessage);
    }
  }

  async function renegotiatePeerConnection(reason = 'voice') {
    const pc = pcRef.current;

    if (!pc || !pc.remoteDescription || pc.signalingState !== 'stable') {
      micRenegotiationNeededRef.current = true;
      addLog(`${reason} will connect when the peer connection is ready`);
      return;
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    if (isHostRef.current) {
      localOfferRef.current = pc.localDescription;
    }

    const sent = sendSignalRef.current({
      type: 'offer',
      to: isHostRef.current ? activeGuestSignalIdRef.current || undefined : activePeerSignalIdRef.current || undefined,
      offer: pc.localDescription,
    });

    addLog(sent ? `${reason} offer sent` : `${reason} offer queued`);
  }

  async function refreshMicrophoneDevices() {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        }));

      setMicDevices(audioInputs);
    } catch (err) {
      addLog(`Microphone device list error: ${err.message}`);
    }
  }

  async function openMicrophone(deviceId = '') {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus('Mic unavailable');
      setError('This browser cannot use the microphone here.');
      addLog('Microphone is not available in this browser');
      return;
    }

    let nextStream = null;

    try {
      setMicStatus(deviceId ? 'Switching mic...' : 'Opening mic...');
      nextStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const [track] = nextStream.getAudioTracks();

      if (!track) {
        throw new Error('No microphone track was provided by the browser');
      }

      const pc = pcRef.current;

      if (!pc) {
        throw new Error('Peer connection is not ready yet');
      }

      const previousStream = localMicStreamRef.current;
      const existingSender = localMicSenderRef.current;

      if (existingSender) {
        await existingSender.replaceTrack(track);
      } else {
        localMicSenderRef.current = pc.addTrack(track, nextStream);
      }

      previousStream?.getTracks().forEach((previousTrack) => previousTrack.stop());
      localMicStreamRef.current = nextStream;
      setMicEnabled(true);
      setMicMuted(false);
      setMicStatus('Mic on');
      setSelectedMicDeviceId(track.getSettings?.().deviceId || deviceId || '');
      addLog(existingSender ? 'Microphone switched' : 'Microphone enabled');
      await refreshMicrophoneDevices();

      if (!existingSender && pc.remoteDescription && pc.signalingState === 'stable') {
        await renegotiatePeerConnection('Microphone');
      } else if (!existingSender) {
        micRenegotiationNeededRef.current = true;
        addLog('Microphone will connect when the room stream is ready');
      }
    } catch (err) {
      nextStream?.getTracks().forEach((track) => track.stop());
      if (!localMicStreamRef.current) {
        localMicSenderRef.current = null;
        setMicEnabled(false);
        setMicMuted(false);
        setMicStatus('Mic blocked');
      } else {
        setMicStatus(micMuted ? 'Mic muted' : 'Mic on');
      }
      setError(err.message);
      addLog(`Microphone error: ${err.message}`);
    }
  }

  async function toggleMicrophone() {
    if (isSharedCpcParty) return;

    const existingStream = localMicStreamRef.current;

    if (existingStream) {
      const nextMuted = !micMuted;
      existingStream.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
      setMicMuted(nextMuted);
      setMicStatus(nextMuted ? 'Mic muted' : 'Mic on');
      addLog(nextMuted ? 'Microphone muted' : 'Microphone unmuted');
      return;
    }

    await openMicrophone(selectedMicDeviceId);
  }

  async function startHostSession() {
    if (hostStartingRef.current || hostStartedRef.current) {
      return;
    }

    hostStartingRef.current = true;

    try {
      setError('');
      setHostPaused(false);
      const pc = pcRef.current;
      const iframe = emulatorFrameRef.current;

      if (!iframe) {
        throw new Error('Emulator frame not found');
      }

      setHostStarted(true);
      addLog('Waiting for emulator iframe');
      iframe.contentWindow?.postMessage({ type: 'emulator_set_volume', volume: hostVolumeRef.current }, window.location.origin);
      iframe.contentWindow?.postMessage({ type: 'emulator_set_paused', paused: false }, window.location.origin);

      if (isAmigaLink) {
        iframe.contentWindow?.postMessage({ type: 'amiga_start' }, window.location.origin);
      }
      if (isPuaeAmiga) {
        iframe.contentWindow?.postMessage({ type: 'amiga_aga_start' }, window.location.origin);
      }
      if (isSegaConsole) {
        iframe.contentWindow?.postMessage({ type: 'megadrive_start' }, window.location.origin);
      }
      if (isNes) {
        iframe.contentWindow?.postMessage({ type: 'nes_start' }, window.location.origin);
      }
      if (isSnes) {
        iframe.contentWindow?.postMessage({ type: 'snes_start' }, window.location.origin);
      }
      if (isPcEngine || isX68000) {
        iframe.contentWindow?.postMessage({ type: isX68000 ? 'x68000_start' : 'pcengine_start' }, window.location.origin);
      }
      if (isDiscConsole) {
        iframe.contentWindow?.postMessage({ type: isSaturn ? 'saturn_start' : 'playstation_start' }, window.location.origin);
      }
      if (isC64) {
        iframe.contentWindow?.postMessage({ type: 'c64_start', soloMode: isSoloMode }, window.location.origin);
      }
      if (isAtari8) {
        iframe.contentWindow?.postMessage({ type: 'atari8_start' }, window.location.origin);
      }
      if (isAtariSt) {
        iframe.contentWindow?.postMessage({ type: 'atarist_start', soloMode: isSoloMode }, window.location.origin);
      }
      if (isArcade) {
        iframe.contentWindow?.postMessage({ type: 'arcade_start' }, window.location.origin);
      }

      const emulatorCanvas = await waitForEmulatorCanvas(iframe);
      const useDirectCanvasStream = (isArcade || isBeetleSaturn) && typeof emulatorCanvas.captureStream === 'function';

      if (useDirectCanvasStream) {
        addLog(`Using native ${isBeetleSaturn ? 'webretro Saturn' : 'arcade'} canvas stream`);
      } else {
        startMirrorLoop(emulatorCanvas);
      }

      if (isAmigaLink) {
        addLog('Local linked Amiga ready');
        setStatus(serialChannelRef.current?.readyState === 'open' ? 'Amiga serial link connected' : 'Local Amiga ready, waiting for serial link');
        hostStartedRef.current = true;
        return;
      }

      const stream = useDirectCanvasStream
        ? emulatorCanvas.captureStream(60)
        : mirrorCanvasRef.current?.captureStream(60);

      if (!stream) {
        throw new Error('Video stream missing');
      }

      hostVideoStreamRef.current = stream;
      mirrorCaptureTrackRef.current = stream.getVideoTracks?.()[0] || null;

      const rawAudioStream = await waitForHostAudioStream(iframe);

      if (isSoloMode) {
        const audioStream = buildHostAudioStream(rawAudioStream);
        hostAudioStreamRef.current = audioStream || null;
        addLog('Local emulator ready');
        setStatus('Local emulator ready');
        hostStartedRef.current = true;
        return;
      }

      if (!pc) {
        throw new Error('Peer connection is not ready');
      }

      const hasExistingHostVideoSender = !isSoloMode
        && !isMultiPeerParty
        && pc.getSenders?.().some((sender) => sender.track?.kind === 'video');

      if (hasExistingHostVideoSender) {
        await replaceHostMediaStreams(stream, rawAudioStream);
        addLog(`Replaced room stream with ${stream.getVideoTracks().length} video track(s) and ${hostAudioStreamRef.current?.getAudioTracks().length || 0} audio track(s)`);
        setStatus('Room stream switched');
        hostStartedRef.current = true;
        return;
      }

      const audioStream = buildHostAudioStream(rawAudioStream);
      hostAudioStreamRef.current = audioStream || null;

      if (isMultiPeerParty) {
        addLog(`Party stream ready with ${stream.getVideoTracks().length} video track(s) and ${audioStream?.getAudioTracks().length || 0} audio track(s)`);
        setStatus('Party host ready, waiting for guests');
        hostStartedRef.current = true;
        await connectPendingPartyGuests();
        return;
      }

      stream.getVideoTracks().forEach((track) => pc.addTrack(track, stream));
      if (audioStream) {
        audioStream.getAudioTracks().forEach((track) => pc.addTrack(track, audioStream));
      }
      addLog(`Added ${stream.getVideoTracks().length} video track(s) and ${audioStream?.getAudioTracks().length || 0} audio track(s)`);

      const channel = pc.createDataChannel('inputs');
      dataChannelRef.current = channel;

      channel.onopen = () => {
        lastRemoteInputSessionRef.current = '';
        lastRemoteInputSeqRef.current = 0;
        lastRemoteInputAtRef.current = 0;
        remoteJoystickMaskRef.current = 0;
        addLog('Host input data channel open');
      };
      channel.onmessage = (msg) => handleGuestPayloadOnHostRef.current?.(msg.data);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);
      localOfferRef.current = pc.localDescription;

      const sent = sendSignal({
        type: 'offer',
        to: activeGuestSignalIdRef.current || undefined,
        offer: localOfferRef.current,
      });

      addLog(sent ? 'Offer sent' : 'Offer queued until signaling opens');
      setStatus('Offer created, waiting for guest');
      hostStartedRef.current = true;
    } catch (err) {
      setError(err.message);
      addLog(`Host session error: ${err.message}`);
      setHostStarted(false);
      hostStartedRef.current = false;
    } finally {
      hostStartingRef.current = false;
    }
  }

  async function connectGuest() {
    if (guestPreparedRef.current) {
      return;
    }

    try {
      const pc = pcRef.current;

      if (!pc.remoteDescription && pc.getTransceivers().length === 0) {
        pc.addTransceiver('video', {
          direction: 'recvonly',
        });
        pc.addTransceiver('audio', {
          direction: 'recvonly',
        });
      }

      guestPreparedRef.current = true;
      setGuestPrepared(true);
      addLog('Guest prepared to receive stream');
      setStatus('Waiting for host offer');
    } catch (err) {
      setError(err.message);
      addLog(`Guest setup error: ${err.message}`);
    }
  }

  useEffect(() => {
    if (!isSoloMode && isHost && signalingOpen && !isAmigaFamily && !isArcade && !isAtariSt) {
      startHostSession();
    }
  }, [isAmigaFamily, isArcade, isAtariSt, isHost, isSoloMode, room, signalingOpen]);

  useEffect(() => {
    if (
      !isArcadeParty
      || !isHost
      || !signalingOpen
      || !loadedDiskName
      || hostVideoStreamRef.current
      || hostStartingRef.current
    ) return undefined;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled || hostVideoStreamRef.current || hostStartingRef.current) return;

      // Changing a running cabinet from local to multiplayer rebuilds the RTC
      // layer. The emulator remains alive, so explicitly re-capture its current
      // canvas/audio instead of waiting for another game load.
      hostStartedRef.current = false;
      setHostStarted(false);
      setStatus('Opening multiplayer stream...');
      addLog('Multiplayer enabled; re-capturing the running MAME cabinet stream');
      await startHostSession();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [addLog, isArcadeParty, isHost, loadedDiskName, roomSessionKey, signalingOpen]);

  useEffect(() => {
    if (!isSoloMode && room && !isHost && !isAmigaLink) {
      connectGuest();
    }
  }, [isAmigaLink, isHost, isSoloMode, room]);

  function openDiskPicker() {
    if (!canControlLocalEmulator) return;

    fileInputRef.current?.click();
  }

  function fallbackArcadeRomName(fileName) {
    return fileName
      .replace(/\.(zip|7z)$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getArcadeRomMetadata(fileName) {
    const romKey = fileName.replace(/\.(zip|7z)$/i, '').toLowerCase();
    const metadata = mame2003PlusTitles[romKey];
    const parent = metadata?.parent || '';
    const parentTitle = parent ? mame2003PlusTitles[parent]?.title || parent : '';

    return {
      romKey,
      displayName: metadata?.title || fallbackArcadeRomName(fileName),
      parent,
      parentTitle,
      isClone: Boolean(parent),
    };
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return window.btoa(binary);
  }

  function cloneMameSaveFiles(files) {
    return (files || [])
      .filter((file) => file?.path && file?.bytes?.length)
      .map((file) => ({
        ...file,
        bytes: new Uint8Array(file.bytes),
      }));
  }

  function getArcadeRomKey(fileName = loadedDiskName) {
    return String(fileName || '').split(' from ')[0].replace(/\.(zip|7z)$/i, '').toLowerCase();
  }

  function getArcadeLeaderboardKey(fileName = loadedDiskName, supportedGames = null) {
    const romKey = getArcadeRomKey(fileName);
    const parent = mame2003PlusTitles[romKey]?.parent || '';
    if (parent) return parent;

    if (Array.isArray(supportedGames) && supportedGames.some((item) => item.rom_name === romKey && item.enabled)) return romKey;
    return romKey;
  }

  async function refreshMameLeaderboard(fileName = loadedDiskName) {
    if (!supportsMameScoreboard || !fileName) {
      setMameLeaderboard([]);
      setMameLeaderboardSupported(false);
      setMameScoreStatus('');
      return;
    }

    try {
      setMameScoreStatus('Loading scoreboard...');
      if (tournamentCode) {
        const scores = await apiFetch(`/auth/tournaments/${encodeURIComponent(tournamentCode)}/leaderboard`);
        const scoreList = Array.isArray(scores) ? scores : [];
        setMameLeaderboard(scoreList);
        setMameLeaderboardSupported(true);
        setMameScoreStatus(scoreList.length ? '' : 'Tournament active. No verified scores yet.');
        return;
      }
      const games = await apiFetch('/scores/mame/leaderboards');
      const gameList = Array.isArray(games) ? games : [];
      const romKey = getArcadeLeaderboardKey(fileName, gameList);
      const supported = gameList.some((item) => item.rom_name === romKey && item.enabled && item.leaderboard_supported);
      setMameLeaderboardSupported(supported);
      if (!supported) {
        setMameLeaderboard([]);
        setMameScoreStatus('Online leaderboard not available for this game yet.');
        return;
      }
      const scores = await apiFetch(`/scores/mame/leaderboards/${encodeURIComponent(romKey)}`);
      const scoreList = Array.isArray(scores) ? scores : [];
      setMameLeaderboard(scoreList);
      setMameScoreStatus(scoreList.length ? '' : 'Leaderboard enabled. Scores will appear after extraction.');
    } catch (err) {
      addLog(`MAME leaderboard load failed: ${err.message}`);
      setMameLeaderboard([]);
      setMameLeaderboardSupported(false);
      setMameScoreStatus('Scoreboard could not be loaded.');
    }
  }

  async function captureMameScoreBaseline(fileName = loadedDiskNameRef.current) {
    if (!supportsMameScoreboard || !isHost || !fileName) return;

    const frame = emulatorFrameRef.current;
    const bundle = await frame?.contentWindow?.getArcadeSaveBundle?.({ restartCore: false });
    const files = cloneMameSaveFiles(bundle?.files);
    const romName = getArcadeRomKey(bundle?.romName || fileName);
    mameScoreBaselineRef.current = {
      romName,
      files,
      capturedAt: Date.now(),
    };
    addLog(`MAME score baseline captured for ${romName}: ${files.length} files`);
  }
  async function setArcadeCabinetMode(multiplayer) {
    if (!isArcade || !isHost || switchingSystem || Boolean(room?.arcade_multiplayer) === multiplayer) return;

    setSwitchingSystem(true);
    try {
      setError('');
      const nextRoom = await apiFetch(`/rooms/${roomCode}/arcade-mode`, {
        method: 'PATCH',
        body: JSON.stringify({ multiplayer }),
      });
      if (signalingOpen) {
        sendSignal({ type: 'arcade-mode-changed', room: nextRoom, username });
      }
      setRoom(nextRoom);
      setPartyPlayerNumber(null);
      setArcadeQueueStatus({ queued: false, queuePosition: null, role: 'Spectator' });
      setRoomSessionKey((key) => key + 1);
      setStatus(multiplayer ? 'Multiplayer cabinet open — share the room code' : 'Single-player cabinet');
    } catch (err) {
      setError(err.message);
    } finally {
      setSwitchingSystem(false);
    }
  }

  async function refreshAmigaLeaderboard() {
    if (!amigaScoreGame) return;
    try {
      const scores = await apiFetch(`/scores/amiga/leaderboards/${encodeURIComponent(amigaScoreGame.game_key)}`);
      setAmigaLeaderboard(Array.isArray(scores) ? scores : []);
    } catch (err) {
      setAmigaLeaderboard([]);
      setAmigaScoreStatus(`${amigaScoreGame.title} leaderboard could not be loaded.`);
      addLog(`Amiga leaderboard load failed: ${err.message}`);
    }
  }

  async function getAmigaScoreFiles() {
    const bundle = await emulatorFrameRef.current?.contentWindow?.getAmigaHighScoreBundle?.({ filenames: [amigaScoreGame.filename] });
    const files = Array.isArray(bundle?.files) ? bundle.files : [];
    const scoreFiles = files
      .filter((candidate) => candidate?.path?.split('/').pop()?.toUpperCase() === amigaScoreGame.filename.toUpperCase())
      .filter((candidate) => candidate?.bytes?.length)
      .map((candidate) => ({
        path: candidate.path,
        bytes: new Uint8Array(candidate.bytes), source: candidate.source, modifiedAt: candidate.modifiedAt,
      }));
    const file = scoreFiles.find((candidate) => /\/WHDSaves\//i.test(candidate.path || ''))
      || scoreFiles[0]
      || null;
    return { file, files: scoreFiles, bundle };
  }

  async function captureAmigaScoreBaseline() {
    if (!supportsAmigaScoreboard || !isHost) return false;
    const { file, files } = await getAmigaScoreFiles();
    if (!file) return false;
    amigaScoreBaselineRef.current = { ...file, files };
    setAmigaScoreStatus('Score table ready. Finish a run and enter your initials.');
    addLog(`${amigaScoreGame.title} score baseline captured from ${files.length} ${amigaScoreGame.filename} file(s): ${files.map((candidate) => `${candidate.path} [${candidate.source || 'unknown'}]`).join(', ')}`);
    return true;
  }

  async function submitAmigaScoreExtraction(reason = 'session') {
    if (!supportsAmigaScoreboard || !isHost || amigaScoreBusy) return null;
    const { file: current, files: currentFiles, bundle } = await getAmigaScoreFiles();
    if (!current) {
      if (reason === 'manual') {
        const searched = Array.isArray(bundle?.searched) ? bundle.searched : [];
        setAmigaScoreStatus(searched.length
          ? `${amigaScoreGame.filename} is not available yet. Checked ${searched.length} PUAE folders.`
          : `${amigaScoreGame.filename} is not available yet. Let the game finish loading.`);
      }
      return null;
    }
    const baseline = amigaScoreBaselineRef.current;
    if (!baseline) {
      amigaScoreBaselineRef.current = { ...current, files: currentFiles };
      setAmigaScoreStatus('Score table ready. Finish a run and enter your initials.');
      return null;
    }
    const baselineFiles = Array.isArray(baseline.files) && baseline.files.length
      ? baseline.files
      : [baseline];
    const baselineByPath = new Map(baselineFiles.map((candidate) => [candidate.path, candidate]));
    const changedFiles = currentFiles.filter((candidate) => {
      const matchingBaseline = baselineByPath.get(candidate.path) || baseline;
      return bytesToBase64(candidate.bytes) !== bytesToBase64(matchingBaseline.bytes);
    });
    if (!changedFiles.length) {
      if (reason === 'manual') setAmigaScoreStatus('No new saved score found yet.');
      if (reason === 'manual') {
        addLog(`${amigaScoreGame.title} checked ${currentFiles.length} ${amigaScoreGame.filename} file(s); none changed: ${currentFiles.map((candidate) => candidate.path).join(', ')}`);
      }
      return null;
    }

    setAmigaScoreBusy(true);
    setAmigaScoreStatus(`Checking saved ${amigaScoreGame.title} score...`);
    try {
      let result = null;
      for (const candidate of changedFiles) {
        const matchingBaseline = baselineByPath.get(candidate.path) || baseline;
        const candidateResult = await apiFetch('/scores/amiga/extract-score', {
          method: 'POST',
          body: JSON.stringify({
            game_key: amigaScoreGame.game_key,
            session_id: `${roomCode}-${roomSessionKey}-${amigaScoreGame.game_key}`,
            source_path: candidate.path,
            data: bytesToBase64(candidate.bytes),
            baseline_data: bytesToBase64(matchingBaseline.bytes),
          }),
        });
        result = candidateResult;
        const parserDetail = candidateResult.current_rows === undefined
          ? ''
          : ` (parser: ${candidateResult.current_rows}/${candidateResult.baseline_rows} rows, ${candidateResult.current_bytes}/${candidateResult.baseline_bytes} bytes)`;
        addLog(`${amigaScoreGame.title} checked ${candidate.path}: ${candidateResult.message || candidateResult.status}${parserDetail}`);
        if ((candidateResult.rows_inserted || 0) > 0) break;
      }
      setAmigaScoreStatus((result.rows_inserted || 0) > 0
        ? 'Personal best registered.'
        : 'Score table checked; no new personal best found.');
      await refreshAmigaLeaderboard();
      return result;
    } finally {
      setAmigaScoreBusy(false);
    }
  }

  async function saveAmigaScoreNow() {
    try {
      await submitAmigaScoreExtraction('manual');
    } catch (err) {
      setAmigaScoreStatus(`${amigaScoreGame?.title || 'Amiga'} score could not be checked.`);
      addLog(`Amiga score save failed: ${err.message}`);
    }
  }

  function renderAmigaLeaderboardPanel() {
    if (!supportsAmigaScoreboard) return null;
    return (
      <div className="mame-score-panel amiga-score-panel">
        <div className="mame-score-panel-header">
          <div><span>Amiga leaderboard</span><strong>{amigaScoreGame.title}</strong></div>
          <em>live</em>
        </div>
        <p className="mame-score-status">
          {amigaScoreStatus || `Scores are verified from the WHDLoad ${amigaScoreGame.filename} file.`}
        </p>
        {isHost ? (
          <button
            type="button"
            className="primary mame-save-score"
            onClick={saveAmigaScoreNow}
            disabled={amigaScoreBusy}
          >
            {amigaScoreBusy ? 'Checking score...' : `Save ${amigaScoreGame.title} score now`}
          </button>
        ) : null}
        {amigaLeaderboard.length ? (
          <div className="mame-score-list">
            {amigaLeaderboard.map((entry) => (
              <div key={`${entry.rank}-${entry.username}-${entry.score}`}>
                <strong>{entry.rank}</strong><span>{entry.username}</span>
                <small>{entry.initials || '---'}</small><b>{entry.score.toLocaleString()}</b>
              </div>
            ))}
          </div>
        ) : (
          <div className="mame-score-empty"><strong>No saved runs yet</strong><span>Finish a run and enter initials.</span></div>
        )}
      </div>
    );
  }

  async function submitMameScoreExtraction(reason = 'session') {
    if (!supportsMameScoreboard || !isHost || !loadedDiskNameRef.current) return null;
    if (!mameLeaderboardSupported) return null;

    const frame = emulatorFrameRef.current;
    setMameScoreStatus('Registering score...');
    const bundle = await frame?.contentWindow?.getArcadeSaveBundle?.({ forceRestart: reason === 'manual' });
    const files = cloneMameSaveFiles(bundle?.files);
    const romName = getArcadeRomKey(bundle?.romName || loadedDiskNameRef.current);
    const leaderboardRomName = getArcadeLeaderboardKey(bundle?.romName || loadedDiskNameRef.current);
    const sessionId = `${roomCode}-${roomSessionKey}-${romName}`;
    const baseline = mameScoreBaselineRef.current?.romName === romName ? mameScoreBaselineRef.current.files || [] : [];

    if (!files.length) {
      const scannedCount = bundle?.debug?.files?.length || 0;
      setMameScoreStatus(`No MAME score files found for extraction. Browser FS scan saw ${scannedCount} files.`);
      addLog(`MAME score extraction skipped: no upload candidates (${reason}); scanned files ${scannedCount}`);
      return null;
    }

    if (tournamentCode && Date.now() < tournamentScoreArmedAtRef.current) {
      mameScoreBaselineRef.current = {
        romName,
        files,
        capturedAt: Date.now(),
      };
      const seconds = Math.max(1, Math.ceil((tournamentScoreArmedAtRef.current - Date.now()) / 1000));
      setMameScoreStatus(`Preparing clean tournament baseline… ${seconds}s`);
      addLog(`Tournament MAME baseline refreshed during ${seconds}s cabinet-table warm-up for ${romName}`);
      return {
        status: 'baseline',
        rom_name: leaderboardRomName || romName,
        rows_inserted: 0,
      };
    }

    if (reason === 'automatic' && !baseline.length) {
      mameScoreBaselineRef.current = {
        romName,
        files,
        capturedAt: Date.now(),
      };
      setMameScoreStatus('');
      addLog(`MAME score baseline established from first generated save for ${romName}`);
      return {
        status: 'baseline',
        rom_name: leaderboardRomName || romName,
        rows_inserted: 0,
      };
    }

    const extractionPath = tournamentCode
      ? `/auth/tournaments/${encodeURIComponent(tournamentCode)}/sessions/${encodeURIComponent(sessionId)}/extract-score`
      : `/scores/mame/sessions/${encodeURIComponent(sessionId)}/extract-scores`;
    const result = await apiFetch(extractionPath, {
      method: 'POST',
      body: JSON.stringify({
        rom_name: romName,
        ...(tournamentCode ? {} : { leaderboard_rom_name: leaderboardRomName }),
        save_files: files.map((file) => ({
          path: file.path,
          data: bytesToBase64(file.bytes),
        })),
        baseline_save_files: baseline.map((file) => ({
          path: file.path,
          data: bytesToBase64(file.bytes),
        })),
      }),
    });
    // Future writes must be compared with the file we just checked, not the
    // original start-of-game snapshot. Otherwise one PB is rediscovered on
    // every recursive MAME .hi save.
    mameScoreBaselineRef.current = {
      romName,
      files,
      capturedAt: Date.now(),
    };
    const savedPaths = Array.isArray(result.saved_paths) ? result.saved_paths : [];
    addLog(
      `MAME score extraction ${result.status}: ${result.message || 'no message'}; parsed ${result.scores_parsed || 0}, inserted ${result.rows_inserted || 0}; files ${savedPaths.length ? savedPaths.join(', ') : 'none'}`
    );
    if ((result.rows_inserted || 0) > 0) {
      setMameScoreStatus('Score registered.');
    } else if (result.status === 'no_scores') {
      setMameScoreStatus('No new player score found yet.');
    } else if (result.status === 'ok') {
      setMameScoreStatus('Scoreboard checked.');
    } else {
      setMameScoreStatus('Score could not be registered.');
    }
    await refreshMameLeaderboard(result.rom_name || romName);
    return result;
  }

  async function saveMameScoreNow() {
    if (mameScoreBusy) return;
    setMameScoreBusy(true);
    try {
      const result = await submitMameScoreExtraction('manual');
      if (!result) {
        setMameScoreStatus('No MAME score data was available to save yet.');
      }
    } catch (err) {
      setMameScoreStatus('Score could not be registered.');
      addLog(`MAME score save failed: ${err.message}`);
    } finally {
      setMameScoreBusy(false);
    }
  }

  function renderMameLeaderboardPanel(extraClass = '') {
    if (!supportsMameScoreboard || !loadedDiskName) return null;

    return (
      <div className={`mame-score-panel ${extraClass}`}>
        <div className="mame-score-panel-header">
          <div>
            <span>{tournamentCode ? 'Tournament standings' : 'MAME leaderboard'}</span>
            <strong className={tournamentCode ? 'tournament-room-title' : ''}>
              {tournamentCode ? tournamentTitle || tournamentCode : getArcadeLeaderboardKey(loadedDiskName)}
            </strong>
            {tournamentCode ? <small className="tournament-room-code">Code {tournamentCode}</small> : null}
          </div>
          <em>{mameLeaderboardSupported ? 'live' : 'off'}</em>
        </div>
        <p className="mame-score-status">
          {mameScoreStatus === 'Loading scoreboard...'
            ? mameScoreStatus
            : mameLeaderboardSupported
            ? mameScoreStatus || (tournamentCode ? 'Only your best tournament score counts.' : 'Scores are extracted from MAME save files.')
            : 'Online leaderboard not available for this game yet.'}
        </p>
        {mameLeaderboardSupported && isHost ? (
          <button type="button" className="primary mame-save-score" onClick={saveMameScoreNow} disabled={mameScoreBusy}>
            {mameScoreBusy ? 'Registering score...' : tournamentCode ? 'Submit tournament score' : 'Save MAME score now'}
          </button>
        ) : null}
        {mameLeaderboardSupported && mameLeaderboard.length ? (
          <div className="mame-score-list">
            {mameLeaderboard.slice(0, 10).map((entry) => (
              <div key={`${entry.rank}-${entry.username}-${entry.score}`}>
                <strong
                  className={tournamentCode && entry.rank <= 3 ? 'tournament-rank-medal' : ''}
                  aria-label={tournamentCode && entry.rank <= 3 ? `${entry.rank === 1 ? 'Gold' : entry.rank === 2 ? 'Silver' : 'Bronze'} medal` : undefined}
                >
                  {tournamentCode && entry.rank <= 3
                    ? ({ 1: '🥇', 2: '🥈', 3: '🥉' })[entry.rank]
                    : entry.rank}
                </strong>
                <span>{entry.username}</span>
                <small>{entry.initials || '---'}</small>
                <b>{entry.score.toLocaleString()}</b>
              </div>
            ))}
          </div>
        ) : mameScoreStatus === 'Loading scoreboard...' ? null : (
          <div className="mame-score-empty">
            <strong>No saved runs yet</strong>
            <span>Finish a run, enter initials, then save.</span>
          </div>
        )}
      </div>
    );
  }

  async function collectArcadeFolderEntries(directoryHandle, prefix = '') {
    const roms = [];
    const samples = new Map();

    for await (const [name, handle] of directoryHandle.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      const pathParts = path.split(/[\\/]+/).map((part) => part.toLowerCase());
      const inSamplesFolder = pathParts.includes('samples');

      if (handle.kind === 'file') {
        if (/\.(zip|7z)$/i.test(name)) {
          if (inSamplesFolder) {
            const sampleKey = name.replace(/\.(zip|7z)$/i, '').toLowerCase();
            samples.set(sampleKey, { name, path, handle });
          } else {
            const metadata = getArcadeRomMetadata(name);
            roms.push({
              name,
              path,
              ...metadata,
              handle,
            });
          }
        }
        continue;
      }

      if (handle.kind === 'directory') {
        try {
          const childEntries = await collectArcadeFolderEntries(handle, path);
          roms.push(...childEntries.roms);
          childEntries.samples.forEach((sample, key) => samples.set(key, sample));
        } catch {
          // Some folders may be blocked by the browser picker. Keep scanning the rest.
        }
      }
    }

    return { roms, samples };
  }

  async function openArcadeRomFolder() {
    if (!canControlLocalEmulator || !isArcade) return;

    if (!window.showDirectoryPicker) {
      setError('Your browser does not support choosing a ROM folder. Chrome or Edge should work.');
      return;
    }

    try {
      setError('');
      setArcadeRomScanning(true);
      const directoryHandle = await window.showDirectoryPicker({ mode: 'read' });
      const { roms: entries, samples } = await collectArcadeFolderEntries(directoryHandle);
      entries.sort((left, right) => left.displayName.localeCompare(right.displayName, undefined, { numeric: true, sensitivity: 'base' }));

      arcadeSampleHandlesRef.current = samples;
      setArcadeSampleCount(samples.size);
      setArcadeRomFolderName(directoryHandle.name || 'MAME ROMs');
      setArcadeRomEntries(entries);
      setArcadeRomSearch('');
      setStatus(entries.length ? `Found ${entries.length} MAME ROM archive${entries.length === 1 ? '' : 's'}` : 'No .zip or .7z ROMs found in that folder');
      addLog(`Scanned MAME ROM folder: ${directoryHandle.name || 'selected folder'} (${entries.length} archive${entries.length === 1 ? '' : 's'}, ${samples.size} sample zip${samples.size === 1 ? '' : 's'})`);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
        addLog(`ROM folder error: ${err.message}`);
      }
    } finally {
      setArcadeRomScanning(false);
    }
  }

  async function loadArcadeRomFile(file, sampleFiles = [], tournamentHiTemplate = '', tournamentSaveNamespace = '') {
    if (!file) return;

    if (!/\.(zip|7z)$/i.test(file.name)) {
      setError('Arcade rooms support MAME .zip and .7z ROM files');
      addLog(`Rejected file: ${file.name}`);
      return;
    }

    setError('');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const frame = await reloadArcadeFrame();

    if (!frame) {
      throw new Error('Arcade frame not found');
    }

    frame.contentWindow?.postMessage({
      type: 'arcade_autoload',
      fileName: file.name,
      bytes,
      samples: sampleFiles,
      saveNamespace: tournamentCode
        ? tournamentSaveNamespace || `tournament-${tournamentCode}-${username || 'entrant'}`
        : '',
      hiTemplate: tournamentCode ? tournamentHiTemplate : '',
    }, window.location.origin);

    if (hostStartedRef.current) {
      setStatus(loadedDiskName ? `Changing MAME ROM: ${file.name}` : `Loading MAME ROM: ${file.name}`);

      frame.contentWindow?.postMessage({ type: 'arcade_start' }, window.location.origin);

      const emulatorCanvas = await waitForEmulatorCanvas(frame);
      const nextVideoStream = emulatorCanvas.captureStream(60);

      if (!nextVideoStream) {
        throw new Error('Arcade mirror stream missing');
      }

      const nextAudioStream = await waitForHostAudioStream(frame);
      await replaceHostMediaStreams(nextVideoStream, nextAudioStream);

      setLoadedDiskName(file.name);
      await refreshMameLeaderboard(file.name);
      addLog(`${loadedDiskName ? 'Changed' : 'Loaded'} MAME ROM: ${file.name}`);
      setStatus(`${loadedDiskName ? 'Changed' : 'Loaded'} MAME ROM: ${file.name}`);
      return;
    }

    if (!hostStartingRef.current) {
      await startHostSession();
    }

    setLoadedDiskName(file.name);
    await refreshMameLeaderboard(file.name);
    addLog(`Loaded MAME ROM: ${file.name}`);
    setStatus(`Loaded MAME ROM: ${file.name}`);
  }

  async function loadArcadeRomEntry(entry) {
    if (!entry?.handle) return;

    try {
      setStatus(`Loading MAME ROM: ${entry.name}`);
      const file = await entry.handle.getFile();
      const sampleKeys = [entry.romKey, entry.parent].filter(Boolean);
      const sampleFiles = [];
      for (const sampleKey of sampleKeys) {
        const sample = arcadeSampleHandlesRef.current.get(sampleKey);
        if (!sample) continue;
        const sampleFile = await sample.handle.getFile();
        sampleFiles.push({
          fileName: sampleFile.name,
          bytes: new Uint8Array(await sampleFile.arrayBuffer()),
        });
      }
      if (sampleFiles.length) {
        addLog(`Loaded MAME samples: ${sampleFiles.map((sample) => sample.fileName).join(', ')}`);
      }
      await loadArcadeRomFile(file, sampleFiles);
    } catch (err) {
      setError(err.message);
      addLog(`MAME ROM load error: ${err.message}`);
    }
  }

  function openKickstartPicker() {
    if (!canControlLocalEmulator || !isAmigaFamily) return;

    kickstartInputRef.current?.click();
  }

  function openX68000FirmwarePicker() {
    if (!canControlLocalEmulator || !isX68000) return;
    x68000FirmwareInputRef.current?.click();
  }

  async function handleX68000FirmwareSelected(event) {
    try {
      const files = Array.from(event.target.files || []);
      if (!files.length) return;
      const entries = {};
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
        const archive = unzipSync(new Uint8Array(await files[0].arrayBuffer()));
        Object.entries(archive).forEach(([name, bytes]) => {
          const baseName = name.split(/[\\/]/).pop()?.toLowerCase();
          if (baseName) entries[baseName] = bytes;
        });
      } else {
        for (const file of files) entries[file.name.toLowerCase()] = new Uint8Array(await file.arrayBuffer());
      }
      if (!entries['iplrom.dat'] || !entries['cgrom.dat']) {
        throw new Error('Select both iplrom.dat and cgrom.dat, or a ZIP containing both files');
      }
      const bytes = zipSync({
        'keropi/iplrom.dat': entries['iplrom.dat'],
        'keropi/cgrom.dat': entries['cgrom.dat'],
      }, { level: 0 });
      const fileName = 'x68000-firmware.zip';
      savedSystemMediaRef.current.set(X68000_FIRMWARE_KEY, { fileName, bytes });
      await saveStoredKickstart(X68000_FIRMWARE_KEY, fileName, bytes);
      forwardInputToEmulator(buildX68000FirmwarePayload(fileName, bytes));
      setX68000FirmwareName('IPL + CG ROM (saved locally)');
      setError('');
      setStatus('X68000 firmware loaded and saved in this browser');
      event.target.value = '';
    } catch (err) {
      setError(err.message);
      event.target.value = '';
    }
  }

  async function loadVipKickstart() {
    if (!canControlLocalEmulator || !isPuaeAmiga || !hasVipAccess || vipKickstartBusy) return;

    const model = isAmigaAga ? 'a1200' : 'a500';
    const expectedSize = isAmigaAga ? 512 * 1024 : 256 * 1024;
    setVipKickstartBusy(true);
    setError('');
    setStatus(`Downloading VIP ${isAmigaAga ? 'A1200 Kickstart 3.1' : 'A500 Kickstart 1.3'}...`);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `${API_BASE_URL}/auth/vip/amiga/kickstarts/${model}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.detail || 'Could not download the Kickstart ROM');
      }
      const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
      const romEntry = Object.entries(archive).find(([entryName, bytes]) => (
        /\.rom$/i.test(entryName) && bytes.length === expectedSize
      ));
      if (!romEntry) throw new Error(`The downloaded archive did not contain the expected ${expectedSize / 1024} KB ROM`);

      const [entryName, bytes] = romEntry;
      const fileName = entryName.split(/[\\/]/).pop() || entryName;
      if (kickstartStorageKey) {
        savedSystemMediaRef.current.set(kickstartStorageKey, { fileName, bytes });
        await saveStoredKickstart(kickstartStorageKey, fileName, bytes);
      }
      forwardInputToEmulator(buildAmigaKickstartPayload(roomSystem, fileName, bytes));
      setKickstartRomName(`${fileName} (VIP saved)`);
      setStatus(`Kickstart loaded and saved: ${fileName}`);
      addLog(`Loaded VIP Kickstart ROM: ${fileName}`);
    } catch (err) {
      setError(err.message);
      setStatus('VIP Kickstart could not be loaded');
      addLog(`VIP Kickstart load error: ${err.message}`);
    } finally {
      setVipKickstartBusy(false);
    }
  }

  function openPlayStationBiosPicker() {
    if (!canControlLocalEmulator || !isDiscConsole) return;

    playstationBiosInputRef.current?.click();
  }

  function openAtariTosPicker() {
    if (!canControlLocalEmulator || !isAtariSt) return;
    atariTosInputRef.current?.click();
  }

  function openSwapDiskPicker() {
    if (!canControlLocalEmulator || (!isAmigaFamily && !isC64 && !isAtariSt) || !hostStarted) return;

    if (isC64) {
      if (c64MediaCount < 2) {
        setStatus('Load all C64 disks or tapes together first');
        return;
      }
      forwardInputToEmulator({ type: 'c64_next_media' });
      return;
    }

    swapDiskInputRef.current?.click();
  }

  function selectAgaDisk(index) {
    if (!canControlLocalEmulator || !hostStarted || !isPuaeAmiga) return;

    forwardInputToEmulator({ type: 'amiga_aga_select_disk', index });
    setStatus(`Inserting AGA disk ${index + 1}`);
  }

  async function selectLocalReleaseDisk(index) {
    if (!canControlLocalEmulator || !hostStarted) return;
    const file = localReleaseFiles[index];
    if (!file) return;

    if (isPuaeAmiga) {
      selectAgaDisk(index);
      setCurrentLocalReleaseIndex(index);
      return;
    }
    await handleDiskSelected({
      target: {
        files: [file],
        dataset: isAmigaFamily ? { mode: 'swap' } : {},
        value: '',
      },
    });
    setCurrentLocalReleaseIndex(index);
  }

  function selectNextLocalReleaseDisk() {
    if (localReleaseFiles.length < 2) return;
    const nextIndex = (currentLocalReleaseIndex + 1) % localReleaseFiles.length;
    selectLocalReleaseDisk(nextIndex);
  }

  function handleHostVolumeChange(event) {
    const nextVolume = Math.min(1, Math.max(0, Number(event.target.value) / 100));
    setHostVolume(nextVolume);
    forwardInputToEmulator({ type: 'emulator_set_volume', volume: nextVolume });
  }

  function sendArcadeQueueAction(type) {
    if (!isArcadeParty || isHost) return;

    const channel = dataChannelRef.current;
    if (channel?.readyState !== 'open') {
      setError('Join the stream first, then queue for a cabinet slot.');
      return;
    }

    channel.send(JSON.stringify({ type }));
    setArcadeQueueStatus((statusValue) => ({
      ...statusValue,
      queued: type === 'arcade_join_queue' ? true : false,
      role: type === 'arcade_join_queue' ? 'Queued' : 'Spectator',
    }));
    if (type === 'arcade_release_slot') {
      setPartyPlayerNumber(null);
    }
  }

  function toggleEmulatorPause() {
    if (!canControlLocalEmulator || !hostStarted) return;

    const nextPaused = !emulatorPausedRef.current;
    setHostPaused(nextPaused);
    forwardInputToEmulator({ type: 'emulator_set_paused', paused: nextPaused });
    addLog(nextPaused ? 'Emulator paused' : 'Emulator resumed');
    setStatus(nextPaused ? 'Emulator paused' : 'Emulator resumed');
  }

  async function resetHostEmulator() {
    if (!canControlLocalEmulator || !hostStarted) return;

    setHostPaused(false);

    if (isC64) {
      setError('');
      setLoadedDiskName('');
      setC64MediaCount(0);
      setC64MediaIndex(0);
      setC64WarpEnabled(false);
      setC64JoystickPortsSwapped(false);
      setInputCaptured(false);
      setHostStarted(false);
      hostStartedRef.current = false;
      hostStartingRef.current = false;
      await reloadC64Frame();
      const mirrorCanvas = mirrorCanvasRef.current;
      const context = mirrorCanvas?.getContext('2d');
      if (mirrorCanvas && context) {
        context.fillStyle = '#000';
        context.fillRect(0, 0, mirrorCanvas.width, mirrorCanvas.height);
      }
      addLog('C64 returned to start state');
      setStatus('C64 ready. Press Start emulator, then load a game');
      return;
    }

    if (isAtariSt) {
      setError('');
      setLoadedDiskName('');
      setAtariStMediaCount(0);
      setAtariStMediaIndex(0);
      setInputCaptured(false);
      setHostStarted(false);
      hostStartedRef.current = false;
      hostStartingRef.current = false;
      await reloadAtariStFrame();
      addLog('Atari ST returned to start state');
      setStatus('Atari ST ready. Load a disk to start');
      return;
    }

    if (isPcEngine) {
      setError('');
      setLoadedDiskName('');
      setInputCaptured(false);
      await reloadPcEngineFrame();
      addLog('PC Engine returned to start state');
      setStatus('PC Engine ready. Load a game');
      return;
    }

    if (isDiscConsole) {
      setError('');
      setLoadedDiskName('');
      setInputCaptured(false);
      await reloadPlayStationFrame();
      addLog(`${isSaturn ? 'Saturn' : 'PlayStation'} returned to start state`);
      setStatus(`${isSaturn ? 'Saturn' : 'PlayStation'} ready. Load a game`);
      return;
    }

    if (isAtariSt) {
      if (atariStMediaCount < 2) {
        setStatus('Load all Atari ST disks together first');
        return;
      }
      forwardInputToEmulator({ type: 'atarist_next_media' });
      return;
    }

    const type = isAmigaLink
      ? 'amiga_reset'
      : isPuaeAmiga
        ? 'amiga_aga_reset'
      : isSegaConsole ? 'megadrive_reset' : isNes ? 'nes_reset' : isSnes ? 'snes_reset' : isPcEngine ? 'pcengine_reset' : isX68000 ? 'x68000_reset' : isPlayStation ? 'playstation_reset' : isSaturn ? 'saturn_reset' : isC64 ? 'c64_reset' : isAtari8 ? 'atari8_reset' : isAtariSt ? 'atarist_reset' : isArcade ? 'arcade_reset' : isSpectrum ? 'spectrum_reset' : 'amstrad_reset';

    forwardInputToEmulator({ type });
    addLog('Reset emulator');
    setStatus('Emulator reset');
  }

  function leaveRoom() {
    navigate(libraryReturnPath);
  }

  async function invitePlayerFromSolo() {
    if (!room || soloInviteBusy) return;

    setSoloInviteBusy(true);
    setError('');
    try {
      const nextRoom = await apiFetch('/rooms/create', {
        method: 'POST',
        body: JSON.stringify({
          system: roomSystem,
          party_max_players: 2,
        }),
      });
      const nextParams = new URLSearchParams();
      if (localGameId) nextParams.set('localGame', localGameId);
      if (libraryReturnPath !== '/library') nextParams.set('returnTo', libraryReturnPath);
      const query = nextParams.toString();
      const invitePath = `/room/${nextRoom.room_code}${query ? `?${query}` : ''}`;
      const inviteUrl = `${window.location.origin}${invitePath}`;
      setSoloInviteRoom({
        code: nextRoom.room_code,
        path: invitePath,
        url: inviteUrl,
      });
      await navigator.clipboard.writeText(inviteUrl);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1400);
      addLog(`Created multiplayer invite room ${nextRoom.room_code}`);
      setStatus('Multiplayer room ready. Open it when you want to host guests.');
    } catch (err) {
      setInviteCopied(false);
      setError(err.message);
      addLog(`Invite room error: ${err.message}`);
    } finally {
      setSoloInviteBusy(false);
    }
  }

  function chooseLocalRoomGame(game) {
    if (!game?.id) return;

    sessionStorage.setItem('oldstylegaming:pendingLocalGame', JSON.stringify({
      id: game.id,
      title: game.title,
      fileName: game.fileName,
      system: game.system,
      roomSystem: game.roomSystem,
      source: game.source || 'local',
      size: game.size || 0,
      archiveSampleFileName: game.archiveSampleFileName || '',
      archiveFileNames: game.archiveFileNames || [],
    }));
    localLibraryLoadAttemptedRef.current = false;
    setLocalGamePickerOpen(false);
    setLocalGameSearch('');
    setLoadedDiskName(game.fileName || game.title || '');
    setStatus(`Loading local game: ${game.title || game.fileName}`);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('mode');
    nextParams.delete('localRelease');
    nextParams.set('localGame', game.id);
    navigate(`/room/${roomCode}?${nextParams.toString()}`, { replace: true });
    setLocalGameReloadToken((value) => value + 1);
  }

  function swapC64JoystickPorts() {
    if (!canControlLocalEmulator || !hostStarted || !isC64) return;

    const nextSwapped = !c64JoystickPortsSwapped;
    setC64JoystickPortsSwapped(nextSwapped);
    forwardInputToEmulator({ type: 'c64_swap_joystick_ports', soloMode: isSoloMode });
    addLog(`C64 joysticks switched: P1 port ${nextSwapped ? 1 : 2}, P2 port ${nextSwapped ? 2 : 1}`);
    setStatus(`P1 port ${nextSwapped ? 1 : 2}, P2 port ${nextSwapped ? 2 : 1}`);
  }

  function toggleC64Warp() {
    if (!canControlLocalEmulator || !hostStarted || !isC64) return;

    const enabled = !c64WarpEnabled;
    setC64WarpEnabled(enabled);
    forwardInputToEmulator({ type: 'c64_set_warp', enabled });
    addLog(`C64 warp ${enabled ? 'enabled' : 'disabled'}`);
    setStatus(enabled ? 'C64 warp enabled' : 'C64 normal speed');
  }

  async function handleDiskSelected(event) {
    try {
      const selectedFiles = Array.from(event.target.files || []);
      const file = selectedFiles[0];

      if (!file) return;

      const isSwapDisk = isAmigaFamily && event.target.dataset.mode === 'swap';
      const allowedExtensions = isPuaeAmiga
        ? ['.adf', '.adz', '.dms', '.ipf', '.hdf', '.lha', '.slave', '.zip', '.7z']
        : isAmigaLink
        ? ['.adf', '.adz', '.dms', '.ipf', '.zip', '.7z']
        : isMasterSystem ? ['.sms', '.zip', '.7z'] : isMegaDrive ? ['.bin', '.gen', '.md', '.smd', '.zip', '.7z'] : isNes ? ['.nes', '.zip', '.7z'] : isSnes ? ['.sfc', '.smc', '.fig', '.swc', '.bsx', '.gd3', '.gd7', '.dx2', '.zip', '.7z'] : isPcEngine ? ['.pce', '.sgx', '.zip', '.7z'] : isX68000 ? ['.dim', '.img', '.d88', '.88d', '.hdm', '.dup', '.2hd', '.xdf', '.hdf', '.cmd', '.m3u', '.zip'] : isPlayStation ? ['.cue', '.bin', '.chd', '.pbp', '.iso', '.zip', '.7z'] : isSaturn ? ['.cue', '.bin', '.chd', '.iso', '.zip', '.7z'] : isC64 ? ['.d64', '.g64', '.f64', '.t64', '.p00', '.p01', '.tap', '.prg', '.crt', '.zip', '.7z'] : isAtari8 ? ['.atr', '.xfd', '.atx', '.xex', '.com', '.car', '.rom', '.bin', '.cas', '.zip', '.7z'] : isAtariSt ? ['.st', '.msa', '.stx', '.ipf', '.zip', '.7z'] : isArcade ? ['.zip', '.7z'] : isSpectrum ? ['.tap', '.tzx', '.z80', '.sna', '.szx', '.zip', '.7z'] : ['.dsk', '.zip'];

      const invalidFile = selectedFiles.find((selectedFile) => {
        const selectedLowerName = selectedFile.name.toLowerCase();
        return !allowedExtensions.some((extension) => selectedLowerName.endsWith(extension));
      });

      if (invalidFile) {
        if (isArcade) {
          setError('Arcade rooms support MAME .zip and .7z ROM files');
          addLog(`Rejected file: ${invalidFile.name}`);
          event.target.value = '';
          return;
        }
        setError(isPuaeAmiga ? 'Amiga PUAE rooms support .adf, .adz, .dms, .ipf, .hdf, .lha, .slave, .zip, and .7z files' : isAmigaLink ? 'Amiga Link rooms support .adf, .adz, .dms, .ipf, .zip, and .7z files' : isMasterSystem ? 'Master System rooms support .sms, .zip, and .7z ROM files' : isMegaDrive ? 'Mega Drive rooms support .bin, .gen, .md, .smd, .zip, and .7z ROM files' : isNes ? 'NES rooms support .nes, .zip, and .7z ROM files' : isSnes ? 'SNES rooms support .sfc, .smc, .fig, .swc, .bsx, .gd3, .gd7, .dx2, .zip, and .7z ROM files' : isPcEngine ? 'PC Engine rooms support .pce, .sgx, .zip, and .7z files' : isPlayStation ? 'PlayStation rooms support .cue/.bin, .chd, .pbp, .iso, .zip, and .7z files' : isC64 ? 'C64 rooms support .d64, .t64, .tap, .prg, .crt, .zip, and .7z files' : isAtari8 ? 'Atari 8-bit rooms support .atr, .xex, .car, .rom, .bin, .cas, .zip, and .7z files' : isAtariSt ? 'Atari ST rooms support .st, .msa, .stx, .ipf, .zip, and .7z disk images' : isArcade ? 'Arcade rooms support MAME .zip and .7z ROM files' : isSpectrum ? 'Spectrum rooms support .tap, .tzx, .z80, .sna, .szx, .zip, and .7z files' : 'Only .dsk files are supported right now');
        addLog(`Rejected file: ${invalidFile.name}`);
        event.target.value = '';
        return;
      }

      if (isArcade) {
        await loadArcadeRomFile(file);
        event.target.value = '';
        return;
      }

      setError('');

      if (isCpcSystem && !isSwapDisk) {
        const nextMatches = findControlProfileMatches(file.name);
        setControlProfileMatches(nextMatches);

        if (shouldAutoSelectControlMatch(nextMatches)) {
          const nextProfile = nextMatches[0].profile;
          setSelectedControlProfile(nextProfile);
          setControlProfileDrawerOpen(true);
          addLog(`Matched Amstrad instructions: ${nextProfile.title}`);
        } else if (nextMatches.length > 0) {
          setSelectedControlProfile(null);
          setControlProfileDrawerOpen(true);
          addLog(`Choose Amstrad instructions: ${nextMatches.map((match) => match.profile.title).join(', ')}`);
        } else {
          setSelectedControlProfile(null);
          setControlProfileDrawerOpen(false);
          addLog(`No Amstrad instructions matched ${file.name}; default controls remain active`);
        }
      }

      if (
        isDiscConsole
        && selectedFiles.some((selectedFile) => selectedFile.name.toLowerCase().endsWith('.cue'))
        && !selectedFiles.some((selectedFile) => selectedFile.name.toLowerCase().endsWith('.bin'))
      ) {
        setError(`Select the ${isSaturn ? 'Saturn' : 'PlayStation'} .cue file and all of its .bin track files together`);
        event.target.value = '';
        return;
      }

      const atari8ZipFile = isAtari8 && file.name.toLowerCase().endsWith('.zip');
      const snesZipFile = isSnes && file.name.toLowerCase().endsWith('.zip');
      const romZipFile = !atari8ZipFile
        && !snesZipFile
        && !isArcade
        && file.name.toLowerCase().endsWith('.zip')
        && Boolean(ROM_ZIP_EXTENSIONS[roomSystem]);
      const filesToLoad = (isPuaeAmiga || isDiscConsole || isC64 || isAtariSt || isX68000) && !isSwapDisk && selectedFiles.length > 1
        ? selectedFiles.slice().sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }))
        : [file];
      const loadedFiles = atari8ZipFile
        ? [await expandAtari8ZipFile(file)]
        : snesZipFile
        ? [await expandSnesZipFile(file)]
        : romZipFile
        ? await expandRomZipFile(file, roomSystem)
        : await Promise.all(filesToLoad.map(async (selectedFile) => ({
          fileName: selectedFile.name,
          bytes: new Uint8Array(await selectedFile.arrayBuffer()),
        })));
      if (isPuaeAmiga && loadedFiles.some((loadedFile) => loadedFile.fileName.toLowerCase().endsWith('.ipf'))) {
        throw new Error(
          'This is an IPF disk image. Desktop FS-UAE can load IPF through the CAPS/SPS library, but that library is not available in this browser PUAE build. Use an ADF release or the WHDLoad .lha release of this game.',
        );
      }
      const bytes = loadedFiles[0].bytes;
      const cpcAutoloadCommand = isCpcSystem && !isSwapDisk
        ? detectCpcAutoloadCommand(bytes, loadedFiles[0].fileName)
        : null;
      const atari8AutoProfile = isAtari8
        ? findAtari8AutoProfile([file.name, ...loadedFiles.map((loadedFile) => loadedFile.fileName)])
        : null;
      const atari8ProfileConfig = atari8AutoProfile
        ? normalizeAtari8Config({ ...atari8Config, ...atari8AutoProfile.config })
        : null;
      const shouldApplyAtari8Profile = Boolean(
        atari8ProfileConfig && JSON.stringify(atari8ProfileConfig) !== JSON.stringify(normalizeAtari8Config(atari8Config)),
      );

      const loadMessage = {
        type: isSwapDisk ? 'amiga_swap_disk' : isPuaeAmiga ? 'amiga_aga_autoload' : isAmigaLink ? 'amiga_autoload' : isSegaConsole ? 'megadrive_autoload' : isNes ? 'nes_autoload' : isSnes ? 'snes_autoload' : isPcEngine ? 'pcengine_autoload' : isX68000 ? 'x68000_autoload' : isPlayStation ? 'playstation_autoload' : isSaturn ? 'saturn_autoload' : isC64 ? 'c64_autoload' : isAtari8 ? 'atari8_autoload' : isAtariSt ? 'atarist_autoload' : isArcade ? 'arcade_autoload' : isSpectrum ? 'spectrum_autoload' : 'amstrad_autoload',
        fileName: loadedFiles[0].fileName,
        bytes: isDiscConsole ? undefined : bytes,
        files: isDiscConsole || isX68000 ? loadedFiles : undefined,
        disks: isPuaeAmiga && !isSwapDisk && !loadedFiles[0]?.whdLoadArchive ? loadedFiles : undefined,
        whdLoadFiles: isPuaeAmiga && loadedFiles[0]?.whdLoadArchive ? loadedFiles : undefined,
        profile: isPuaeAmiga ? { model: isAmigaAga ? 'A1200' : 'A500' } : undefined,
        media: isC64 || isAtariSt ? loadedFiles : undefined,
        autoloadCommand: cpcAutoloadCommand || undefined,
      };

      if (isC64 && loadedDiskName) {
        setStatus('Preparing a clean C64 runtime');
        await reloadC64Frame({ start: true });
      }
      let reloadedAmigaFrame = null;
      if (isPuaeAmiga && loadedDiskName) {
        setStatus('Preparing a clean Amiga PUAE runtime');
        reloadedAmigaFrame = await reloadAmigaAgaFrame();
      }
      if (isPcEngine && loadedDiskName) {
        setStatus('Preparing a clean PC Engine runtime');
        await reloadPcEngineFrame();
      }
      if (shouldApplyAtari8Profile) {
        setStatus(`Applying ${atari8AutoProfile.label}`);
        setAtari8Config(atari8ProfileConfig);
        await reloadAtari8Frame(atari8ProfileConfig);
        addLog(`Applied Atari profile: ${atari8AutoProfile.label}`);
      }
      let reloadedNesFrame = null;

      if (isNes && loadedDiskName) {
        setStatus('Preparing a clean NES runtime');
        reloadedNesFrame = await reloadNesFrame();
      }
      if (isDiscConsole && loadedDiskName) {
        setStatus(`Preparing a clean ${isSaturn ? 'Saturn' : 'PlayStation'} runtime`);
        await reloadPlayStationFrame();
      }
      if (isAtariSt && loadedDiskName) {
        setStatus('Preparing a clean Atari ST runtime');
        setHostStarted(false);
        hostStartedRef.current = false;
        hostStartingRef.current = false;
        await reloadAtariStFrame();
      }
      forwardInputToEmulator(loadMessage);

      if (reloadedAmigaFrame && hostStartedRef.current && !isSwapDisk) {
        // PUAE creates a fresh WebAudio source when its iframe reloads. Replace
        // the room's live tracks so connected guests do not remain attached to
        // the ended audio track from the previous game.
        await new Promise((resolve) => {
          setTimeout(resolve, 250);
        });
        const emulatorCanvas = await waitForEmulatorCanvas(reloadedAmigaFrame);
        startMirrorLoop(emulatorCanvas);
        const nextVideoStream = mirrorCanvasRef.current?.captureStream(60);
        if (!nextVideoStream) {
          throw new Error('Amiga mirror stream missing after game change');
        }
        const nextAudioStream = await waitForHostAudioStream(reloadedAmigaFrame);
        await replaceHostMediaStreams(nextVideoStream, nextAudioStream);
        addLog(`Replaced Amiga room stream with ${nextAudioStream?.getAudioTracks?.().length || 0} audio track(s)`);
      }

      if (isCpcSystem && !isSwapDisk) {
        addLog(cpcAutoloadCommand ? `Amstrad autoload: ${cpcAutoloadCommand}` : 'Amstrad autoload not detected; catalogue only');
      }

      if (isNes) {
        const frame = reloadedNesFrame || emulatorFrameRef.current;
        await new Promise((resolve) => {
          setTimeout(resolve, reloadedNesFrame ? 100 : 250);
        });
        const emulatorCanvas = await waitForEmulatorCanvas(frame);
        startMirrorLoop(emulatorCanvas);

        if (hostStartedRef.current) {
          const nextVideoStream = mirrorCanvasRef.current?.captureStream(60);
          if (!nextVideoStream) {
            throw new Error('NES mirror stream missing');
          }
          const nextAudioStream = await waitForHostAudioStream(frame);
          await replaceHostMediaStreams(nextVideoStream, nextAudioStream);
        }
      }

      if (isArcade || isPuaeAmiga || isAtariSt) {
        if (!hostStartedRef.current && !hostStartingRef.current) {
          await startHostSession();
        }
      }
      if (isPuaeAmiga && !isSwapDisk) {
        setLoadedAgaDiskCount(loadedFiles.length);
        setCurrentAgaDiskIndex(0);
      }
      if (isC64) {
        setC64MediaCount(loadedFiles.length);
        setC64MediaIndex(0);
      }
      if (isAtariSt) {
        setAtariStMediaCount(loadedFiles.length);
        setAtariStMediaIndex(0);
      }

      const expandedZipFile = atari8ZipFile || snesZipFile || romZipFile;
      const loadedLabel = expandedZipFile
        ? `${loadedFiles[0].fileName} from ${file.name}`
        : loadedFiles.length > 1
        ? `${loadedFiles[0].fileName} + ${loadedFiles.length - 1} disk${loadedFiles.length === 2 ? '' : 's'}`
        : file.name;
      if (snesZipFile) {
        addLog(`Selected SNES ROM from zip: ${loadedFiles[0].archiveEntryName || loadedFiles[0].fileName}`);
      }
      setLoadedDiskName(loadedLabel);
      addLog(`${isSwapDisk ? 'Swapped disk' : 'Loaded file'}: ${loadedLabel}`);
      setStatus(`${isSwapDisk ? 'Disk swapped' : 'File loaded'}: ${loadedLabel}`);
      event.target.value = '';
      return true;
    } catch (err) {
      setError(err.message);
      addLog(`File load error: ${err.message}`);
      return false;
    }
  }

  useEffect(() => {
    if (
      !(localGameId || localReleaseId)
      || !room
      || !isHost
      || !canControlLocalEmulator
      || !emulatorFrameLoadCount
      || !emulatorFrameRef.current
      || localLibraryLoadAttemptedRef.current
    ) {
      return;
    }

    let cancelled = false;

    async function loadLocalLibraryGame() {
      localLibraryLoadAttemptedRef.current = true;

      try {
        setError('');
        if (localReleaseId) {
          const runtimeRelease = takeRuntimeRelease(localReleaseId);
          if (!runtimeRelease?.files?.length) {
            throw new Error('These local files are no longer available. Return to My Local Games and select the folder again.');
          }
          setLoadedDiskName(runtimeRelease.title);
          setLocalReleaseFiles(runtimeRelease.files);
          setCurrentLocalReleaseIndex(0);
          setStatus(`Loading local release: ${runtimeRelease.title}`);
          addLog(`Loading ${runtimeRelease.files.length} local media file${runtimeRelease.files.length === 1 ? '' : 's'} in release order`);
          const runtimeReleaseLoaded = await handleDiskSelected({
            target: {
              files: runtimeRelease.files,
              dataset: {},
              value: '',
            },
          });
          if (!runtimeReleaseLoaded) return;
          if (cancelled) return;
          if (!hostStartedRef.current && !hostStartingRef.current && !isAmigaAga && !isAtariSt) {
            await startHostSession();
          }
          return;
        }

        const pendingGame = (() => {
          try {
            const stored = sessionStorage.getItem('oldstylegaming:pendingLocalGame');
            return stored ? JSON.parse(stored) : null;
          } catch {
            return null;
          }
        })();
        if (pendingGame?.id === localGameId) {
          setLoadedDiskName(pendingGame.fileName || pendingGame.title || '');
          setStatus(`Loading local game: ${pendingGame.title || pendingGame.fileName}`);
        }

        if (pendingGame?.id === localGameId && pendingGame.source === 'recent-mame-score') {
          setLoadedDiskName(pendingGame.fileName);
          setStatus(`Scoreboard ready for ${pendingGame.title}. Upload ${pendingGame.fileName} to play.`);
          setError(`You do not have ${pendingGame.fileName} in your library. Its high-score table is ready; choose “Load MAME ROM” and upload ${pendingGame.fileName} to play.`);
          addLog(`Recent score game selected: waiting for ${pendingGame.fileName}`);
          sessionStorage.removeItem('oldstylegaming:pendingLocalGame');
          return;
        }

        if (pendingGame?.id === localGameId && pendingGame.source === 'tournament-mame') {
          const code = pendingGame.tournamentCode || tournamentCode;
          if (!code) throw new Error('This tournament launch is missing its tournament code.');
          let romBytes = await takePreparedTournamentMameFile(code, pendingGame.fileName);
          if (!romBytes) {
            const token = localStorage.getItem('token');
            const response = await fetch(
              `${API_BASE_URL}/auth/tournaments/${encodeURIComponent(code)}/files/${encodeURIComponent(pendingGame.fileName)}`,
              { headers: token ? { Authorization: `Bearer ${token}` } : {} },
            );
            if (!response.ok) {
              const errorBody = await response.json().catch(() => null);
              throw new Error(errorBody?.detail || `Could not download ${pendingGame.fileName}`);
            }
            romBytes = new Uint8Array(await response.arrayBuffer());
          }
          if (cancelled) return;
          const file = new File([romBytes], pendingGame.fileName, { type: 'application/zip' });
          await loadArcadeRomFile(
            file,
            [],
            pendingGame.tournamentHiTemplate,
            pendingGame.tournamentSaveNamespace,
          );
          sessionStorage.removeItem('oldstylegaming:pendingLocalGame');
          return;
        }

        if (pendingGame?.id === localGameId && pendingGame.source === 'internet-archive-mame') {
          const hasVipAccess = localStorage.getItem('isVip') === 'true'
            || localStorage.getItem('isAdmin') === 'true'
            || localStorage.getItem('isSuperAdmin') === 'true';
          if (!hasVipAccess) {
            throw new Error('VIP access is required for the remote MAME library.');
          }

          async function downloadVipArchiveFile(directory, fileName) {
            const prepared = await takePreparedVipMameFile(directory, fileName);
            if (prepared) return prepared;
            const token = localStorage.getItem('token');
            const response = await fetch(
              `${API_BASE_URL}/auth/vip/mame/files/${directory}/${encodeURIComponent(fileName)}`,
              { headers: token ? { Authorization: `Bearer ${token}` } : {} },
            );
            if (!response.ok) {
              const errorBody = await response.json().catch(() => null);
              throw new Error(errorBody?.detail || `Could not download ${fileName}`);
            }
            return new Uint8Array(await response.arrayBuffer());
          }

          setStatus(`Downloading VIP MAME ROM: ${pendingGame.fileName}`);
          addLog(`Downloading VIP MAME ROM: ${pendingGame.fileName}`);
          const romBytes = await downloadVipArchiveFile('roms', pendingGame.fileName);
          if (cancelled) return;
          const file = new File([romBytes], pendingGame.fileName, { type: 'application/zip' });
          const sampleFiles = [];
          if (pendingGame.archiveSampleFileName) {
            setStatus(`Downloading MAME samples: ${pendingGame.archiveSampleFileName}`);
            const sampleBytes = await downloadVipArchiveFile('samples', pendingGame.archiveSampleFileName);
            sampleFiles.push({
              fileName: pendingGame.archiveSampleFileName,
              bytes: sampleBytes,
            });
          }
          if (cancelled) return;
          await loadArcadeRomFile(file, sampleFiles);
          sessionStorage.removeItem('oldstylegaming:pendingLocalGame');
          return;
        }

        if (pendingGame?.id === localGameId && pendingGame.source === 'vip-c64-oneload') {
          const hasVipAccess = localStorage.getItem('isVip') === 'true'
            || localStorage.getItem('isAdmin') === 'true'
            || localStorage.getItem('isSuperAdmin') === 'true';
          if (!hasVipAccess) throw new Error('VIP access is required for the C64 OneLoad library.');

          let cartridgeBytes = await takePreparedVipC64File(pendingGame.fileName);
          if (!cartridgeBytes) {
            const token = localStorage.getItem('token');
            const response = await fetch(
              `${API_BASE_URL}/auth/vip/c64/files/${encodeURIComponent(pendingGame.fileName)}`,
              { headers: token ? { Authorization: `Bearer ${token}` } : {} },
            );
            if (!response.ok) {
              const errorBody = await response.json().catch(() => null);
              throw new Error(errorBody?.detail || `Could not download ${pendingGame.fileName}`);
            }
            cartridgeBytes = new Uint8Array(await response.arrayBuffer());
          }
          if (cancelled) return;

          const cartridge = new File(
            [cartridgeBytes],
            pendingGame.fileName,
            { type: 'application/octet-stream' },
          );
          await handleDiskSelected({
            target: {
              files: [cartridge],
              dataset: {},
              value: '',
            },
          });
          if (cancelled) return;
          sessionStorage.removeItem('oldstylegaming:pendingLocalGame');
          if (!hostStartedRef.current && !hostStartingRef.current) await startHostSession();
          return;
        }

        if (pendingGame?.id === localGameId && pendingGame.source === 'vip-amstrad-ghostware') {
          const hasVipAccess = localStorage.getItem('isVip') === 'true'
            || localStorage.getItem('isAdmin') === 'true'
            || localStorage.getItem('isSuperAdmin') === 'true';
          if (!hasVipAccess) throw new Error('VIP access is required for the Amstrad CPC archive library.');

          let gameBytes = await takePreparedVipAmstradFile(pendingGame.fileName);
          if (!gameBytes) {
            const token = localStorage.getItem('token');
            const response = await fetch(
              `${API_BASE_URL}/auth/vip/amstrad/files/${encodeURIComponent(pendingGame.fileName)}`,
              { headers: token ? { Authorization: `Bearer ${token}` } : {} },
            );
            if (!response.ok) {
              const errorBody = await response.json().catch(() => null);
              throw new Error(errorBody?.detail || `Could not download ${pendingGame.fileName}`);
            }
            gameBytes = new Uint8Array(await response.arrayBuffer());
          }
          if (cancelled) return;
          const file = new File([gameBytes], pendingGame.fileName, { type: 'application/zip' });
          const loaded = await handleDiskSelected({
            target: { files: [file], dataset: {}, value: '' },
          });
          if (!loaded || cancelled) return;
          sessionStorage.removeItem('oldstylegaming:pendingLocalGame');
          if (!hostStartedRef.current && !hostStartingRef.current) await startHostSession();
          return;
        }

        if (pendingGame?.id === localGameId && pendingGame.source === 'vip-spectrum-z80') {
          const hasVipAccess = localStorage.getItem('isVip') === 'true'
            || localStorage.getItem('isAdmin') === 'true'
            || localStorage.getItem('isSuperAdmin') === 'true';
          if (!hasVipAccess) throw new Error('VIP access is required for the ZX Spectrum archive library.');

          let gameBytes = await takePreparedVipSpectrumFile(pendingGame.fileName);
          if (!gameBytes) {
            const token = localStorage.getItem('token');
            const response = await fetch(
              `${API_BASE_URL}/auth/vip/spectrum/files/${encodeURIComponent(pendingGame.fileName)}`,
              { headers: token ? { Authorization: `Bearer ${token}` } : {} },
            );
            if (!response.ok) {
              const errorBody = await response.json().catch(() => null);
              throw new Error(errorBody?.detail || `Could not download ${pendingGame.fileName}`);
            }
            gameBytes = new Uint8Array(await response.arrayBuffer());
          }
          if (cancelled) return;
          const file = new File([gameBytes], pendingGame.fileName, { type: 'application/zip' });
          const loaded = await handleDiskSelected({
            target: { files: [file], dataset: {}, value: '' },
          });
          if (!loaded || cancelled) return;
          sessionStorage.removeItem('oldstylegaming:pendingLocalGame');
          if (!hostStartedRef.current && !hostStartingRef.current) await startHostSession();
          return;
        }

        if (pendingGame?.id === localGameId && pendingGame.source === 'vip-megadrive-ghostware') {
          const hasVipAccess = localStorage.getItem('isVip') === 'true'
            || localStorage.getItem('isAdmin') === 'true'
            || localStorage.getItem('isSuperAdmin') === 'true';
          if (!hasVipAccess) throw new Error('VIP access is required for the Mega Drive archive library.');

          let gameBytes = await takePreparedVipMegadriveFile(pendingGame.fileName);
          if (!gameBytes) {
            const token = localStorage.getItem('token');
            const response = await fetch(
              `${API_BASE_URL}/auth/vip/megadrive/files/${encodeURIComponent(pendingGame.fileName)}`,
              { headers: token ? { Authorization: `Bearer ${token}` } : {} },
            );
            if (!response.ok) {
              const errorBody = await response.json().catch(() => null);
              throw new Error(errorBody?.detail || `Could not download ${pendingGame.fileName}`);
            }
            gameBytes = new Uint8Array(await response.arrayBuffer());
          }
          if (cancelled) return;
          const file = new File([gameBytes], pendingGame.fileName, { type: 'application/zip' });
          const loaded = await handleDiskSelected({
            target: { files: [file], dataset: {}, value: '' },
          });
          if (!loaded || cancelled) return;
          sessionStorage.removeItem('oldstylegaming:pendingLocalGame');
          if (!hostStartedRef.current && !hostStartingRef.current) await startHostSession();
          return;
        }

        if (pendingGame?.id === localGameId && pendingGame.source === 'vip-pcengine-nointro') {
          const hasVipAccess = localStorage.getItem('isVip') === 'true'
            || localStorage.getItem('isAdmin') === 'true'
            || localStorage.getItem('isSuperAdmin') === 'true';
          if (!hasVipAccess) throw new Error('VIP access is required for the PC Engine archive library.');

          let gameBytes = await takePreparedVipPcengineFile(pendingGame.fileName);
          if (!gameBytes) {
            const token = localStorage.getItem('token');
            const response = await fetch(
              `${API_BASE_URL}/auth/vip/pcengine/files/${encodeURIComponent(pendingGame.fileName)}`,
              { headers: token ? { Authorization: `Bearer ${token}` } : {} },
            );
            if (!response.ok) {
              const errorBody = await response.json().catch(() => null);
              throw new Error(errorBody?.detail || `Could not download ${pendingGame.fileName}`);
            }
            gameBytes = new Uint8Array(await response.arrayBuffer());
          }
          if (cancelled) return;
          const file = new File([gameBytes], pendingGame.fileName, { type: 'application/x-7z-compressed' });
          const loaded = await handleDiskSelected({
            target: { files: [file], dataset: {}, value: '' },
          });
          if (!loaded || cancelled) return;
          sessionStorage.removeItem('oldstylegaming:pendingLocalGame');
          if (!hostStartedRef.current && !hostStartingRef.current) await startHostSession();
          return;
        }

        if (pendingGame?.id === localGameId && pendingGame.source === 'vip-mastersystem-nointro') {
          const hasVipAccess = localStorage.getItem('isVip') === 'true'
            || localStorage.getItem('isAdmin') === 'true'
            || localStorage.getItem('isSuperAdmin') === 'true';
          if (!hasVipAccess) throw new Error('VIP access is required for the Master System archive library.');

          let archiveBytes = await takePreparedVipMastersystemFile(pendingGame.fileName);
          if (!archiveBytes) {
            const token = localStorage.getItem('token');
            const response = await fetch(
              `${API_BASE_URL}/auth/vip/mastersystem/files/${encodeURIComponent(pendingGame.fileName)}`,
              { headers: token ? { Authorization: `Bearer ${token}` } : {} },
            );
            if (!response.ok) {
              const errorBody = await response.json().catch(() => null);
              throw new Error(errorBody?.detail || `Could not download ${pendingGame.fileName}`);
            }
            archiveBytes = new Uint8Array(await response.arrayBuffer());
          }
          if (cancelled) return;
          setStatus('Extracting Master System ROM');
          const extracted = await extractPrepared7zFile(archiveBytes, ['.sms']);
          const file = new File([extracted.bytes], extracted.fileName, { type: 'application/octet-stream' });
          const loaded = await handleDiskSelected({
            target: { files: [file], dataset: {}, value: '' },
          });
          if (!loaded || cancelled) return;
          sessionStorage.removeItem('oldstylegaming:pendingLocalGame');
          if (!hostStartedRef.current && !hostStartingRef.current) await startHostSession();
          return;
        }

        if (pendingGame?.id === localGameId && pendingGame.source === 'vip-snes-gameplay') {
          const hasVipAccess = localStorage.getItem('isVip') === 'true'
            || localStorage.getItem('isAdmin') === 'true'
            || localStorage.getItem('isSuperAdmin') === 'true';
          if (!hasVipAccess) throw new Error('VIP access is required for the SNES archive library.');

          const token = localStorage.getItem('token');
          const response = await fetch(
            `${API_BASE_URL}/auth/vip/snes/files/${encodeURIComponent(pendingGame.fileName)}`,
            { headers: token ? { Authorization: `Bearer ${token}` } : {} },
          );
          if (!response.ok) {
            const errorBody = await response.json().catch(() => null);
            throw new Error(errorBody?.detail || `Could not download ${pendingGame.fileName}`);
          }
          const archiveBytes = new Uint8Array(await response.arrayBuffer());
          if (cancelled) return;
          setStatus('Extracting SNES ROM');
          const extracted = await extractPrepared7zFile(archiveBytes, ['.sfc', '.smc'], {
            preferredFileName: pendingGame.archiveEntryName || '',
            preferredTitle: pendingGame.title || '',
          });
          const file = new File([extracted.bytes], extracted.fileName, { type: 'application/octet-stream' });
          const loaded = await handleDiskSelected({
            target: { files: [file], dataset: {}, value: '' },
          });
          if (!loaded || cancelled) return;
          sessionStorage.removeItem('oldstylegaming:pendingLocalGame');
          if (!hostStartedRef.current && !hostStartingRef.current) await startHostSession();
          return;
        }

        if (pendingGame?.id === localGameId && pendingGame.source === 'vip-nes-megapack') {
          const hasVipAccess = localStorage.getItem('isVip') === 'true'
            || localStorage.getItem('isAdmin') === 'true'
            || localStorage.getItem('isSuperAdmin') === 'true';
          if (!hasVipAccess) throw new Error('VIP access is required for the NES archive library.');

          let gameBytes = await takePreparedVipNesFile(pendingGame.archiveMemberPath);
          if (!gameBytes) {
            const token = localStorage.getItem('token');
            const response = await fetch(
              `${API_BASE_URL}/auth/vip/nes/file?member=${encodeURIComponent(pendingGame.archiveMemberPath)}`,
              { headers: token ? { Authorization: `Bearer ${token}` } : {} },
            );
            if (!response.ok) {
              const errorBody = await response.json().catch(() => null);
              throw new Error(errorBody?.detail || `Could not download ${pendingGame.fileName}`);
            }
            gameBytes = new Uint8Array(await response.arrayBuffer());
          }
          if (cancelled) return;
          const file = new File([gameBytes], pendingGame.fileName, { type: 'application/octet-stream' });
          const loaded = await handleDiskSelected({
            target: { files: [file], dataset: {}, value: '' },
          });
          if (!loaded || cancelled) return;
          sessionStorage.removeItem('oldstylegaming:pendingLocalGame');
          if (!hostStartedRef.current && !hostStartingRef.current) await startHostSession();
          return;
        }

        if (pendingGame?.id === localGameId && pendingGame.source === 'vip-amiga-whdload') {
          const hasVipAccess = localStorage.getItem('isVip') === 'true'
            || localStorage.getItem('isAdmin') === 'true'
            || localStorage.getItem('isSuperAdmin') === 'true';
          if (!hasVipAccess) throw new Error('VIP access is required for the Amiga WHDLoad library.');

          let gameBytes = await takePreparedVipAmigaFile(pendingGame.fileName);
          if (!gameBytes) {
            const token = localStorage.getItem('token');
            const response = await fetch(
              `${API_BASE_URL}/auth/vip/amiga/files/${encodeURIComponent(pendingGame.fileName)}`,
              { headers: token ? { Authorization: `Bearer ${token}` } : {} },
            );
            if (!response.ok) {
              const errorBody = await response.json().catch(() => null);
              throw new Error(errorBody?.detail || `Could not download ${pendingGame.fileName}`);
            }
            gameBytes = new Uint8Array(await response.arrayBuffer());
          }
          if (cancelled) return;

          const whdLoadFile = new File(
            [gameBytes],
            pendingGame.fileName,
            { type: 'application/octet-stream' },
          );
          const gameLoaded = await handleDiskSelected({
            target: {
              files: [whdLoadFile],
              dataset: {},
              value: '',
            },
          });
          if (!gameLoaded || cancelled) return;
          sessionStorage.removeItem('oldstylegaming:pendingLocalGame');
          if (!hostStartedRef.current && !hostStartingRef.current) await startHostSession();
          return;
        }

        const game = await getLocalLibraryGame(localGameId);
        if (!game?.handle) {
          throw new Error('That local library game is no longer available. Re-scan your ROM folder.');
        }

        if (isAmigaFamily) {
          const selectedTitle = normaliseFilename(game.fileName || game.title || '').cleanedTitle.toLowerCase();
          const storedGames = await getLocalLibraryGames();
          const siblingGames = storedGames.filter((candidate) => (
            (candidate.system === 'amiga' || candidate.system === 'amiga_aga')
            && candidate.handle
            && normaliseFilename(candidate.fileName || candidate.title || '').cleanedTitle.toLowerCase() === selectedTitle
          ));
          const siblingFiles = [];
          for (const sibling of siblingGames) {
            if (typeof sibling.handle.queryPermission === 'function') {
              let permission = await sibling.handle.queryPermission({ mode: 'read' });
              if (permission !== 'granted' && typeof sibling.handle.requestPermission === 'function') {
                permission = await sibling.handle.requestPermission({ mode: 'read' });
              }
              if (permission !== 'granted') continue;
            }
            siblingFiles.push(await sibling.handle.getFile());
          }
          if (siblingFiles.length) {
            const scannedFiles = await scanLocalReleaseFiles(siblingFiles, { platform: 'amiga' });
            const groupedGame = groupLocalReleaseFiles(scannedFiles)
              .find((candidate) => candidate.title.toLowerCase() === selectedTitle);
            const release = groupedGame ? resolveRelease(groupedGame) : null;
            if (release?.media?.length) {
              const releaseFiles = release.media
                .slice()
                .sort((left, right) => (left.diskNumber || 1) - (right.diskNumber || 1))
                .map((media) => media.file);
              if (releaseFiles.length > 1 && !isPuaeAmiga) {
                const launchId = `local-amiga:${groupedGame.id}:${release.id}:${Date.now()}`;
                registerRuntimeRelease(launchId, {
                  gameId: groupedGame.id,
                  releaseId: release.id,
                  title: groupedGame.title,
                  files: releaseFiles,
                  roomSystem: 'amiga_aga',
                });
                setStatus(`Opening ${groupedGame.title} with the multidisk PUAE player...`);
                const multidiskRoom = await apiFetch('/rooms/create', {
                  method: 'POST',
                  body: JSON.stringify({
                    system: 'amiga_aga',
                    party_max_players: 2,
                  }),
                });
                const nextParams = new URLSearchParams({
                  localRelease: launchId,
                  returnTo: libraryReturnPath,
                });
                navigate(`/room/${multidiskRoom.room_code}?${nextParams.toString()}`, { replace: true });
                return;
              }
              setLocalReleaseFiles(releaseFiles);
              setCurrentLocalReleaseIndex(0);
              setLoadedDiskName(releaseFiles[0].name);
              setStatus(`Loading ${groupedGame.title}: ${releaseFiles.length} disk${releaseFiles.length === 1 ? '' : 's'} available`);
              addLog(`Resolved local Amiga release with ${releaseFiles.length} ordered disk${releaseFiles.length === 1 ? '' : 's'}`);
              const releaseLoaded = await handleDiskSelected({
                target: {
                  files: releaseFiles,
                  dataset: {},
                  value: '',
                },
              });
              if (!releaseLoaded) return;
              if (!hostStartedRef.current && !hostStartingRef.current && !isAmigaAga && !isAtariSt) {
                await startHostSession();
              }
              sessionStorage.removeItem('oldstylegaming:pendingLocalGame');
              return;
            }
          }
        }

        if (typeof game.handle.queryPermission === 'function') {
          let permission = await game.handle.queryPermission({ mode: 'read' });
          if (permission !== 'granted' && typeof game.handle.requestPermission === 'function') {
            permission = await game.handle.requestPermission({ mode: 'read' });
          }
          if (permission !== 'granted') {
            throw new Error('Browser permission is needed to read that local ROM.');
          }
        }

        const file = await game.handle.getFile();
        if (cancelled) return;

        setLoadedDiskName(file.name);
        setStatus(`Loading local game: ${game.title || file.name}`);
        addLog(`Loading local library game: ${game.path || file.name}`);

        if (isArcade) {
          const folder = game.folderId ? await getLocalLibraryFolder(game.folderId) : null;
          const samples = Array.isArray(folder?.samples) ? folder.samples : [];
          const metadata = getArcadeRomMetadata(file.name);
          const sampleKeys = [metadata.romKey, metadata.parent].filter(Boolean);
          const sampleFiles = [];

          for (const sampleKey of sampleKeys) {
            const sample = samples.find((item) => item.key === sampleKey);
            if (!sample?.handle) continue;
            const sampleFile = await sample.handle.getFile();
            sampleFiles.push({
              fileName: sampleFile.name,
              bytes: new Uint8Array(await sampleFile.arrayBuffer()),
            });
          }

          if (sampleFiles.length) {
            addLog(`Loaded MAME samples: ${sampleFiles.map((sample) => sample.fileName).join(', ')}`);
          }
          await loadArcadeRomFile(file, sampleFiles);
          sessionStorage.removeItem('oldstylegaming:pendingLocalGame');
          return;
        }

        const gameLoaded = await handleDiskSelected({
          target: {
            files: [file],
            dataset: {},
            value: '',
          },
        });
        if (!gameLoaded) return;

        if (cancelled) return;

        if (!hostStartedRef.current && !hostStartingRef.current && !isAmigaAga && !isAtariSt) {
          await startHostSession();
        }
        sessionStorage.removeItem('oldstylegaming:pendingLocalGame');
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
        addLog(`Local library load error: ${err.message}`);
        setStatus('Local library game could not be loaded');
      }
    }

    loadLocalLibraryGame();

    return () => {
      cancelled = true;
    };
  }, [canControlLocalEmulator, emulatorFrameLoadCount, isAmigaAga, isPuaeAmiga, isArcade, isAtariSt, isHost, localGameId, localGameReloadToken, localReleaseId, room, tournamentCode]);

  async function handleKickstartSelected(event) {
    try {
      const file = event.target.files?.[0];

      if (!file) return;

      const lowerName = file.name.toLowerCase();
      const allowedExtensions = ['.rom', '.bin', '.kick', '.kickstart'];

      if (!allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
        setError('Kickstart must be a .rom or .bin file');
        addLog(`Rejected Kickstart ROM: ${file.name}`);
        event.target.value = '';
        return;
      }

      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      if (kickstartStorageKey) {
        savedSystemMediaRef.current.set(kickstartStorageKey, { fileName: file.name, bytes });
      }

      if (kickstartStorageKey) {
        try {
          await saveStoredKickstart(kickstartStorageKey, file.name, bytes);
          addLog(`Saved Kickstart ROM for next time: ${file.name}`);
        } catch (err) {
          addLog(`Could not save Kickstart ROM: ${err.message}`);
        }
      }

      forwardInputToEmulator(buildAmigaKickstartPayload(roomSystem, file.name, bytes));

      setKickstartRomName(file.name);
      addLog(`Loaded Kickstart ROM for this session: ${file.name}`);
      setStatus(`Kickstart loaded: ${file.name}`);
      event.target.value = '';
    } catch (err) {
      setError(err.message);
      addLog(`Kickstart load error: ${err.message}`);
    }
  }

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(roomCode);
      setRoomCodeCopied(true);
      window.setTimeout(() => setRoomCodeCopied(false), 1800);
    } catch {
      setError('Could not copy the room code');
    }
  }

  async function handlePlayStationBiosSelected(event) {
    try {
      const file = event.target.files?.[0];
      if (!file) return;

      const lowerName = file.name.toLowerCase();
      if (!lowerName.endsWith('.bin') && !lowerName.endsWith('.rom')) {
        setError(`${isSaturn ? 'Saturn' : 'PlayStation'} BIOS must be a .bin or .rom file`);
        event.target.value = '';
        return;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isSaturn && bytes.length !== 512 * 1024) {
        setError('Saturn BIOS must be exactly 512 KB');
        event.target.value = '';
        return;
      }
      if (isSaturn) {
        savedSystemMediaRef.current.set(SATURN_BIOS_KEY, { fileName: file.name, bytes });
      }
      if (!isSaturn) {
        await saveStoredKickstart(PLAYSTATION_BIOS_KEY, file.name, bytes);
      }
      forwardInputToEmulator({
        type: isSaturn ? 'saturn_bios' : 'playstation_bios',
        fileName: file.name,
        bytes,
      });
      setPlaystationBiosName(`${file.name} (${isSaturn ? 'this session' : 'saved locally'})`);
      addLog(`${isSaturn ? 'Loaded' : 'Saved'} ${isSaturn ? 'Saturn' : 'PlayStation'} BIOS ${isSaturn ? 'for this session' : 'locally'}: ${file.name}`);
      setStatus(`${isSaturn ? 'Saturn' : 'PlayStation'} BIOS ready: ${file.name}`);
      event.target.value = '';
    } catch (err) {
      setError(err.message);
      addLog(`${isSaturn ? 'Saturn' : 'PlayStation'} BIOS error: ${err.message}`);
    }
  }

  async function handleAtariTosSelected(event) {
    try {
      const file = event.target.files?.[0];
      if (!file) return;

      const lowerName = file.name.toLowerCase();
      if (!['.img', '.rom', '.bin'].some((extension) => lowerName.endsWith(extension))) {
        setError('Atari TOS must be an .img, .rom, or .bin file');
        event.target.value = '';
        return;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      if (![192, 256, 512, 1024].includes(bytes.length / 1024)) {
        setError('Atari TOS ROM must be 192 KB, 256 KB, 512 KB, or 1024 KB');
        event.target.value = '';
        return;
      }

      await saveStoredKickstart(ATARI_ST_TOS_KEY, file.name, bytes);
      setAtariTosName(`${file.name} (saved locally)`);
      if (hostStarted) {
        setHostStarted(false);
        hostStartedRef.current = false;
        hostStartingRef.current = false;
        await reloadAtariStFrame();
      }
      forwardInputToEmulator({ type: 'atarist_tos', fileName: file.name, bytes });
      addLog(`Loaded local Atari TOS: ${file.name}`);
      setStatus(`Atari TOS ready: ${file.name}. Load a disk to start`);
      event.target.value = '';
    } catch (err) {
      setError(err.message);
      addLog(`Atari TOS load error: ${err.message}`);
    }
  }

  function chooseControlProfile(profile) {
    setSelectedControlProfile(profile);
    setControlProfileDrawerOpen(true);
    addLog(`Selected Amstrad instructions: ${profile.title}`);
  }

  return (
    <div className={`page room-page ${obsCaptureMode ? 'obs-capture-page' : ''}`}>
      <div className={`page-social-layout room-social-layout ${supportsMameScoreboard && isSoloMode ? 'solo-arcade-layout' : ''}`}>
        <div className="card room-card">
        <div className="room-topbar">
          <div className="room-title">
            <BrandMark compact />
            <div className="room-code-row">
              <h1>{isArcade ? 'MAME Cabinet' : isSoloMode ? '1 Player' : `Room ${roomCode}`}</h1>
              {(!isSoloMode || isArcade) ? (
                <button className="secondary" type="button" onClick={copyRoomCode}>
                  {roomCodeCopied ? 'Copied' : 'Copy code'}
                </button>
              ) : null}
            </div>
            <div className="room-identity">
              <span>You are</span>
              <strong>{username}</strong>
              <small>{roleLabel} · {systemLabel}</small>
            </div>
          </div>

          <div className="room-actions">
            <Link className="button-like secondary" to={tournamentCode ? `/tournaments/${tournamentCode}` : '/library'}>
              {tournamentCode ? 'Tournament' : 'Library'}
            </Link>
            {isSoloMode && isHost && !isArcade ? (
              <button type="button" className="secondary" onClick={invitePlayerFromSolo} disabled={soloInviteBusy}>
                {soloInviteBusy ? 'Creating...' : inviteCopied ? 'Invite copied' : 'Invite player'}
              </button>
            ) : null}
            <button className="secondary" onClick={leaveRoom}>
              Leave
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setShowDiagnostics((value) => !value)}
            >
              {showDiagnostics ? 'Hide diagnostics' : 'Diagnostics'}
            </button>
          </div>
        </div>

        {isArcade ? (
          <div className="arcade-mode-strip">
            <div>
              <strong>{isSoloMode ? 'Single-player cabinet' : 'Multiplayer cabinet'}</strong>
              <span>{isSoloMode
                ? 'Play locally. Switch to multiplayer whenever you want to open the cabinet to friends.'
                : `P1 belongs to the host. P2 belongs to the first player at the cabinet; everyone else can watch and put a 10p in the queue.`}</span>
            </div>
            {isHost ? (
              <div className="arcade-mode-toggle" role="group" aria-label="Cabinet mode">
                <button
                  type="button"
                  className={isSoloMode ? 'active' : 'secondary'}
                  onClick={() => setArcadeCabinetMode(false)}
                  disabled={switchingSystem}
                >
                  Single player
                </button>
                <button
                  type="button"
                  className={!isSoloMode ? 'active' : 'secondary'}
                  onClick={() => setArcadeCabinetMode(true)}
                  disabled={switchingSystem}
                >
                  Multiplayer
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="room-summary">
          <div className="player-strip" aria-label="Players">
            {displayedPlayers.map((player) => (
              <div
                key={player.playerNumber}
                className={`player-card ${player.connected ? 'connected' : ''} ${player.playerNumber === currentPartyPlayerNumber ? 'you' : ''}`}
              >
                <span>{typeof player.playerNumber === 'number' ? `P${player.playerNumber}` : 'Watch'}</span>
                <strong>{player.username}</strong>
                <small>{player.role}</small>
              </div>
            ))}
          </div>

          <div className="health-strip" aria-label="Connection status">
            {healthItems.map((item) => (
              <span key={item.label} className={`health-item ${item.ok ? 'ok' : 'waiting'}`}>
                <span className="health-dot" aria-hidden="true" />
                {item.label}
              </span>
            ))}
          </div>
        </div>

        {isSoloMode && soloInviteRoom ? (
          <div className="session-strip invite-room-strip">
            <div>
              <strong>Multiplayer room ready</strong>
              <span>Code {soloInviteRoom.code}. Your solo game is still running here; open the multiplayer room when you want guests to join.</span>
            </div>
            <Link className="button-like" to={soloInviteRoom.path}>
              Open multiplayer room
            </Link>
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(soloInviteRoom.url);
                setInviteCopied(true);
                window.setTimeout(() => setInviteCopied(false), 1400);
              }}
            >
              {inviteCopied ? 'Copied' : 'Copy invite'}
            </button>
          </div>
        ) : null}

        {(loadedDiskName || isAmigaFamily || isDiscConsole || isAtariSt) ? (
          <div className="session-strip">
            {loadedDiskName ? <span>{loadedDiskName}</span> : null}
            {isCpcSystem && selectedControlProfile ? (
              <button type="button" className="secondary control-profile-pill" onClick={() => setControlProfileDrawerOpen(true)}>
                Instructions: {selectedControlProfile.title}
              </button>
            ) : null}
            {isCpcSystem && !selectedControlProfile && controlProfileMatches.length > 0 ? (
              <button type="button" className="secondary control-profile-pill" onClick={() => setControlProfileDrawerOpen(true)}>
                Choose instructions ({controlProfileMatches.length})
              </button>
            ) : null}
            {isAmigaFamily ? <span>{kickstartRomName ? `Kickstart: ${kickstartRomName}` : isPuaeAmiga ? `ROM: ${isAmigaAga ? 'A1200 Kickstart 3.1' : 'A500 Kickstart 1.3'} required` : 'ROM: AROS'}</span> : null}
            {isDiscConsole ? <span>{playstationBiosName ? `BIOS: ${playstationBiosName}` : isSaturn ? 'BIOS: load saturn_bios.bin locally' : 'BIOS: HLE fallback / load your own locally'}</span> : null}
            {isAtariSt ? <span>{atariTosName ? `TOS: ${atariTosName}` : 'TOS: EmuTOS 1.4 (built in)'}</span> : null}
            {isAmigaLink ? <span>Serial: {serialActivity.sent} sent / {serialActivity.received} received</span> : null}
          </div>
        ) : null}

        {showDiagnostics ? (
          <div className="session-strip diagnostics-summary">
            <span>{status}</span>
            {!isSharedCpcParty && !isSoloMode ? <span>{micStatus}</span> : null}
            <span>{controlLabel}</span>
          </div>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        <audio ref={remoteVoiceAudioRef} autoPlay playsInline />

        <div className={`room-layout ${localGamePickerOpen ? 'with-local-game-picker' : ''}`}>
          <div className={`panel video-panel ${isScreenFullscreen ? 'fullscreen-screen' : ''} ${isScreenFullscreen && isArcade ? 'arcade-fullscreen' : ''} ${isScreenFullscreen && isSharedCpcParty ? 'party-fullscreen' : ''} ${isScreenFullscreen && !isSoloMode && !showFullscreenArcadeLeaderboard ? 'fullscreen-with-chat' : ''} ${showFullscreenArcadeLeaderboard ? 'fullscreen-with-score' : ''}`}>
            {obsCaptureMode ? (
              <button type="button" className="secondary obs-capture-exit" onClick={() => setObsCaptureMode(false)}>
                Back to room
              </button>
            ) : null}
            <div className="play-header">
              <h2>{isSoloMode || isAmigaLink ? 'Local screen' : isHost ? 'Host screen' : 'Remote screen'}</h2>

              <div className="input-toolbar">
                <div className="assigned-control" aria-label="Assigned control">
                  {assignedControlLabel}
                </div>

                {!isSharedCpcParty && !isSoloMode ? (
                  <div className="mic-controls">
                    <button
                      type="button"
                      className={micEnabled && !micMuted ? 'active' : 'secondary'}
                      onClick={toggleMicrophone}
                    >
                      {micEnabled ? (micMuted ? 'Mic muted' : 'Mic on') : 'Mic off'}
                    </button>

                    <select
                      aria-label="Microphone"
                      value={selectedMicDeviceId}
                      onFocus={refreshMicrophoneDevices}
                      onChange={(event) => {
                        const nextDeviceId = event.target.value;
                        setSelectedMicDeviceId(nextDeviceId);
                        if (micEnabled) {
                          openMicrophone(nextDeviceId);
                        }
                      }}
                    >
                      <option value="">Default mic</option>
                      {micDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {!autoCaptureController ? (
                  <button
                    type="button"
                    className={inputCaptured ? 'danger' : 'secondary'}
                    onClick={inputCaptured ? releaseInputCapture : captureInput}
                  >
                    {inputCaptured ? 'Release' : 'Capture'}
                  </button>
                ) : null}

                {supportsControllerMapping(roomSystem) && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setControllerSetupOpen(true)}
                  >
                    Controller Setup
                  </button>
                )}

                <button
                  type="button"
                  className="secondary"
                  onClick={() => setIsScreenFullscreen((value) => !value)}
                >
                  {isScreenFullscreen ? 'Back to room' : 'Fullscreen'}
                </button>

                <button
                  type="button"
                  className="secondary"
                  onClick={() => setObsCaptureMode(true)}
                >
                  OBS view
                </button>
              </div>
            </div>

            <div className={`capture-state ${inputCaptured ? 'captured' : ''}`}>
              {inputCaptured
                ? `${controlLabel} active`
                : remotePlaybackBlocked
                  ? autoCaptureController ? 'Click the screen to start stream playback' : 'Tap Capture to start stream'
                  : autoCaptureController ? `${controlLabel} ready` : 'Click the screen or press Capture to play'}
            </div>

            {canControlLocalEmulator ? (
              <>
                {isArcade ? (
                  <div className={`arcade-play-layout ${isScreenFullscreen ? 'fullscreen' : ''}`}>
                    <div className="arcade-screen-stack">
                      <iframe
                        key={`${roomSystem}-${emulatorSessionKey}`}
                        ref={emulatorFrameRef}
                        className="arcade-emulator-frame"
                        title={emulatorTitle}
                        src={emulatorSrc}
                        onLoad={() => setEmulatorFrameLoadCount((count) => count + 1)}
                        style={{
                          position: 'relative',
                          left: 'auto',
                          top: 'auto',
                          display: 'block',
                          width: '640px',
                          height: '480px',
                          maxWidth: '100%',
                          margin: '0 auto',
                          border: '1px solid #1f2f4a',
                          borderRadius: '6px',
                          background: '#000',
                          opacity: 1,
                          pointerEvents: 'auto',
                        }}
                      />
                      <canvas
                        ref={mirrorCanvasRef}
                        aria-hidden="true"
                        width={768}
                        height={576}
                        style={{
                          position: 'absolute',
                          left: '-9999px',
                          top: '0',
                          width: '1px',
                          height: '1px',
                          opacity: 0,
                          pointerEvents: 'none',
                        }}
                      />
                    </div>
                    {!isScreenFullscreen || showFullscreenArcadeLeaderboard
                      ? renderMameLeaderboardPanel(showFullscreenArcadeLeaderboard ? 'fullscreen-score-panel' : 'side')
                      : null}
                  </div>
                ) : (
                  <div className={supportsAmigaScoreboard ? 'amiga-score-layout' : undefined}>
                    <div className={supportsAmigaScoreboard ? 'amiga-score-screen' : undefined}>
                    <iframe
                      key={`${roomSystem}-${emulatorSessionKey}`}
                      ref={emulatorFrameRef}
                      title={emulatorTitle}
                      src={emulatorSrc}
                      onLoad={() => setEmulatorFrameLoadCount((count) => count + 1)}
                      style={{
                        position: isBeetleSaturn ? 'relative' : 'absolute',
                        left: '0',
                        top: '0',
                        display: isBeetleSaturn ? 'block' : 'inline',
                        width: isBeetleSaturn ? '100%' : '768px',
                        height: isBeetleSaturn ? 'auto' : '544px',
                        aspectRatio: isBeetleSaturn ? '4 / 3' : undefined,
                        border: isBeetleSaturn ? '1px solid #1f2f4a' : '0',
                        borderRadius: isBeetleSaturn ? '8px' : '0',
                        background: '#000',
                        opacity: isBeetleSaturn ? 1 : 0,
                        pointerEvents: isBeetleSaturn ? 'auto' : 'none',
                      }}
                    />

                    <canvas
                      ref={mirrorCanvasRef}
                      className={`video ${isMasterSystem ? 'master-system-video' : ''}`}
                      onClick={captureInput}
                      onPointerDown={handleAmigaPointerDown}
                      onPointerUp={handleAmigaPointerUp}
                      onPointerMove={handleAmigaPointerMove}
                      onContextMenu={(event) => {
                        if (isMouseComputer) event.preventDefault();
                      }}
                      style={{
                        width: '100%',
                        aspectRatio: '4 / 3',
                        border: '1px solid #1f2f4a',
                        borderRadius: '8px',
                        background: '#000',
                        display: isBeetleSaturn ? 'none' : 'block',
                      }}
                      width={768}
                      height={544}
                    />
                    </div>
                    {renderAmigaLeaderboardPanel()}
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={acceptedMedia}
                  multiple={isAmigaFamily || isDiscConsole || isC64 || isAtariSt || isX68000}
                  data-mode="load"
                  onChange={handleDiskSelected}
                  style={{ display: 'none' }}
                />

                {isAmigaFamily ? (
                  <input
                    ref={swapDiskInputRef}
                    type="file"
                    accept={acceptedMedia}
                    data-mode="swap"
                    onChange={handleDiskSelected}
                    style={{ display: 'none' }}
                  />
                ) : null}

                {isDiscConsole ? (
                  <input
                    ref={playstationBiosInputRef}
                    type="file"
                    accept=".bin,.rom"
                    onChange={handlePlayStationBiosSelected}
                    style={{ display: 'none' }}
                  />
                ) : null}

                {isAmigaFamily ? (
                  <input
                    ref={kickstartInputRef}
                    type="file"
                    accept=".rom,.bin,.kick,.kickstart"
                    onChange={handleKickstartSelected}
                    style={{ display: 'none' }}
                  />
                ) : null}

                {isAtariSt ? (
                  <input
                    ref={atariTosInputRef}
                    type="file"
                    accept=".img,.rom,.bin"
                    onChange={handleAtariTosSelected}
                    style={{ display: 'none' }}
                  />
                ) : null}

                {isX68000 ? (
                  <input
                    ref={x68000FirmwareInputRef}
                    type="file"
                    accept=".dat,.zip"
                    multiple
                    onChange={handleX68000FirmwareSelected}
                    style={{ display: 'none' }}
                  />
                ) : null}

                <div
                  className="host-control-bar"
                  style={{
                    display: 'flex',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  {isHost && !isSoloMode ? (
                    <div className="room-system-switch">
                      <label>
                        <span>System</span>
                        <select
                          value={selectedRoomSystem}
                          onChange={(event) => setSelectedRoomSystem(event.target.value)}
                          disabled={switchingSystem}
                        >
                          {ROOM_SYSTEM_OPTIONS.filter(([value]) => value !== 'x68000' || isSuperAdmin).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="secondary"
                        onClick={switchRoomSystem}
                        disabled={switchingSystem || selectedRoomSystem === roomSystem}
                      >
                        {switchingSystem ? 'Switching...' : 'Switch system'}
                      </button>
                    </div>
                  ) : null}

                  {isAtari8 && canControlLocalEmulator ? (
                    <div className="room-system-switch atari8-machine-switch">
                      <label>
                        <span>Atari model</span>
                        <select
                          value={atari8Config.model}
                          onChange={(event) => updateAtari8Config({ model: event.target.value })}
                        >
                          {ATARI8_MODEL_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>RAM</span>
                        <select
                          value={String(atari8Config.memory)}
                          onChange={(event) => updateAtari8Config({ memory: Number(event.target.value) })}
                        >
                          {atari8RamOptions.map((memory) => (
                            <option key={memory} value={memory}>{memory}K</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>BASIC</span>
                        <select
                          value={atari8Config.basicDisabled ? 'off' : 'on'}
                          onChange={(event) => updateAtari8Config({ basicDisabled: event.target.value === 'off' })}
                        >
                          <option value="off">Off</option>
                          <option value="on">On</option>
                        </select>
                      </label>
                      <label>
                        <span>TV</span>
                        <select
                          value={atari8Config.tv}
                          onChange={(event) => updateAtari8Config({ tv: event.target.value })}
                        >
                          <option value="ntsc">NTSC</option>
                          <option value="pal">PAL</option>
                        </select>
                      </label>
                      <label>
                        <span>OS</span>
                        <select
                          value={atari8Config.os}
                          onChange={(event) => updateAtari8Config({ os: event.target.value })}
                        >
                          {ATARI8_OS_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                      {atari8Config.memory > 64 ? (
                        <label className="inline-toggle" title="Separate ANTIC access is only needed by some memory upgrades; leave off if a game corrupts after loading.">
                          <span>ANTIC</span>
                          <input
                            type="checkbox"
                            checked={atari8Config.separateAnticAccess}
                            onChange={(event) => updateAtari8Config({ separateAnticAccess: event.target.checked })}
                          />
                        </label>
                      ) : null}
                    </div>
                  ) : null}

                  {!isAtariSt ? (
                    <button type="button" onClick={startHostSession} disabled={hostStarted || (isPuaeAmiga && !loadedDiskName)}>
                      {isPuaeAmiga && !loadedDiskName
                        ? 'Load Amiga file to start'
                        : isSoloMode
                          ? hostStarted ? 'Emulator running' : 'Start emulator'
                          : isAmigaLink
                            ? hostStarted ? 'Local Amiga running' : 'Start local Amiga'
                            : hostStarted ? 'Host session running' : 'Start host session'}
                    </button>
                  ) : null}

                  <button onClick={openDiskPicker} disabled={!hostStarted && !isArcade && !isPuaeAmiga && !isAtariSt}>
                    {mediaLabel}
                  </button>

                  {isHost && localRoomGames.length > 0 ? (
                    <button type="button" className="secondary" onClick={() => setLocalGamePickerOpen((value) => !value)}>
                      {localGamePickerOpen ? 'Hide games' : 'Change game'}
                    </button>
                  ) : null}

                  {isArcade ? (
                    <button type="button" className="secondary" onClick={openArcadeRomFolder} disabled={arcadeRomScanning}>
                      {arcadeRomScanning ? 'Scanning ROMs...' : arcadeRomFolderName ? 'Change ROM folder' : 'Choose ROM folder'}
                    </button>
                  ) : null}

                  {(isAmiga || isAmigaLink || isC64 || isAtariSt) ? (
                    <button
                      type="button"
                      className="secondary"
                      onClick={localReleaseFiles.length > 1 ? selectNextLocalReleaseDisk : openSwapDiskPicker}
                      disabled={!hostStarted}
                    >
                      {localReleaseFiles.length > 1
                        ? `Next disk (${currentLocalReleaseIndex + 1}/${localReleaseFiles.length})`
                        : isC64
                        ? `Next C64 media${c64MediaCount > 1 ? ` (${c64MediaIndex + 1}/${c64MediaCount})` : ''}`
                        : isAtariSt
                          ? `Next ST disk${atariStMediaCount > 1 ? ` (${atariStMediaIndex + 1}/${atariStMediaCount})` : ''}`
                          : 'Swap disk'}
                    </button>
                  ) : null}

                  {isPuaeAmiga && loadedAgaDiskCount > 0
                    && localReleaseFiles.length === 0
                    ? Array.from({ length: loadedAgaDiskCount }, (_, index) => (
                      <button
                        key={`aga-disk-${index + 1}`}
                        type="button"
                        className={currentAgaDiskIndex === index ? 'active' : 'secondary'}
                        onClick={() => selectAgaDisk(index)}
                        disabled={!hostStarted}
                      >
                        Disk {index + 1}
                      </button>
                    ))
                    : null}

                  {localReleaseFiles.length > 1
                    ? localReleaseFiles.map((file, index) => (
                      <button
                        key={`local-release-disk-${index + 1}-${file.name}`}
                        type="button"
                        className={currentLocalReleaseIndex === index ? 'active' : 'secondary'}
                        onClick={() => selectLocalReleaseDisk(index)}
                        disabled={!hostStarted}
                        title={file.name}
                      >
                        Disk {index + 1}
                      </button>
                    ))
                    : null}

                  {isMouseComputer ? (
                    <button type="button" className="secondary" onClick={() => sendAmigaMouseClick(1)} disabled={!hostStarted}>
                      Left click
                    </button>
                  ) : null}

                  {isMouseComputer ? (
                    <button type="button" className="secondary" onClick={() => sendAmigaMouseClick(3)} disabled={!hostStarted}>
                      Right click
                    </button>
                  ) : null}

                  {canControlLocalEmulator ? (
                    <label className="host-volume-control">
                      <span>Volume {Math.round(hostVolume * 100)}%</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={Math.round(hostVolume * 100)}
                        onChange={handleHostVolumeChange}
                      />
                    </label>
                  ) : null}

                  {canControlLocalEmulator ? (
                    <button
                      type="button"
                      className={emulatorPaused ? 'active' : 'secondary'}
                      onClick={toggleEmulatorPause}
                      disabled={!hostStarted}
                    >
                      {emulatorPaused ? 'Resume emulator' : 'Pause emulator'}
                    </button>
                  ) : null}

                  <button type="button" className="secondary" onClick={resetHostEmulator} disabled={!hostStarted}>
                    Reset emulator
                  </button>

                  {isC64 ? (
                    <button type="button" className="secondary" onClick={swapC64JoystickPorts} disabled={!hostStarted}>
                      P1 port {c64JoystickPortsSwapped ? 1 : 2} / P2 port {c64JoystickPortsSwapped ? 2 : 1}
                    </button>
                  ) : null}

                  {isC64 ? (
                    <button type="button" className={c64WarpEnabled ? 'active' : 'secondary'} onClick={toggleC64Warp} disabled={!hostStarted}>
                      {c64WarpEnabled ? 'Normal speed' : 'Warp loading'}
                    </button>
                  ) : null}

                  {isAmigaFamily ? (
                    <button type="button" className="secondary" onClick={openKickstartPicker} disabled={hostStarted && !isPuaeAmiga}>
                      {kickstartRomName ? 'Change Kickstart ROM' : 'Load Kickstart ROM'}
                    </button>
                  ) : null}

                  {isPuaeAmiga && hasVipAccess ? (
                    <button type="button" className="secondary" onClick={loadVipKickstart} disabled={vipKickstartBusy}>
                      {vipKickstartBusy
                        ? 'Downloading Kickstart...'
                        : `Use VIP ${isAmigaAga ? 'A1200 3.1' : 'A500 1.3'} ROM`}
                    </button>
                  ) : null}

                  {isDiscConsole ? (
                    <button type="button" className="secondary" onClick={openPlayStationBiosPicker}>
                      {playstationBiosName ? `Change local ${isSaturn ? 'Saturn' : 'PlayStation'} BIOS` : `Load local ${isSaturn ? 'Saturn' : 'PlayStation'} BIOS`}
                    </button>
                  ) : null}

                  {isAtariSt ? (
                    <button type="button" className="secondary" onClick={openAtariTosPicker}>
                      {atariTosName ? 'Change local Atari TOS' : 'Load local Atari TOS'}
                    </button>
                  ) : null}

                  {isX68000 ? (
                    <button type="button" className="secondary" onClick={openX68000FirmwarePicker}>
                      {x68000FirmwareName ? 'Change X68000 firmware' : 'Load X68000 firmware'}
                    </button>
                  ) : null}

                </div>

                {isArcade ? (
                  <p className="arcade-romset-note">MAME Arcade needs a MAME 2003 / 2003-Plus romset. Choose the parent set folder to include samples.</p>
                ) : null}

                {isArcade && arcadeRomEntries.length > 0 ? (
                  <div className="arcade-rom-browser">
                    <div className="arcade-rom-browser-head">
                      <div className="arcade-rom-browser-title">
                        <strong>{arcadeRomFolderName || 'MAME ROMs'}</strong>
                        <span>
                          {showArcadeCloneRoms
                            ? `${arcadeRomEntries.length} ROM archive${arcadeRomEntries.length === 1 ? '' : 's'} found`
                            : `${arcadeParentRomCount} parent game${arcadeParentRomCount === 1 ? '' : 's'} shown${arcadeCloneRomCount ? ` (${arcadeCloneRomCount} clones hidden)` : ''}`}
                          {arcadeSampleCount ? ` - ${arcadeSampleCount} sample zip${arcadeSampleCount === 1 ? '' : 's'} available` : ''}
                        </span>
                      </div>
                      <div className="arcade-rom-browser-actions">
                        <label className="arcade-rom-toggle">
                          <input
                            type="checkbox"
                            checked={showArcadeCloneRoms}
                            onChange={(event) => setShowArcadeCloneRoms(event.target.checked)}
                          />
                          <span>Show clones/children</span>
                        </label>
                        <input
                          type="search"
                          value={arcadeRomSearch}
                          onChange={(event) => setArcadeRomSearch(event.target.value)}
                          placeholder="Search games or zip names"
                        />
                      </div>
                    </div>
                    <div className="arcade-rom-list" aria-label="MAME ROM folder games">
                      {filteredArcadeRomEntries.map((entry) => (
                        <button
                          key={entry.path}
                          type="button"
                          className={`${loadedDiskName === entry.name ? 'active' : 'secondary'}${entry.isClone ? ' clone-rom' : ''}`}
                          onClick={() => loadArcadeRomEntry(entry)}
                        >
                          <span>{entry.displayName}</span>
                          <small>{entry.path}{entry.isClone && entry.parentTitle ? ` - clone of ${entry.parentTitle}` : ''}</small>
                        </button>
                      ))}
                    </div>
                    {filteredArcadeRomEntries.length < arcadeRomEntries.length ? (
                      <p className="muted">Showing {filteredArcadeRomEntries.length} of {arcadeRomEntries.length}. Use search to narrow the list.</p>
                    ) : null}
                  </div>
                ) : null}

                {isSharedCpcParty ? (
                  <div className="party-turn-panel">
                    <div className="party-turn-header">
                      <strong>Party turn</strong>
                      <span>
                        {activePartyPlayerName
                          ? `P${activePartyPlayer}: ${activePartyPlayerName} controls the shared joystick`
                          : `P${activePartyPlayer}: waiting for assigned player`}
                      </span>
                    </div>
                    <div className="party-turn-controls">
                      <button type="button" className="secondary" onClick={nextPartyTurn}>
                        Next player
                      </button>
                      {Array.from({ length: partyMaxPlayers }, (_, index) => index + 1).map((playerNumber) => (
                        <button
                          key={playerNumber}
                          type="button"
                          className={activePartyPlayer === playerNumber ? 'active' : 'secondary'}
                          onClick={() => setPartyTurn(playerNumber)}
                        >
                          <span>P{playerNumber}</span>
                          {partyPlayerNameByNumber.get(playerNumber) ? <small>{partyPlayerNameByNumber.get(playerNumber)}</small> : null}
                        </button>
                      ))}
                    </div>
                    <div className="party-roster" aria-label="Party players">
                      {partyRoster.map((player) => (
                        <div key={player.playerNumber} className={player.connected ? 'connected' : ''}>
                          <strong>P{player.playerNumber}</strong>
                          <span>{player.username}</span>
                          <small>{player.role}{player.connected ? ' connected' : ' joining'}</small>
                        </div>
                      ))}
                    </div>
                    <p className="muted">
                      Guests appear here as they join, so the host can pick the right player turn before the game starts.
                    </p>
                  </div>
                ) : null}

                {isArcadeParty ? (
                  <div className="party-turn-panel arcade-queue-panel">
                    <div className="party-turn-header">
                      <strong>10p queue</strong>
                      <span>P1 always belongs to the host. P2 plays; everyone else watches until their coin reaches the front.</span>
                    </div>
                    <div className="party-roster" aria-label="Arcade cabinet players">
                      {partyRoster
                        .filter((player) => player.active)
                        .map((player) => (
                          <div key={player.playerNumber} className={player.connected ? 'connected' : ''}>
                            <strong>{player.cabinetPlayerNumber ? `P${player.cabinetPlayerNumber}` : 'P1'}</strong>
                            <span>{player.username}</span>
                            <small>{player.role}{player.connected ? ' connected' : ' joining'}</small>
                            {isHost && player.guestId ? (
                              <span className="party-roster-actions">
                                <button type="button" className="secondary" onClick={() => releaseArcadePlayer(player.guestId)}>
                                  Release
                                </button>
                                <button type="button" className="secondary" onClick={() => releaseArcadePlayer(player.guestId, { requeue: true })}>
                                  Requeue
                                </button>
                              </span>
                            ) : null}
                          </div>
                        ))}
                    </div>
                    {partyRoster.some((player) => player.queued) ? (
                      <>
                        <div className="party-turn-header compact">
                          <strong>Queue</strong>
                        </div>
                        <div className="party-roster" aria-label="Arcade queue">
                          {partyRoster
                            .filter((player) => player.queued)
                            .map((player) => (
                              <div key={player.playerNumber} className={player.connected ? 'connected' : ''}>
                                <strong>#{player.queuePosition}</strong>
                                <span>{player.username}</span>
                                <small>Waiting for a cabinet slot</small>
                              </div>
                            ))}
                        </div>
                      </>
                    ) : null}
                    {partyRoster.some((player) => !player.active && !player.queued) ? (
                      <>
                        <div className="party-turn-header compact">
                          <strong>Spectators</strong>
                        </div>
                        <div className="party-roster" aria-label="Arcade spectators">
                          {partyRoster
                            .filter((player) => !player.active && !player.queued)
                            .map((player) => (
                              <div key={player.playerNumber} className={player.connected ? 'connected' : ''}>
                                <strong>Watch</strong>
                                <span>{player.username}</span>
                                <small>{player.connected ? 'Connected' : 'Joining'}</small>
                              </div>
                            ))}
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : isC64Party ? (
                  <div className="party-turn-panel">
                    <div className="party-turn-header">
                      <strong>C64 players</strong>
                      <span>Players are assigned as they join.</span>
                    </div>
                    <div className="party-roster" aria-label="C64 party players">
                      {partyRoster.map((player) => (
                        <div key={player.playerNumber} className={player.connected ? 'connected' : ''}>
                          <strong>P{player.playerNumber}</strong>
                          <span>{player.username}</span>
                          <small>{player.role}{player.connected ? ' connected' : ' joining'}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  muted={false}
                  className="video"
                  onClick={captureInput}
                  onLoadedMetadata={playRemoteVideo}
                  onCanPlay={playRemoteVideo}
                  onPointerDown={handleAmigaPointerDown}
                  onPointerUp={handleAmigaPointerUp}
                  onPointerMove={handleAmigaPointerMove}
                  onContextMenu={(event) => {
                    if (isMouseComputer) event.preventDefault();
                  }}
                />

                <button onClick={connectGuest} disabled={guestPrepared}>
                  {guestPrepared ? 'Guest connection ready' : 'Prepare guest connection'}
                </button>
                {isArcadeParty ? (
                  <div className="party-turn-panel arcade-queue-panel guest-queue-panel">
                    <div className="party-turn-header">
                      <strong>{partyPlayerNumber ? `You are P${partyPlayerNumber}` : arcadeQueueStatus.queued ? `Queue #${arcadeQueueStatus.queuePosition || '?'}` : 'Spectator'}</strong>
                      <span>{partyPlayerNumber ? 'You have cabinet controls.' : arcadeQueueStatus.queued ? 'Waiting for the next free cabinet slot.' : 'Watch the game or join the queue.'}</span>
                    </div>
                    <div className="party-turn-controls">
                      {!partyPlayerNumber ? (
                        <button
                          type="button"
                          className={arcadeQueueStatus.queued ? 'active' : 'secondary'}
                          onClick={() => sendArcadeQueueAction(arcadeQueueStatus.queued ? 'arcade_leave_queue' : 'arcade_join_queue')}
                          disabled={!guestPrepared}
                        >
                          {arcadeQueueStatus.queued ? 'Take back my 10p' : 'Put 10p on the cabinet'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => sendArcadeQueueAction('arcade_release_slot')}
                          disabled={!guestPrepared}
                        >
                          Leave cabinet
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
              </>
            )}

            {!isSoloMode && !showFullscreenArcadeLeaderboard ? (
              <div className="fullscreen-room-chat">
                <RoomChat
                  messages={chatMessages}
                  onSend={sendChatMessage}
                  connected={signalingOpen}
                />
              </div>
            ) : null}

          </div>
          {isHost && localGamePickerOpen ? (
            <aside className="panel local-room-game-picker" aria-label="Local library games">
              <div className="local-room-game-picker-head">
                <div>
                  <span>Local library</span>
                  <strong>{systemLabel}</strong>
                </div>
                <button type="button" className="secondary icon-button" onClick={() => setLocalGamePickerOpen(false)} aria-label="Close local game list">
                  x
                </button>
              </div>
              <input
                type="search"
                value={localGameSearch}
                onChange={(event) => setLocalGameSearch(event.target.value)}
                placeholder="Search games"
              />
              <div className="local-room-game-list">
                {filteredLocalRoomGames.map((game) => (
                  <button
                    key={game.id}
                    type="button"
                    className={`local-room-game-item ${game.id === localGameId ? 'active' : ''}`}
                    onClick={() => chooseLocalRoomGame(game)}
                  >
                    <span className={`local-room-game-thumb ${game.boxArtUrl ? 'has-art' : ''}`}>
                      {game.boxArtUrl ? <img src={game.boxArtUrl} alt="" loading="lazy" /> : <em>{game.system?.toUpperCase?.() || 'ROM'}</em>}
                    </span>
                    <span>
                      <strong>{game.title}</strong>
                      <small>{game.fileName}</small>
                    </span>
                  </button>
                ))}
                {filteredLocalRoomGames.length === 0 ? (
                  <p className="muted">No matching games in this system.</p>
                ) : null}
              </div>
            </aside>
          ) : null}
        </div>

        {controlProfileDrawerOpen && isCpcSystem ? (
          <aside className="control-profile-drawer" aria-label="Amstrad instructions">
            <div className="control-profile-header">
              <div>
                <span>Amstrad instructions</span>
                <h2>{selectedControlProfile ? selectedControlProfile.title : 'Choose profile'}</h2>
              </div>
              <button type="button" className="secondary" onClick={() => setControlProfileDrawerOpen(false)}>
                Close
              </button>
            </div>

            {controlProfileMatches.length > 1 ? (
              <div className="control-match-list">
                {controlProfileMatches.map((match) => (
                  <button
                    key={match.profile.gameSlug}
                    type="button"
                    className={selectedControlProfile?.gameSlug === match.profile.gameSlug ? 'active' : 'secondary'}
                    onClick={() => chooseControlProfile(match.profile)}
                  >
                    <span>{match.profile.title}</span>
                    <small>{match.score}% match</small>
                  </button>
                ))}
              </div>
            ) : null}

            {selectedControlProfile ? (
              <>
                <div className="control-profile-meta">
                  <span>{selectedControlProfile.supportsJoystick ? 'Joystick supported' : 'Keyboard'}</span>
                  <span>{selectedControlProfile.redefinableKeys ? 'Redefinable keys' : 'Fixed keys'}</span>
                  {selectedControlProfile.confidence ? <span>{Math.round(selectedControlProfile.confidence * 100)}% confidence</span> : null}
                </div>

                <div className="control-profile-sections">
                  {selectedControlPlayers.map((player) => (
                    <section key={player.key} className="control-profile-section">
                      <div className="control-player-heading">
                        <h3>{player.label}</h3>
                        <span>{player.hasInput ? 'Game profile' : 'No mapping'}</span>
                      </div>

                      {player.hasInput ? (
                        <div className="control-visual-panel">
                          <div className="control-stick" aria-label={`${player.label} joystick directions`}>
                            {player.directionEntries.map((entry) => (
                              <div
                                key={`${player.key}-${entry.action}`}
                                className={`control-stick-zone ${entry.action === 'fire1' ? 'fire' : ''} ${entry.key || entry.detail ? 'mapped' : 'empty'}`}
                              >
                                <span>{entry.label}</span>
                                <strong>{entry.key || '-'}</strong>
                                {entry.detail ? <small>{entry.detail}</small> : null}
                              </div>
                            ))}
                          </div>

                          {player.utilityEntries.length ? (
                            <div className="control-key-row" aria-label={`${player.label} utility keys`}>
                              {player.utilityEntries.map((entry) => (
                                <div key={`${player.key}-${entry.action}`} className="control-keycap">
                                  <span>{entry.label}</span>
                                  <strong>{entry.key || '-'}</strong>
                                  {entry.detail ? <small>{entry.detail}</small> : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="muted">No fixed key mapping in this profile.</p>
                      )}

                      {player.overlayEntries.length ? (
                        <div className="control-overlay-list">
                          {player.overlayEntries.map(([action, value]) => (
                            <div key={`${player.key}-overlay-${action}`}>
                              <strong>{action}</strong>
                              <span>{value}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  ))}
                </div>

                {selectedControlProfile.notes?.length ? (
                  <section className="control-profile-section">
                    <h3>Notes</h3>
                    <ul className="control-notes-list">
                      {selectedControlProfile.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {selectedControlProfile.source ? (
                  <div className="control-profile-source">
                    <span>{selectedControlProfile.source.manualFile}</span>
                    {selectedControlProfile.source.pages?.length ? (
                      <small>Pages {selectedControlProfile.source.pages.join(', ')}</small>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="muted">Default controls remain active until a profile is selected.</p>
            )}
          </aside>
        ) : null}

        {showDiagnostics ? (
          <>
            <div className="panel input-debug-panel">
              <div className="play-header">
                <h2>Input monitor</h2>
                <div className="assigned-control">
                  {inputDebug.source}
                </div>
              </div>

              <div className="input-debug-grid">
                {joystickMaskToLabels(inputDebug.mask).map(([label, active]) => (
                  <div
                    key={label}
                    className={`input-bit ${active ? 'active' : ''}`}
                  >
                    {label}
                  </div>
                ))}
              </div>

              <div className="input-debug-meta">
                <span>Mask {inputDebug.mask}</span>
                <span>{dataChannelRef.current?.readyState || 'no channel'}</span>
                <span>{inputCaptured ? 'captured' : 'released'}</span>
              </div>

              <div className="log-list input-debug-list">
                {inputDebug.events.length === 0 ? (
                  <div className="log-entry">No inputs seen yet.</div>
                ) : inputDebug.events.map((event, index) => (
                  <div key={`${event}-${index}`} className="log-entry">
                    {event}
                  </div>
                ))}
              </div>
            </div>

            <div className="panel log-panel">
              <h2>Session log</h2>

              {logs.length === 0 ? <p className="muted">No events yet.</p> : null}

              <div className="log-list">
                {logs.map((log, index) => (
                  <div key={`${log}-${index}`} className="log-entry">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
        </div>
        {supportsMameScoreboard && isSoloMode ? null : (
          <div className="room-side-rail">
            <SocialSidebar roomCode={roomCode} allowInvites={!isSoloMode} showOnline={false} />
            {!isSoloMode ? (
              <RoomChat
                messages={chatMessages}
                onSend={sendChatMessage}
                connected={signalingOpen}
              />
            ) : null}
          </div>
        )}
      </div>

      <ControllerSetupWizardAutomatic
        isOpen={controllerSetupOpen}
        gamepadIndex={gamepadIndexRef.current}
        system={roomSystem}
        systemLabel={systemLabel}
        onClose={() => setControllerSetupOpen(false)}
        onInputCaptureStateChange={setControllerCapturingInput}
      />
    </div>
  );
}
