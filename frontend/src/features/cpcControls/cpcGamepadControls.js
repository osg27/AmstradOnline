// Automatic gamepad -> Amstrad CPC input for CPCBox.
//
// The manual-derived profiles in data/amstradControlProfiles.json describe
// each game's keys as free text ("Q", "SPACE", "CURSOR_UP", "SHIFT+Q",
// "JOYSTICK PORT 2 FIRE"...). This module turns them into CPC keyboard-matrix
// cells, decides per player whether the native CPC joystick or the documented
// keys should be used, and resolves a pad state into the cells to hold.
//
// The pad state uses the same bit layout as the controller setup wizard
// (utils/defaultControllerMappings.js), so the netplay input_state messages
// and any saved wizard mapping keep working.

import { applyCustomMapping } from '../../utils/applyControllerMapping';

export const PAD = {
  up: 1,
  down: 2,
  left: 4,
  right: 8,
  a: 16, // button1
  b: 32, // button2
  start: 64,
  x: 128, // button3
  y: 256, // button4
  select: 512,
  lb: 1024,
  rb: 2048,
};

// CPC keyboard matrix as [line, bit]. Line 9 carries joystick 1 (CPC "joystick
// 0"); joystick 2 is wired onto line 6, sharing the 6 5 R T G F keys.
export const CPC_MATRIX = {
  CURSOR_UP: [0, 1], CURSOR_RIGHT: [0, 2], CURSOR_DOWN: [0, 4], F9: [0, 8], F6: [0, 16], F3: [0, 32], ENTER: [0, 64], 'F.': [0, 128],
  CURSOR_LEFT: [1, 1], COPY: [1, 2], F7: [1, 4], F8: [1, 8], F5: [1, 16], F1: [1, 32], F2: [1, 64], F0: [1, 128],
  CLR: [2, 1], '[': [2, 2], RETURN: [2, 4], ']': [2, 8], F4: [2, 16], SHIFT: [2, 32], '\\': [2, 64], CONTROL: [2, 128],
  '^': [3, 1], '-': [3, 2], '@': [3, 4], P: [3, 8], ';': [3, 16], ':': [3, 32], '/': [3, 64], '.': [3, 128],
  0: [4, 1], 9: [4, 2], O: [4, 4], I: [4, 8], L: [4, 16], K: [4, 32], M: [4, 64], ',': [4, 128],
  8: [5, 1], 7: [5, 2], U: [5, 4], Y: [5, 8], H: [5, 16], J: [5, 32], N: [5, 64], SPACE: [5, 128],
  6: [6, 1], 5: [6, 2], R: [6, 4], T: [6, 8], G: [6, 16], F: [6, 32], B: [6, 64], V: [6, 128],
  4: [7, 1], 3: [7, 2], E: [7, 4], W: [7, 8], S: [7, 16], D: [7, 32], C: [7, 64], X: [7, 128],
  1: [8, 1], 2: [8, 2], ESC: [8, 4], Q: [8, 8], TAB: [8, 16], A: [8, 32], CAPS_LOCK: [8, 64], Z: [8, 128],
  JOY1_UP: [9, 1], JOY1_DOWN: [9, 2], JOY1_LEFT: [9, 4], JOY1_RIGHT: [9, 8], JOY1_FIRE1: [9, 16], JOY1_FIRE2: [9, 32], DEL: [9, 128],
  JOY2_UP: [6, 1], JOY2_DOWN: [6, 2], JOY2_LEFT: [6, 4], JOY2_RIGHT: [6, 8], JOY2_FIRE1: [6, 16], JOY2_FIRE2: [6, 32],
};

const KEY_ALIASES = {
  SPACE: 'SPACE', SPACEBAR: 'SPACE', 'SPACE BAR': 'SPACE',
  UP: 'CURSOR_UP', DOWN: 'CURSOR_DOWN', LEFT: 'CURSOR_LEFT', RIGHT: 'CURSOR_RIGHT',
  RETURN: 'RETURN', '<RETURN>': 'RETURN', 'SMALL ENTER': 'ENTER',
  COPY: 'COPY', 'COPY KEY': 'COPY',
  CTRL: 'CONTROL', CONTROL: 'CONTROL',
  SHIFT: 'SHIFT', LEFT_SHIFT: 'SHIFT', RIGHT_SHIFT: 'SHIFT',
  ESC: 'ESC', ESCAPE: 'ESC',
  DEL: 'DEL', DELETE: 'DEL', CLR: 'CLR', TAB: 'TAB',
  CAPS_LOCK: 'CAPS_LOCK', 'CAPS LOCK': 'CAPS_LOCK', CAPS: 'CAPS_LOCK', SHIFT_LOCK: 'CAPS_LOCK',
  COMMA: ',', SLASH: '/', QUESTION_MARK: '/', '?': '/', '<': ',', '>': '.',
};

