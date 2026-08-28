import mame2003PlusTitles from './mame2003PlusTitles';
import mameTitleOverrides from './mameTitleOverrides';

const mergedMameTitles = {
  ...mame2003PlusTitles,
  ...mameTitleOverrides,
};

export function getMameTitleDatabase() {
  return mergedMameTitles;
}

export function getMameTitleMetadata(romKey) {
  return mergedMameTitles[String(romKey || '').toLowerCase()] || null;
}

export function getMameDisplayName(value, fallback = '') {
  const romKey = String(value || '')
    .split(' from ')[0]
    .replace(/\.(zip|7z)$/i, '')
    .trim()
    .toLowerCase();
  const title = mergedMameTitles[romKey]?.title;
  if (title) return title;
  if (fallback && String(fallback).trim().toLowerCase() !== romKey) return String(fallback).trim();
  return romKey
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    || 'Unknown game';
}
