import { getActionMask } from './defaultControllerMappings';

const DEADZONE = 0.45;

export function applyCustomMapping(pad, mapping) {
  if (!mapping) return null;
  let mask = 0;
  for (const [action, input] of Object.entries(mapping)) {
    const maskBit = getActionMask(action);
    if (!input || !maskBit) continue;
    let active = false;
    if (input.type === 'button') {
      active = Boolean(pad.buttons[input.index]?.pressed);
    } else if (input.type === 'axis') {
      const value = Number(pad.axes[input.index]) || 0;
      active = input.direction > 0 ? value > DEADZONE : value < -DEADZONE;
    }
    if (active) mask |= maskBit;
  }
  return mask;
}

export function getMaskBitValue(action) {
  return getActionMask(action);
}