const DIRECTION_WORDS = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

function joystickToken(token) {
  // "FIRE", "JOYSTICK PORT 2 LEFT", "Joystick-Up", "JOY1_FIRE2", "Joystick 1 Fire 1".
  // A CPC has one joystick port, so manuals' joystick (port) numbering refers
  // to the primary CPC joystick.
  if (/^(FIRE ?1?|FEU|BOUTON ACTION)$/.test(token)) return 'JOY1_FIRE1';
  if (!/^JOY/.test(token)) return null;
  const words = token.replace(/[-_]/g, ' ');
  if (/FIRE ?2\b/.test(words)) return 'JOY1_FIRE2';
  if (/FIRE/.test(words)) return 'JOY1_FIRE1';
  const direction = DIRECTION_WORDS.find((word) => new RegExp(`\\b${word}\\b`).test(words));
  return direction ? `JOY1_${direction}` : null;
}

// Single key name -> CPC_MATRIX id, or null if it is not a recognisable CPC key
// (Spectrum/C64/Amiga keys from multi-format manuals, "User definable", ...).
export function normaliseCpcKey(raw) {
  if (typeof raw !== 'string') return null;
  const token = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!token) return null;
  if (KEY_ALIASES[token]) return KEY_ALIASES[token];
  if (/^CURSOR[ _](UP|DOWN|LEFT|RIGHT)$/.test(token)) return token.replace(' ', '_');
  if (/^F[0-9]$/.test(token)) return token;
  const joystick = joystickToken(token);
  if (joystick) return joystick;
  if (token.length === 1 && CPC_MATRIX[token]) return token;
  if (CPC_MATRIX[token] && !token.startsWith('JOY')) return token;
  return null;
}

// "SHIFT+Q", "W+A" -> ['SHIFT', 'Q']. "ENTER" presses both RETURN and the
// small ENTER key because 464 and 6128 manuals use the name for either.
// Returns null when any part is unknown, so a half-understood binding is
// never presented as correct.
export function parseCpcBinding(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parts = value.trim() === '+' ? ['+'] : value.split(/\s*[+&]\s*/);
  const keys = [];
  for (const part of parts) {
    if (part.trim().toUpperCase() === 'ENTER') {
      keys.push('RETURN', 'ENTER');
      continue;
    }
    const key = normaliseCpcKey(part);
    if (!key) return null;
    keys.push(key);
  }
  return keys.length ? [...new Set(keys)] : null;
}

const DIRECTIONS = ['up', 'down', 'left', 'right'];
const DIAGONALS = {
  upLeft: ['up', 'left'],
  upRight: ['up', 'right'],
  downLeft: ['down', 'left'],
  downRight: ['down', 'right'],
};
const EXTRA_SLOTS = ['x', 'y', 'lb', 'rb'];
const NON_EXTRA_ACTIONS = new Set([...DIRECTIONS, ...Object.keys(DIAGONALS), 'fire1', 'fire2', 'start', 'select', 'pause', 'quit']);

export const CPC_CONTROL_MODES = {
  auto: 'Automatic',
  hybrid: 'Manual keys + CPC joystick 1',
  joystick1: 'CPC joystick 1',
  joystick2: 'CPC joystick 2',
  keys: 'Keyboard keys',
  shared: 'Same as Player 1',
  off: 'Off',
};

function joystickBindings(number) {
  const prefix = `JOY${number}_`;
  return {
    up: [`${prefix}UP`],
    down: [`${prefix}DOWN`],
    left: [`${prefix}LEFT`],
    right: [`${prefix}RIGHT`],
    a: [`${prefix}FIRE1`],
    b: [`${prefix}FIRE2`],
  };
}

