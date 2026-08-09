import { describe, expect, it } from 'vitest';
import { applyCustomMapping, getMaskBitValue } from './applyControllerMapping';

function createMockGamepad(buttons = {}, axes = {}) {
  const buttonArray = Array(20).fill(null).map((_, i) => ({
    pressed: buttons[i] || false,
  }));
  const axesArray = Array(10).fill(null).map((_, i) => axes[i] ?? 0);

  return {
    buttons: buttonArray,
    axes: axesArray,
  };
}

describe('apply controller mapping', () => {
  it('returns null for null mapping', () => {
    const pad = createMockGamepad();
    const result = applyCustomMapping(pad, null, 'mame');
    expect(result).toBe(null);
  });

  it('applies the same mask format for console mappings', () => {
    const pad = createMockGamepad();
    const mapping = { up: { type: 'button', index: 12 } };
    pad.buttons[12].pressed = true;
    const result = applyCustomMapping(pad, mapping, 'nes');
    expect(result).toBe(getMaskBitValue('up'));
  });

  it('detects button press and sets correct mask bit', () => {
    const pad = createMockGamepad({ 12: true }); // Button 12 pressed
    const mapping = {
      up: { type: 'button', index: 12 },
      down: { type: 'button', index: 13 },
    };
    const result = applyCustomMapping(pad, mapping, 'mame');
    expect(result & getMaskBitValue('up')).toBe(getMaskBitValue('up'));
    expect(result & getMaskBitValue('down')).toBe(0);
  });

  it('handles multiple simultaneous button presses', () => {
    const pad = createMockGamepad({
      12: true, // Button 12
      13: true, // Button 13
      0: true,  // Button 0
    });
    const mapping = {
      up: { type: 'button', index: 12 },
      down: { type: 'button', index: 13 },
      button1: { type: 'button', index: 0 },
    };
    const result = applyCustomMapping(pad, mapping, 'mame');
    expect(result & getMaskBitValue('up')).toBe(getMaskBitValue('up'));
    expect(result & getMaskBitValue('down')).toBe(getMaskBitValue('down'));
    expect(result & getMaskBitValue('button1')).toBe(getMaskBitValue('button1'));
  });

  it('detects positive axis direction', () => {
    const pad = createMockGamepad({}, { 0: 0.8 }); // Axis 0 at positive
    const mapping = {
      right: { type: 'axis', index: 0, direction: 1 },
      left: { type: 'axis', index: 0, direction: -1 },
    };
    const result = applyCustomMapping(pad, mapping, 'mame');
    expect(result & getMaskBitValue('right')).toBe(getMaskBitValue('right'));
    expect(result & getMaskBitValue('left')).toBe(0);
  });

  it('detects negative axis direction', () => {
    const pad = createMockGamepad({}, { 0: -0.8 }); // Axis 0 at negative
    const mapping = {
      right: { type: 'axis', index: 0, direction: 1 },
      left: { type: 'axis', index: 0, direction: -1 },
    };
    const result = applyCustomMapping(pad, mapping, 'mame');
    expect(result & getMaskBitValue('right')).toBe(0);
    expect(result & getMaskBitValue('left')).toBe(getMaskBitValue('left'));
  });

  it('respects deadzone for axes', () => {
    const pad = createMockGamepad({}, { 0: 0.4 }); // Below 0.45 deadzone
    const mapping = {
      right: { type: 'axis', index: 0, direction: 1 },
    };
    const result = applyCustomMapping(pad, mapping, 'mame');
    expect(result & getMaskBitValue('right')).toBe(0);
  });

  it('activates axis at exactly deadzone threshold', () => {
    const pad = createMockGamepad({}, { 0: 0.45 }); // At deadzone
    const mapping = {
      right: { type: 'axis', index: 0, direction: 1 },
    };
    const result = applyCustomMapping(pad, mapping, 'mame');
    // Deadzone is strictly > 0.45, so 0.45 should not activate
    expect(result & getMaskBitValue('right')).toBe(0);
  });

  it('activates axis above deadzone threshold', () => {
    const pad = createMockGamepad({}, { 0: 0.51 }); // Above deadzone
    const mapping = {
      right: { type: 'axis', index: 0, direction: 1 },
    };
    const result = applyCustomMapping(pad, mapping, 'mame');
    expect(result & getMaskBitValue('right')).toBe(getMaskBitValue('right'));
  });

  it('handles missing input in mapping', () => {
    const pad = createMockGamepad({ 12: true });
    const mapping = {
      up: { type: 'button', index: 12 },
      down: { type: 'button', index: 13 },
      left: undefined,
    };
    const result = applyCustomMapping(pad, mapping, 'mame');
    expect(result & getMaskBitValue('up')).toBe(getMaskBitValue('up'));
    expect(result & getMaskBitValue('down')).toBe(0);
    expect(result & getMaskBitValue('left')).toBe(0);
  });

  it('handles NaN axis values', () => {
    const pad = createMockGamepad({}, { 0: NaN });
    const mapping = {
      right: { type: 'axis', index: 0, direction: 1 },
    };
    const result = applyCustomMapping(pad, mapping, 'mame');
    expect(result & getMaskBitValue('right')).toBe(0);
  });

  it('handles out-of-range button indices gracefully', () => {
    const pad = createMockGamepad();
    const mapping = {
      up: { type: 'button', index: 999 }, // Beyond available buttons
    };
    const result = applyCustomMapping(pad, mapping, 'mame');
    expect(result & getMaskBitValue('up')).toBe(0);
  });

  it('produces correct complete mask for typical MAME mapping', () => {
    const pad = createMockGamepad(
      {
        12: true, // Up
        13: true, // Down
        0: true,  // Button 1
        9: true,  // Start
      },
      { 0: 0 }
    );
    const mapping = {
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
      start: { type: 'button', index: 9 },
      coin: { type: 'button', index: 8 },
    };

    const result = applyCustomMapping(pad, mapping, 'mame');

    // Should have up (1), down (2), button1 (16), start (64)
    const expected = 1 | 2 | 16 | 64;
    expect(result).toBe(expected);
  });

  it('getMaskBitValue returns correct values', () => {
    expect(getMaskBitValue('up')).toBe(1);
    expect(getMaskBitValue('down')).toBe(2);
    expect(getMaskBitValue('left')).toBe(4);
    expect(getMaskBitValue('right')).toBe(8);
    expect(getMaskBitValue('button1')).toBe(16);
    expect(getMaskBitValue('button2')).toBe(32);
    expect(getMaskBitValue('button3')).toBe(128);
    expect(getMaskBitValue('button4')).toBe(256);
    expect(getMaskBitValue('button5')).toBe(512);
    expect(getMaskBitValue('button6')).toBe(1024);
    expect(getMaskBitValue('start')).toBe(64);
    expect(getMaskBitValue('coin')).toBe(4096);
  });

  it('getMaskBitValue returns 0 for unknown action', () => {
    expect(getMaskBitValue('unknown')).toBe(0);
  });
});
