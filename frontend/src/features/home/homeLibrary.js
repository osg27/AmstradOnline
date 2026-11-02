import { useEffect, useState } from 'react';
import { getLocalLibraryGames, getLocalLibrarySetting } from '../../localLibraryDb';
import { loadCachedSourceCatalogues, loadSourceArtwork } from '../gameSources/sourceLibrary';
import { shelfArtworkUrl } from '../gameSources/shelfArtwork';
import {
  SUPPORTED_SYSTEMS,
  canonicalLibraryTitle,
  enrichSourceEntries,
  getGroupedLibraryGames,
  isArcadeParentRom,
  prepareSourceEntries,
  libraryGroupKey,
  readPreferredVariants,
  restoreCachedBoxArt,
} from '../../pages/LocalLibraryPage';
import { systemFamily } from './systemCapabilities';
import { titleFromPlayedFile } from './homeFormat';

const LIBRARY_SNAPSHOT_KEY = 'oldstylegaming:librarySnapshot';
export const PICK_LIMIT = 7;

function availableSystemIds() {
  const isSuperAdmin = localStorage.getItem('isSuperAdmin') === 'true';
  const isAdmin = localStorage.getItem('isAdmin') === 'true';
  return new Set(SUPPORTED_SYSTEMS
    .filter((system) => (!system.superAdminOnly || isSuperAdmin) && (!system.adminOnly || isAdmin || isSuperAdmin))
    .map((system) => system.id));
}

/** Game count the Library page last saved (grouped titles). Null when unknown. */
export function readLibraryGameCount() {
  try {
    const snapshot = JSON.parse(localStorage.getItem(LIBRARY_SNAPSHOT_KEY)) || {};
    const total = Number(snapshot.totalGames);
    return Number.isFinite(total) && total > 0 ? total : null;
  } catch {
    return null;
  }
}

/** The user's local library (IndexedDB) plus their favourites. */
let libraryCache = null;

export function useHomeLibrary() {
  // Reuse the last result so coming back from a game paints at once, then refresh quietly.
  const [state, setState] = useState(() => libraryCache || { loading: true, games: [], favourites: [] });

  useEffect(() => {
    let cancelled = false;
    const username = localStorage.getItem('username') || '';
    Promise.all([
      getLocalLibraryGames().catch(() => []),
      getLocalLibrarySetting('favourites', []).catch(() => []),
      // URL-linked "source" games and their artwork live beside the folder games.
      // Only the copies already saved in this browser are read, so there is no network wait.
      loadCachedSourceCatalogues(username).catch(() => []),
      loadSourceArtwork(username).catch(() => ({})),
    ]).then(([games, favourites, sources, artwork]) => {
      if (cancelled) return;
      const allowed = availableSystemIds();
      const sourceGames = enrichSourceEntries(prepareSourceEntries(Array.isArray(sources) ? sources : [], [...allowed].join(',')), artwork || {});
      libraryCache = {
        loading: false,
        games: [...games, ...sourceGames].filter((game) => allowed.has(game.system) || (game.system === 'amiga_aga' && allowed.has('amiga'))),
        favourites: Array.isArray(favourites) ? favourites : [],
      };
      setState(libraryCache);
    });
    return () => { cancelled = true; };
  }, []);

  return state;
}

export function boxArtFor(game) {
  return game?.boxArtUrl ? shelfArtworkUrl(game.boxArtUrl) : '';
}

/**
 * In-game screenshot from the same libretro thumbnail set the box art came from
 * (Named_Snaps sits beside Named_Boxarts). Empty when the art is not from libretro.
 */
export function screenshotFor(game) {
  const source = [game?.boxArtSource, game?.boxArtUrl].find((value) => String(value || '').includes('/Named_Boxarts/'));
  return source ? source.replace('/Named_Boxarts/', '/Named_Snaps/') : '';
}

function uniqueGroups(rawGames, limit) {
  if (!rawGames.length) return [];
  return getGroupedLibraryGames(rawGames).slice(0, limit);
}

function byNewest(left, right) {
  return String(right.indexedAt || '').localeCompare(String(left.indexedAt || ''));
}