function readDocumentedPlayer(player) {
  const input = player?.emulatorInput || {};
  const overlay = player?.displayOverlay || {};
  const parsed = {};
  for (const [action, value] of Object.entries(input)) {
    if (action.includes('+')) continue; // "fire1+up" style combos describe moves, not keys
    const keys = parseCpcBinding(value);
    if (keys) parsed[action] = keys;
  }
  const hasDirections = DIRECTIONS.filter((direction) => parsed[direction]).length >= 2;
  const usesJoystick1 = DIRECTIONS.some((direction) => parsed[direction]?.some((key) => key.startsWith('JOY1_')));
  return { parsed, overlay, hasDirections, usesJoystick1 };
}

function keyBindingsFromDocumented(doc) {
  const { parsed } = doc;
  const bindings = {};
  for (const direction of DIRECTIONS) {
    if (parsed[direction]) bindings[direction] = parsed[direction];
  }
  for (const [diagonal, [first, second]] of Object.entries(DIAGONALS)) {
    const keys = parsed[diagonal];
    const plain = [...(parsed[first] || []), ...(parsed[second] || [])];
    // Only keep diagonals that are dedicated keys, not just "up key + left key".
    if (keys && (keys.length !== plain.length || keys.some((key) => !plain.includes(key)))) {
      bindings[diagonal] = keys;
    }
  }
  if (parsed.fire1) bindings.a = parsed.fire1;
  if (parsed.fire2) bindings.b = parsed.fire2;
  return bindings;
}

function documentedLabels(doc) {
  const { overlay } = doc;
  return {
    a: overlay.fire1,
    b: overlay.fire2,
    start: overlay.start,
    select: overlay.select,
  };
}

// Start/Select and the extra face/shoulder buttons come from the profile's
// non-movement keys, so each game gets its own start/pause/extra keys.
function systemBindings(doc, { allowDefaultStart }) {
  const parsed = doc?.parsed || {};
  const bindings = {};
  const labels = {};
  const origins = {};

  if (parsed.start) {
    bindings.start = parsed.start;
    labels.start = doc.overlay.start || 'Start';
  } else if (parsed.pause) {
    bindings.start = parsed.pause;
    labels.start = doc.overlay.pause || 'Pause';
  } else if (allowDefaultStart) {
    bindings.start = ['RETURN'];
    labels.start = 'RETURN';
    origins.start = 'default';
  }

  if (parsed.select) {
    bindings.select = parsed.select;
    labels.select = doc.overlay.select || 'Select';
  } else if (parsed.start && parsed.pause) {
    bindings.select = parsed.pause;
    labels.select = doc.overlay.pause || 'Pause';
  }

  const extras = Object.keys(parsed).filter((action) => !NON_EXTRA_ACTIONS.has(action));
  extras.slice(0, EXTRA_SLOTS.length).forEach((action, index) => {
    const slot = EXTRA_SLOTS[index];
    bindings[slot] = parsed[action];
    labels[slot] = doc.overlay[action] || formatAction(action);
  });

  return { bindings, labels, origins };
}

function formatAction(action) {
  return action
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());
}

// Only explicit statements count; notes like "no player 2 controls or
// joystick support" must not switch Player 2 to joystick 2.
const SECOND_JOYSTICK_NOTE = /(second joystick|two joysticks|joysticks? 1 and (joystick )?2|player (2|two) (uses|can use) (a |the )?(second )?joystick)/i;
const NEGATED_NOTE = /(no|not|without|only)/i;

function playerTwoUsesSecondJoystick(profile) {
  return (profile?.notes || []).some((note) => SECOND_JOYSTICK_NOTE.test(note) && !NEGATED_NOTE.test(note));
}

function finishPlayer(plan) {
  const bindings = { ...plan.bindings };
  // A single fire button is reachable from both A and B.
  if (bindings.a && !bindings.b) bindings.b = bindings.a;
  return { ...plan, bindings };
}

function customKeyBindings(keys = {}) {
  const bindings = {};
  for (const [slot, value] of Object.entries(keys)) {
    const parsed = parseCpcBinding(value);
    if (parsed) bindings[slot] = parsed;
  }
  return bindings;
}

