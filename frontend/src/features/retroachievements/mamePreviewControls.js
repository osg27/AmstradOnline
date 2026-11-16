// Browser standard mapping: D-pad / left stick, Start/A, Back/B.
export function readPreviewGamepad(gamepads, sixButtons = false) {
  for (const pad of Array.from(gamepads || [])) {
    if (!pad?.connected || pad.mapping !== 'standard') continue;
    const pressed = index => Boolean(pad.buttons[index]?.pressed);
    const x = pad.axes[0] || 0, y = pad.axes[1] || 0;
    let mask = 0;
    if (pressed(12) || y < -0.35) mask |= 1 << 4;
    if (pressed(13) || y > 0.35) mask |= 1 << 5;
    if (pressed(14) || x < -0.35) mask |= 1 << 6;
    if (pressed(15) || x > 0.35) mask |= 1 << 7;
    if (pressed(8) || (!sixButtons && pressed(1))) mask |= 1 << 2;
    if (pressed(9) || (!sixButtons && pressed(0))) mask |= 1 << 3;
    if (sixButtons) {
      // MAME's classic six-button layout: Y/X/L = punches, B/A/R = kicks.
      for (const [button, bit] of [[2, 1], [3, 9], [4, 10], [0, 0], [1, 8], [5, 11]]) {
        if (pressed(button)) mask |= 1 << bit;
      }
    }
    return { mask, name: pad.id };
  }
  return { mask: 0, name: '' };
}
