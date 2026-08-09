export const CONTROLLER_ACTIONS = {
  up: { label: 'Up', mask: 1 },
  down: { label: 'Down', mask: 2 },
  left: { label: 'Left', mask: 4 },
  right: { label: 'Right', mask: 8 },
  button1: { label: 'Button 1', mask: 16 },
  button2: { label: 'Button 2', mask: 32 },
  start: { label: 'Start', mask: 64 },
  button3: { label: 'Button 3', mask: 128 },
  button4: { label: 'Button 4', mask: 256 },
  button5: { label: 'Button 5', mask: 512 },
  select: { label: 'Select', mask: 512 },
  button6: { label: 'Button 6', mask: 1024 },
  shoulder1: { label: 'Shoulder 1', mask: 1024 },
  button7: { label: 'Button 7', mask: 2048 },
  shoulder2: { label: 'Shoulder 2', mask: 2048 },
  coin: { label: 'Coin', mask: 4096 },
};

const DIRECTIONS = ['up', 'down', 'left', 'right'];
const TWO_BUTTON = [...DIRECTIONS, 'button1', 'button2', 'start'];
const THREE_BUTTON = [...DIRECTIONS, 'button1', 'button2', 'button3', 'start'];
const SIX_BUTTON = [...DIRECTIONS, 'button1', 'button2', 'button3', 'button4', 'select', 'shoulder1', 'shoulder2', 'start'];

const SYSTEM_ACTIONS = {
  arcade: [...DIRECTIONS, 'button1', 'button2', 'button3', 'button4', 'button5', 'button6', 'button7', 'start', 'coin'],
  mastersystem: TWO_BUTTON,
  megadrive: THREE_BUTTON,
  nes: TWO_BUTTON,
  snes: THREE_BUTTON,
  pcengine: TWO_BUTTON,
  playstation: SIX_BUTTON,
  saturn: SIX_BUTTON,
  saturn_beetle: SIX_BUTTON,
  cpc: TWO_BUTTON,
  cpc_party: TWO_BUTTON,
  spectrum: TWO_BUTTON,
  c64: TWO_BUTTON,
  atari8: TWO_BUTTON,
  atarist: TWO_BUTTON,
  amiga: TWO_BUTTON,
  amiga_link: TWO_BUTTON,
  amiga_aga: TWO_BUTTON,
  x68000: TWO_BUTTON,
};

export function getSystemActions(system) {
  return SYSTEM_ACTIONS[system] || [];
}

export function supportsControllerMapping(system) {
  return getSystemActions(system).length > 0;
}

export function getActionLabel(_system, action) {
  return CONTROLLER_ACTIONS[action]?.label || action;
}

export function getActionMask(action) {
  return CONTROLLER_ACTIONS[action]?.mask || 0;
}

export function getDefaultMapping(system) {
  const actions = getSystemActions(system);
  if (!actions.length) return null;
  const defaults = {
    up: { type: 'button', index: 12 },
    down: { type: 'button', index: 13 },
    left: { type: 'button', index: 14 },
    right: { type: 'button', index: 15 },
    button1: { type: 'button', index: 0 },
    button2: { type: 'button', index: 1 },
    button3: { type: 'button', index: 2 },
    button4: { type: 'button', index: 3 },
    button5: { type: 'button', index: 4 },
    button6: { type: 'button', index: 5 },
    button7: { type: 'button', index: 6 },
    select: { type: 'button', index: 8 },
    shoulder1: { type: 'button', index: 4 },
    shoulder2: { type: 'button', index: 5 },
    start: { type: 'button', index: 9 },
    coin: { type: 'button', index: 8 },
  };
  return Object.fromEntries(actions.map((action) => [action, defaults[action]]));
}

export const MAME_ACTIONS = Object.fromEntries(
  SYSTEM_ACTIONS.arcade.map((action) => [action, CONTROLLER_ACTIONS[action].label]),
);

export function getDefaultMameMapping() {
  return getDefaultMapping('arcade');
}