function buildModePlan(mode, { doc, system }) {
  if (mode === 'joystick1' || mode === 'joystick2') {
    const joystick = joystickBindings(mode === 'joystick1' ? 1 : 2);
    // Documented second-fire keys (e.g. SHIFT for a smart bomb) still apply
    // when the directions come from the native joystick.
    const documentedFire2 = doc?.parsed.fire2;
    return {
      bindings: { ...joystick, ...(documentedFire2 ? { b: documentedFire2 } : {}), ...system.bindings },
      labels: { a: doc?.overlay.fire1 || 'Fire', b: documentedFire2 ? doc.overlay.fire2 || 'Fire 2' : 'Fire 2', ...system.labels },
    };
  }
  if (mode === 'hybrid') {
    // The manual's keys AND the native joystick, so the pad works whether the
    // game is in its keyboard or its joystick mode (many CPC games start in
    // keyboard mode and only read the joystick once it is picked on a menu).
    const keys = doc ? keyBindingsFromDocumented(doc) : {};
    const joystick = joystickBindings(1);
    const bindings = {};
    for (const direction of DIRECTIONS) bindings[direction] = [...(keys[direction] || []), ...joystick[direction]];
    for (const [diagonal, [first, second]] of Object.entries(DIAGONALS)) {
      if (keys[diagonal]) bindings[diagonal] = [...keys[diagonal], ...joystick[first], ...joystick[second]];
    }
    bindings.a = [...(keys.a || []), ...joystick.a];
    if (keys.b) bindings.b = keys.b;
    return {
      bindings: { ...bindings, ...system.bindings },
      labels: { ...(doc ? documentedLabels(doc) : {}), ...system.labels },
    };
  }
  if (mode === 'keys') {
    const keys = doc ? keyBindingsFromDocumented(doc) : {};
    return {
      bindings: { ...keys, ...system.bindings },
      labels: { ...(doc ? documentedLabels(doc) : {}), ...system.labels },
    };
  }
  return { bindings: {}, labels: {} };
}

/**
 * Builds the gamepad plan for both players.
 * @param {object|null} profile  manual-derived profile (may be null)
 * @param {object} overrides     { swap, player1: { mode, keys }, player2: { mode, keys } }
 */
