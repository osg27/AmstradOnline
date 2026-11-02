// Pure helpers for the in-game room UI. No React, no emulator logic.

// Micros where Esc is a real key the game may need. A tap goes to the
// emulator; only a long press opens the menu.
export const KEYBOARD_SYSTEMS = new Set([
  'cpc',
  'cpc_party',
  'spectrum',
  'c64',
  'msx',
  'atarist',
  'amiga',
  'amiga_link',
  'amiga_aga',
  'x68000',
  'atari8',
]);

export const ESC_HOLD_MS = 450;
export const PAD_COMBO_HOLD_MS = 1000;

export function isKeyboardSystem(system) {
  return KEYBOARD_SYSTEMS.has(system);
}

export const SYSTEM_COLORS = {
  cpc: '#3fdc8a',
  cpc_party: '#3fdc8a',
  spectrum: '#e8b83a',
  c64: '#8a7cff',
  msx: '#5aa9ff',
  atarist: '#c8c8c8',
  atari8: '#d98a3a',
  amiga: '#ff6a3d',
  amiga_link: '#ff6a3d',
  amiga_aga: '#ff6a3d',
  mastersystem: '#ea3a30',
  megadrive: '#3a6fe0',
  nes: '#d9443a',
  snes: '#8a6cff',
  pcengine: '#f0a020',
  x68000: '#9aa4b8',
  playstation: '#5f7fff',
  saturn: '#7a8cff',
  saturn_beetle: '#7a8cff',
  arcade: '#ea3a30',
};

const VOWEL_SOUND_INITIALS = /^[AEFHILMNORSX]/;

/** "an Amstrad CPC", "a Mega Drive", "an NES", "a ZX Spectrum". */
export function withIndefiniteArticle(label) {
  const text = String(label || '').trim();
  if (!text) return '';
  const firstWord = text.split(/[\s/]+/)[0];
  const isInitialism = /^[A-Z0-9]{2,5}$/.test(firstWord) && firstWord !== 'MAME';
  const an = isInitialism ? VOWEL_SOUND_INITIALS.test(firstWord) : /^[aeiou]/i.test(firstWord);
  return `${an ? 'an' : 'a'} ${text}`;
}

/** Strip extension and tidy a ROM / disk file name into something readable. */
export function prettifyFileName(fileName) {
  const base = String(fileName || '').split(/[\\/]/).pop().replace(/\.[a-z0-9]{1,5}$/i, '');
  return base
    .replace(/[_]+/g, ' ')
    .replace(/\s*[[(][^\])]*[\])]\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim() || base;
}

/**
 * Room heading: the game title once a game is loaded, otherwise the system.
 */
export function deriveGameTitle({ libraryTitle, arcadeTitle, loadedDiskName, currentGame, systemLabel }) {
  if (libraryTitle) return libraryTitle;
  if (arcadeTitle) return arcadeTitle;
  if (loadedDiskName) return prettifyFileName(loadedDiskName);
  if (currentGame) return prettifyFileName(currentGame);
  return systemLabel || 'Game';
}

export function detectPadKind(pad) {
  if (!pad) return null;
  const id = String(pad.id || '');
  if (/stick|arcade|fight|hori|qanba|encoder|zero.?delay|xinmo|juyao|mayflash f/i.test(id)) return 'stick';
  if (pad.mapping && pad.mapping !== 'standard') return 'stick';
  return 'pad';
}

