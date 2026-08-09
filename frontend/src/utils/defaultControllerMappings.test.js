import { describe, expect, it } from 'vitest';
import {
  getActionMask,
  getDefaultMapping,
  getSystemActions,
  supportsControllerMapping,
} from './defaultControllerMappings';

describe('system controller mapping configuration', () => {
  it('supports arcade and the controller-driven consoles', () => {
    for (const system of ['arcade', 'mastersystem', 'megadrive', 'nes', 'snes', 'pcengine', 'playstation', 'saturn']) {
      expect(supportsControllerMapping(system)).toBe(true);
      expect(getSystemActions(system).slice(0, 4)).toEqual(['up', 'down', 'left', 'right']);
    }
  });

  it('keeps mappings separate by exposing the controls supported by each system', () => {
    expect(getSystemActions('nes')).toEqual(['up', 'down', 'left', 'right', 'button1', 'button2', 'start']);
    expect(getSystemActions('arcade')).toContain('coin');
    expect(getSystemActions('playstation')).toContain('select');
  });

  it('creates a complete default mapping for every configured action', () => {
    for (const system of ['arcade', 'nes', 'megadrive', 'playstation']) {
      const mapping = getDefaultMapping(system);
      expect(Object.keys(mapping)).toEqual(getSystemActions(system));
      expect(Object.values(mapping).every((input) => input?.type === 'button')).toBe(true);
    }
  });

  it('uses the room joystick protocol mask bits', () => {
    expect(getActionMask('button1')).toBe(16);
    expect(getActionMask('start')).toBe(64);
    expect(getActionMask('coin')).toBe(4096);
  });
});