export function buildCpcControlPlan(profile, overrides = {}) {
  const doc1 = profile ? readDocumentedPlayer(profile.players?.player1) : null;
  const doc2 = profile?.players?.player2 ? readDocumentedPlayer(profile.players.player2) : null;
  const notes = [];
  // Each player on their own native joystick beats two keyboard layouts,
  // unless the manual itself puts a player on the (single) joystick.
  const twoJoysticks = Boolean(profile?.supportsJoystick && playerTwoUsesSecondJoystick(profile)
    && !doc1?.usesJoystick1 && !doc2?.usesJoystick1);

  // ---- Player 1 automatic choice
  let auto1;
  if (!profile) {
    auto1 = { mode: 'joystick1', origin: 'default', reason: 'No manual found for this game, so the native CPC joystick is used.' };
  } else if (doc1.hasDirections && doc1.usesJoystick1) {
    auto1 = { mode: 'keys', origin: 'manual', reason: 'Manual lists joystick controls for Player 1.' };
  } else if (doc1.hasDirections && doc2?.usesJoystick1) {
    auto1 = { mode: 'keys', origin: 'manual', reason: 'Player 2 uses the joystick, so Player 1 uses the documented keys.' };
  } else if (twoJoysticks) {
    auto1 = doc1.hasDirections
      ? { mode: 'hybrid', origin: 'manual', reason: "Pad presses the manual's keys and CPC joystick 1; Player 2 has joystick 2." }
      : { mode: 'joystick1', origin: 'manual', reason: 'Manual says each player can use their own joystick.' };
  } else if (doc1.hasDirections && doc2?.hasDirections) {
    auto1 = { mode: 'keys', origin: 'manual', reason: 'Manual gives separate keys for both players.' };
  } else if (profile.supportsJoystick && doc1.hasDirections) {
    auto1 = { mode: 'hybrid', origin: 'manual', reason: "Pad presses the manual's keys and the CPC joystick, so it works in either game mode." };
  } else if (profile.supportsJoystick) {
    auto1 = { mode: 'joystick1', origin: 'manual', reason: 'Manual confirms joystick support.' };
  } else if (doc1.hasDirections) {
    auto1 = { mode: 'keys', origin: 'manual', reason: 'Keyboard-only game: using the keys from the manual.' };
  } else {
    auto1 = { mode: 'joystick1', origin: 'default', reason: 'Manual lists no usable movement keys, so the CPC joystick is used.' };
  }

  // ---- Player 2 automatic choice
  let auto2;
  if (!profile) {
    auto2 = { mode: 'joystick2', origin: 'default', reason: 'No manual found: Player 2 uses CPC joystick 2.' };
  } else if (twoJoysticks) {
    auto2 = { mode: 'joystick2', origin: 'manual', reason: 'Manual says Player 2 can use a second joystick.' };
  } else if (doc2?.hasDirections) {
    auto2 = { mode: 'keys', origin: 'manual', reason: doc2.usesJoystick1 ? 'Manual puts Player 2 on the joystick.' : 'Manual lists separate Player 2 keys.' };
  } else {
    auto2 = { mode: 'shared', origin: 'default', reason: 'No Player 2 controls in the manual: pad 2 shares Player 1 controls (turn-based play).' };
  }

  const requested1 = overrides.player1?.mode && overrides.player1.mode !== 'auto' ? overrides.player1.mode : null;
  const requested2 = overrides.player2?.mode && overrides.player2.mode !== 'auto' ? overrides.player2.mode : null;
  const mode1 = requested1 || auto1.mode;
  const mode2 = requested2 || auto2.mode;

  const system1 = systemBindings(doc1, { allowDefaultStart: !profile });
  const custom1 = overrides.player1?.keys ? customKeyBindings(overrides.player1.keys) : null;
  const plan1 = finishPlayer({
    mode: mode1,
    origin: requested1 || custom1 ? 'custom' : auto1.origin,
    reason: requested1 ? 'Changed by you.' : auto1.reason,
    ...applyCustom(buildModePlan(mode1 === 'shared' ? 'joystick1' : mode1, { doc: doc1, system: system1 }), custom1),
  });

  let plan2Base;
  if (mode2 === 'shared') {
    plan2Base = { bindings: plan1.bindings, labels: plan1.labels };
  } else {
    // Player 2 inherits global start/pause keys when the manual gives none.
    const own = doc2 ? systemBindings(doc2, { allowDefaultStart: false }) : { bindings: {}, labels: {} };
    const system2 = {
      bindings: { start: system1.bindings.start, select: system1.bindings.select, ...own.bindings },
      labels: { start: system1.labels.start, select: system1.labels.select, ...own.labels },
    };
    const docForKeys = doc2?.hasDirections ? doc2 : doc1;
    plan2Base = buildModePlan(mode2, { doc: mode2 === 'keys' ? docForKeys : doc2, system: system2 });
  }
  const custom2 = overrides.player2?.keys ? customKeyBindings(overrides.player2.keys) : null;
  const plan2 = finishPlayer({
    mode: mode2,
    origin: requested2 || custom2 ? 'custom' : auto2.origin,
    reason: requested2 ? 'Changed by you.' : auto2.reason,
    ...applyCustom(plan2Base, custom2),
  });

  if (mode1 === 'joystick1' && doc1?.hasDirections) {
    notes.push('If the game asks, choose the joystick option on its menu.');
  }
  const clashes = findClashes(plan1, plan2);
  if (clashes.length) {
    notes.push(`Player 1 and Player 2 share ${clashes.map(formatCpcKey).join(', ')}; change one player if both need to move at once.`);
  }

  return {
    gameSlug: profile?.gameSlug || null,
    title: profile?.title || null,
    swap: Boolean(overrides.swap),
    players: [plan1, plan2],
    notes,
  };
}

function applyCustom(plan, custom) {
  if (!custom || !Object.keys(custom).length) return plan;
  return { bindings: { ...plan.bindings, ...custom }, labels: plan.labels };
}

const MOVEMENT_SLOTS = [...DIRECTIONS, ...Object.keys(DIAGONALS), 'a', 'b'];

function findClashes(plan1, plan2) {
  if (plan2.mode === 'shared' || plan2.mode === 'off' || plan1.mode === 'off') return [];
  const keys1 = new Set(MOVEMENT_SLOTS.flatMap((slot) => plan1.bindings[slot] || []));
  const clashes = new Set();
  for (const slot of MOVEMENT_SLOTS) {
    for (const key of plan2.bindings[slot] || []) {
      if (keys1.has(key) || keys1.has(matrixAlias(key))) clashes.add(key);
    }
  }
  return [...clashes];
}

// Joystick 2 shares matrix cells with keys 6 5 R T G F.
function matrixAlias(key) {
  const cell = CPC_MATRIX[key];
  if (!cell) return null;
  return Object.keys(CPC_MATRIX).find((other) => other !== key && CPC_MATRIX[other][0] === cell[0] && CPC_MATRIX[other][1] === cell[1]) || null;
}