export function padDisplayName(pad) {
  if (!pad?.id) return '';
  return String(pad.id)
    .replace(/\(.*?(vendor|product|STANDARD GAMEPAD).*?\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || 'Controller';
}

// On-screen touch controls. Each button maps to the same joystick mask bits the
// gamepad polling produces (see gamepadToJoystickMask in RoomPage), so touch
// input goes through sendLocalJoystickMask exactly like a controller.
const FACE = (label, mask, tone) => ({ label, mask, tone });
const KEY = (label, mask) => ({ label, mask });

const TOUCH_PROFILES = {
  megadrive: { face: [FACE('A', 16, 'p'), FACE('B', 32, 'y'), FACE('C', 128, 'bl')], keys: [KEY('START', 64)] },
  mastersystem: { face: [FACE('1', 16, 'p'), FACE('2', 32, 'y')], keys: [KEY('PAUSE', 64)] },
  nes: { face: [FACE('A', 32, 'p'), FACE('B', 16, 'y')], keys: [KEY('SELECT', 128), KEY('START', 64)] },
  snes: {
    face: [FACE('A', 128, 'p'), FACE('B', 16, 'y'), FACE('X', 256, 'bl'), FACE('Y', 32, 'g')],
    keys: [KEY('L', 1024), KEY('SELECT', 512), KEY('START', 64), KEY('R', 2048)],
  },
  pcengine: { face: [FACE('I', 16, 'p'), FACE('II', 32, 'y')], keys: [KEY('SELECT', 128), KEY('RUN', 64)] },
  playstation: {
    face: [FACE('○', 32, 'p'), FACE('✕', 16, 'bl'), FACE('△', 256, 'g'), FACE('□', 128, 'y')],
    keys: [KEY('SELECT', 512), KEY('START', 64)],
  },
  arcade: { face: [FACE('1', 16, 'p'), FACE('2', 32, 'y'), FACE('3', 128, 'bl')], keys: [KEY('COIN', 4096), KEY('START', 64)] },
  cpc: { face: [FACE('FIRE', 16, 'p'), FACE('2', 32, 'y')], keys: [] },
  cpc_party: { face: [FACE('FIRE', 16, 'p'), FACE('2', 32, 'y')], keys: [] },
  c64: { face: [FACE('FIRE', 16, 'p')], keys: [] },
  spectrum: { face: [FACE('FIRE', 16, 'p')], keys: [] },
};

/** Touch layout for a system, or null when touch play is not safe (show a fallback card). */
export function touchProfileFor(system) {
  return TOUCH_PROFILES[system] || null;
}

/** 8-way d-pad bits from a pointer offset relative to the pad centre. */
export function dpadMaskFromOffset(dx, dy, deadzone = 14) {
  const distance = Math.hypot(dx, dy);
  if (distance < deadzone) return 0;
  const angle = Math.atan2(dy, dx); // screen coords: +y is down
  const sector = Math.round(angle / (Math.PI / 4));
  // sector: 0 right, 1 down-right, 2 down, 3 down-left, ±4 left, -3 up-left, -2 up, -1 up-right
  switch (sector) {
    case 0: return 8;
    case 1: return 8 | 2;
    case 2: return 2;
    case 3: return 4 | 2;
    case 4:
    case -4: return 4;
    case -3: return 4 | 1;
    case -2: return 1;
    case -1: return 8 | 1;
    default: return 0;
  }
}

export const CRT_STORAGE_KEY = 'osg-room-crt-effect';

export const SIDE_PANELS_STORAGE_KEY = 'osg-room-side-panels';
/** Below this window width the side panels are not shown (menu sections remain). */
export const SIDE_PANELS_MIN_WIDTH = 1280;

/**
 * Which side panels to show beside the game.
 * Left = high scores, right = achievements. Panels need a desktop viewport at
 * least SIDE_PANELS_MIN_WIDTH wide, are never shown in OBS capture, and each
 * only appears when it has something to show. `enabled` is the player's toggle.
 */
export function sideLayoutFor({ viewport, width, hasScores, hasAchievements, enabled = true, obsCapture = false }) {
  const roomy = viewport === 'desktop' && Number(width) >= SIDE_PANELS_MIN_WIDTH && !obsCapture;
  const available = roomy && (Boolean(hasScores) || Boolean(hasAchievements));
  const active = available && enabled;
  return {
    available,
    showLeft: active && Boolean(hasScores),
    showRight: active && Boolean(hasAchievements),
  };
}
