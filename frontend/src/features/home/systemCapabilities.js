import { findCatalogSystem } from './systemCatalog';

// Only these systems submit RetroAchievements today, and only in solo (softcore).
const RETROACHIEVEMENT_SYSTEMS = new Set(['megadrive', 'mastersystem', 'snes', 'nes', 'cpc']);

// Arcade saves high scores for every supported game in solo; Amiga only for some.
const HIGH_SCORE_SUPPORT = { arcade: 'all', amiga: 'some' };

// Display colour and short label per system (colours from the approved design).
const SYSTEM_STYLE = {
  arcade: { color: '#ea3a30', label: 'Arcade' },
  cpc: { color: '#3fdc8a', label: 'Amstrad CPC' },
  spectrum: { color: '#ff6b6b', label: 'ZX Spectrum' },
  c64: { color: '#8fa9ff', label: 'C64' },
  msx: { color: '#5ab0ff', label: 'MSX' },
  atarist: { color: '#e05555', label: 'Atari ST' },
  amiga: { color: '#ff8a3d', label: 'Amiga' },
  x68000: { color: '#d65a8a', label: 'X68000' },
  mastersystem: { color: '#2fb4e0', label: 'Master System' },
  nes: { color: '#d64545', label: 'NES' },
  megadrive: { color: '#3a6fe0', label: 'Mega Drive' },
  snes: { color: '#9b7bff', label: 'SNES' },
  pcengine: { color: '#ff5d8f', label: 'PC Engine' },
  playstation: { color: '#7d8cff', label: 'PlayStation' },
};

const INPUT_HINTS = {
  arcade: 'Pad or arcade stick · Coin and Start',
  cpc: 'Keyboard + joystick',
  spectrum: 'Keyboard + joystick',
  c64: 'Keyboard + joystick',
  msx: 'Keyboard + joystick',
  atarist: 'Keyboard, mouse + joystick',
  amiga: 'Keyboard, mouse + joystick',
  x68000: 'Keyboard + pad',
  mastersystem: '2-button pad',
  nes: '2-button pad',
  megadrive: '3-button pad',
  snes: 'SNES pad',
  pcengine: '2-button pad',
  playstation: 'PlayStation pad',
};

/**
 * Room systems that are a play mode of a user-facing system rather than a system
 * of their own (Party Mode on CPC, Link Play and AGA on Amiga).
 */
export function systemFamily(systemId) {
  const id = String(systemId || '').toLowerCase();
  if (id === 'cpc_party') return 'cpc';
  if (id === 'amiga_aga' || id === 'amiga_link') return 'amiga';
  return id;
}

export function systemStyle(systemId) {
  const family = systemFamily(systemId);
  const catalog = findCatalogSystem(family);
  return SYSTEM_STYLE[family] || { color: '#6e7592', label: catalog?.shortName || family.toUpperCase() };
}

/**
 * What a system really supports, derived from the catalogue `modes` table so the
 * game sheet never offers a mode the room cannot run. No system has save states.
 */
export function getSystemCapabilities(systemId) {
  const family = systemFamily(systemId);
  const system = findCatalogSystem(family);
  if (!system) return null;
  const { modes } = system;
  const isArcade = family === 'arcade';
  return {
    id: family,
    name: system.name,
    shortName: system.shortName,
    label: systemStyle(family).label,
    color: systemStyle(family).color,
    input: INPUT_HINTS[family] || '',
    testing: Boolean(system.testing),
    solo: Boolean(modes.solo?.enabled),
    // Arcade is one cabinet room: friends join it from inside the room.
    cabinet: isArcade,
    online: !isArcade && Boolean(modes.hosted?.enabled),
    party: !isArcade && modes.party?.enabled ? { roomSystem: modes.party.system || family } : null,
    link: modes.link?.enabled ? { roomSystem: modes.link.system || family, testing: Boolean(modes.link.testing) } : null,
    retroAchievements: RETROACHIEVEMENT_SYSTEMS.has(family) && Boolean(modes.solo?.enabled),
    highScores: HIGH_SCORE_SUPPORT[family] || null,
  };
}