/** Pad state + player plan -> unique CPC key ids to hold. */
export function resolveCpcKeys(mask, playerPlan) {
  if (!playerPlan || playerPlan.mode === 'off' || !mask) return [];
  const { bindings } = playerPlan;
  const held = new Set();
  const pressed = Object.fromEntries(DIRECTIONS.map((direction) => [direction, Boolean(mask & PAD[direction])]));
  // Opposite directions cancel, as on a real stick.
  if (pressed.up && pressed.down) { pressed.up = false; pressed.down = false; }
  if (pressed.left && pressed.right) { pressed.left = false; pressed.right = false; }

  let diagonalUsed = false;
  for (const [diagonal, [first, second]] of Object.entries(DIAGONALS)) {
    if (pressed[first] && pressed[second] && bindings[diagonal]) {
      bindings[diagonal].forEach((key) => held.add(key));
      diagonalUsed = true;
    }
  }
  if (!diagonalUsed) {
    for (const direction of DIRECTIONS) {
      if (pressed[direction]) (bindings[direction] || []).forEach((key) => held.add(key));
    }
  }
  for (const slot of ['a', 'b', 'x', 'y', 'lb', 'rb', 'start', 'select']) {
    if (mask & PAD[slot]) (bindings[slot] || []).forEach((key) => held.add(key));
  }
  return [...held];
}

export function cpcKeysToCells(keys) {
  return keys.map((key) => CPC_MATRIX[key]).filter(Boolean);
}

export function cpcMatrixMessage(source, mask, playerPlan) {
  return {
    type: 'amstrad_matrix_state',
    source,
    cells: cpcKeysToCells(resolveCpcKeys(mask, playerPlan)),
  };
}

// ---- Reading a browser gamepad

const STICK_DEADZONE = 0.5;

function nonStandardDirections(pad, deadzone) {
  const directions = { left: false, right: false, up: false, down: false };
  // Fight sticks / USB encoders often expose the lever on extra axis pairs.
  for (const [xIndex, yIndex] of [[2, 3], [4, 5], [6, 7]]) {
    if (xIndex >= pad.axes.length || yIndex >= pad.axes.length) continue;
    const x = Number(pad.axes[xIndex]) || 0;
    const y = Number(pad.axes[yIndex]) || 0;
    directions.left ||= x < -deadzone;
    directions.right ||= x > deadzone;
    directions.up ||= y < -deadzone;
    directions.down ||= y > deadzone;
  }
  // DirectInput POV hat reported as one eight-way axis.
  if (pad.axes.length > 9) {
    const value = Number(pad.axes[9]);
    if (Number.isFinite(value) && value >= -1.05 && value <= 1.05) {
      const position = Math.max(0, Math.min(7, Math.round((value + 1) * 3.5)));
      directions.up ||= position === 0 || position === 1 || position === 7;
      directions.right ||= position >= 1 && position <= 3;
      directions.down ||= position >= 3 && position <= 5;
      directions.left ||= position >= 5 && position <= 7;
    }
  }
  return directions;
}

/**
 * Browser Gamepad -> PAD mask. Uses the W3C "standard" layout (Xbox,
 * PlayStation and most USB pads in Chrome/Edge/Firefox), falls back to common
 * non-standard axis layouts, and honours a mapping saved by the controller
 * setup wizard for the buttons it covers.
 */
export function readCpcPadMask(pad, customMapping = null) {
  if (!pad?.connected) return 0;
  const pressed = (index) => Boolean(pad.buttons[index]?.pressed);
  const x = Number(pad.axes[0]) || 0;
  const y = Number(pad.axes[1]) || 0;
  const fallback = pad.mapping === 'standard'
    ? { left: false, right: false, up: false, down: false }
    : nonStandardDirections(pad, STICK_DEADZONE);

  let mask = 0;
  if (pressed(12) || y < -STICK_DEADZONE || fallback.up) mask |= PAD.up;
  if (pressed(13) || y > STICK_DEADZONE || fallback.down) mask |= PAD.down;
  if (pressed(14) || x < -STICK_DEADZONE || fallback.left) mask |= PAD.left;
  if (pressed(15) || x > STICK_DEADZONE || fallback.right) mask |= PAD.right;

  if (customMapping) {
    return mask | (applyCustomMapping(pad, customMapping) ?? 0);
  }

  if (pressed(0)) mask |= PAD.a;
  if (pressed(1)) mask |= PAD.b;
  if (pressed(2)) mask |= PAD.x;
  if (pressed(3)) mask |= PAD.y;
  if (pressed(4)) mask |= PAD.lb;
  if (pressed(5)) mask |= PAD.rb;
  if (pressed(8)) mask |= PAD.select;
  if (pressed(9)) mask |= PAD.start;
  if (pad.mapping !== 'standard' && pressed(7)) mask |= PAD.start;
  return mask;
}