/** The three small rows offered on the Play page. Empty tabs are dropped by the caller. */
export function buildLibraryPicks(games, favourites) {
  const favouriteSet = new Set(favourites);
  const favouriteGames = games.filter((game) => favouriteSet.has(game.id));
  const newest = [...games].sort(byNewest).slice(0, 80);
  const arcadeParents = games
    .filter((game) => game.system === 'arcade' && isArcadeParentRom(game))
    .sort((left, right) => Number(Boolean(right.boxArtUrl)) - Number(Boolean(left.boxArtUrl)) || byNewest(left, right))
    .slice(0, 80);
  return {
    favourites: uniqueGroups(favouriteGames, PICK_LIMIT),
    added: uniqueGroups(newest, PICK_LIMIT),
    arcade: uniqueGroups(arcadeParents, PICK_LIMIT),
  };
}

/**
 * Rebuilds the full library group for a game (all versions, the user's preferred
 * version) the same way the Library shelf does before launching it.
 */
export function buildLaunchGame(games, game) {
  if (!game) return null;
  const family = systemFamily(game.system);
  const key = libraryGroupKey(game);
  const siblings = games.filter((candidate) => systemFamily(candidate.system) === family && libraryGroupKey(candidate) === key);
  const [group] = getGroupedLibraryGames(siblings.length ? siblings : [game]);
  if (!group) return game;
  const preferredId = readPreferredVariants()[group.id];
  return group.variants.find((variant) => variant.id === preferredId) || group;
}

function playedKey(value) {
  return String(value || '').split(/[\\/]/).pop().split(' from ')[0].trim().toLowerCase();
}

function romKey(value) {
  return playedKey(value).replace(/\.(zip|7z)$/i, '');
}

/** Finds the library game a recent-history row refers to (rooms report the loaded file name). */
export function matchPlayedGame(games, entry) {
  const family = systemFamily(entry.system);
  const fileKey = playedKey(entry.game);
  const candidates = games.filter((game) => systemFamily(game.system) === family);
  if (family === 'arcade') {
    const key = romKey(entry.game);
    return candidates.find((game) => (game.romKey || romKey(game.fileName)) === key) || null;
  }
  return candidates.find((game) => playedKey(game.fileName) === fileKey)
    || candidates.find((game) => playedKey(game.title) === fileKey)
    || null;
}

/**
 * Merges recent-history rows that are the same game in different room modes
 * (e.g. CPC and CPC Party) and attaches library data where we have it.
 */
export function buildRecentGames(entries, games) {
  const merged = new Map();
  for (const entry of entries) {
    const family = systemFamily(entry.system);
    const key = `${family}\0${playedKey(entry.game)}`;
    const existing = merged.get(key);
    if (existing) {
      existing.totalSeconds += Number(entry.total_seconds) || 0;
      continue;
    }
    const libraryGame = matchPlayedGame(games, entry);
    merged.set(key, {
      key,
      system: family,
      fileName: entry.game,
      title: libraryGame ? canonicalLibraryTitle(libraryGame) : titleFromPlayedFile(entry.game, family),
      lastPlayedAt: entry.last_played_at,
      totalSeconds: Number(entry.total_seconds) || 0,
      libraryGame,
      boxArt: boxArtFor(libraryGame),
      screenshot: screenshotFor(libraryGame),
    });
  }
  return [...merged.values()];
}

const restoredArtCache = new Map();

/**
 * Box art is normally linked to games when the Library page opens. Games the Library
 * has not enriched yet get their cached art looked up here, for only the games shown.
 * Returns a Map of game id -> game with art fields.
 */
export async function restoreMissingArt(games) {
  const missing = games.filter((game) => game && !game.boxArtUrl && game.id && game.system && !restoredArtCache.has(game.id));
  if (missing.length) {
    const restored = await restoreCachedBoxArt(missing).catch(() => missing);
    restored.forEach((game) => restoredArtCache.set(game.id, game.boxArtUrl ? game : null));
    missing.forEach((game) => { if (!restoredArtCache.has(game.id)) restoredArtCache.set(game.id, null); });
  }
  return restoredArtCache;
}