/** Connected pads in a stable order; pad 1 = Player 1 unless swapped. */
export function assignPadsToPlayers(pads, swap = false) {
  const connected = Array.from(pads || []).filter((pad) => pad?.connected).sort((left, right) => left.index - right.index);
  const slots = [connected[0] || null, connected[1] || null];
  return swap ? [slots[1], slots[0]] : slots;
}

// ---- Display

const KEY_LABELS = {
  SPACE: 'Space', RETURN: 'Return', ENTER: 'Enter', COPY: 'Copy', CONTROL: 'Ctrl', SHIFT: 'Shift', ESC: 'Esc',
  DEL: 'Del', CLR: 'Clr', TAB: 'Tab', CAPS_LOCK: 'Caps Lock',
  CURSOR_UP: '↑', CURSOR_DOWN: '↓', CURSOR_LEFT: '←', CURSOR_RIGHT: '→',
};

export function formatCpcKey(key) {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  const joystick = /^JOY([12])_(UP|DOWN|LEFT|RIGHT|FIRE1|FIRE2)$/.exec(key);
  if (joystick) {
    const part = { UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right', FIRE1: 'fire', FIRE2: 'fire 2' }[joystick[2]];
    return `Joy ${joystick[1]} ${part}`;
  }
  return key;
}

export function formatCpcBinding(keys) {
  if (!keys?.length) return '';
  if (keys.length === 2 && keys.includes('RETURN') && keys.includes('ENTER')) return 'Enter';
  return keys.map(formatCpcKey).join('+');
}

// Editable text for the override form ("SHIFT+Q").
export function bindingToText(keys) {
  if (!keys?.length) return '';
  if (keys.length === 2 && keys.includes('RETURN') && keys.includes('ENTER')) return 'ENTER';
  return keys.join('+');
}

export function summarisePlayer(plan) {
  if (!plan) return '';
  if (plan.mode === 'off') return 'Off';
  if (plan.mode === 'shared') return 'Same as P1';
  const { bindings } = plan;
  const directions = DIRECTIONS.map((direction) => bindings[direction]);
  const joystick = directions.every((keys) => keys?.length === 1 && /^JOY[12]_/.test(keys[0]));
  if (joystick) {
    return `Joystick ${bindings.up[0][3]}`;
  }
  const withoutJoystick = (keys) => (keys || []).filter((key) => !/^JOY[12]_/.test(key));
  const keys = directions.map((keys) => formatCpcBinding(withoutJoystick(keys)) || '–').join(' ');
  const fire = formatCpcBinding(withoutJoystick(bindings.a));
  const summary = fire ? `${keys} · ${fire}` : keys;
  return plan.mode === 'hybrid' ? `${summary} + Joy 1` : summary;
}

export const PAD_BUTTON_LABELS = [
  ['a', 'A / ✕'],
  ['b', 'B / ○'],
  ['x', 'X / □'],
  ['y', 'Y / △'],
  ['lb', 'LB / L1'],
  ['rb', 'RB / R1'],
  ['start', 'Start'],
  ['select', 'Select'],
];

export const EDITABLE_SLOTS = ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select'];

// ---- Persisted overrides (per game, this browser)

const OVERRIDE_PREFIX = 'osg.cpcGamepad.v1:';

export function cpcOverrideKey(profile, fileName) {
  if (profile?.gameSlug) return `${OVERRIDE_PREFIX}${profile.gameSlug}`;
  if (fileName) return `${OVERRIDE_PREFIX}file:${String(fileName).toLowerCase()}`;
  return null;
}

export function loadCpcOverrides(key, storage = globalThis.localStorage) {
  if (!key) return {};
  try {
    const value = JSON.parse(storage?.getItem(key) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function saveCpcOverrides(key, overrides, storage = globalThis.localStorage) {
  if (!key) return;
  try {
    const empty = !overrides || (!overrides.swap && !overrides.player1 && !overrides.player2);
    if (empty) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(overrides));
  } catch {
    // Storage blocked (private mode): overrides last for this session only.
  }
}
