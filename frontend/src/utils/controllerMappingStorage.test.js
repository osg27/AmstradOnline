import { describe, expect, it } from 'vitest';
import {
  getControllerMapping,
  setControllerMapping,
  deleteControllerMapping,
  validateMapping,
} from './controllerMappingStorage';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    length: 0,
  };
}

const testMapping = {
  up: { type: 'button', index: 12 },
  down: { type: 'button', index: 13 },
  left: { type: 'button', index: 14 },
  right: { type: 'button', index: 15 },
  button1: { type: 'button', index: 0 },
  start: { type: 'button', index: 9 },
};

describe('controller mapping storage', () => {
  it('saves and retrieves a mapping', () => {
    const storage = memoryStorage();
    setControllerMapping('mame', 'test-pad-123', testMapping, storage);
    const retrieved = getControllerMapping('mame', 'test-pad-123', storage);
    expect(retrieved).toEqual(testMapping);
  });

  it('returns null for non-existent mapping', () => {
    const storage = memoryStorage();
    const retrieved = getControllerMapping('mame', 'nonexistent', storage);
    expect(retrieved).toBe(null);
  });

  it('returns null for null controller ID', () => {
    const storage = memoryStorage();
    const retrieved = getControllerMapping('mame', null, storage);
    expect(retrieved).toBe(null);
  });

  it('deletes a mapping', () => {
    const storage = memoryStorage();
    setControllerMapping('mame', 'test-pad-123', testMapping, storage);
    deleteControllerMapping('mame', 'test-pad-123', storage);
    const retrieved = getControllerMapping('mame', 'test-pad-123', storage);
    expect(retrieved).toBe(null);
  });

  it('throws error when setting mapping without controller ID', () => {
    const storage = memoryStorage();
    expect(() => {
      setControllerMapping('mame', null, testMapping, storage);
    }).toThrow('Controller ID is required');
  });

  it('handles corrupt JSON gracefully', () => {
    const storage = memoryStorage();
    storage.setItem('controller-mappings:v1:mame:corrupt', 'not valid json {]');
    const retrieved = getControllerMapping('mame', 'corrupt', storage);
    expect(retrieved).toBe(null);
  });

  it('isolates mappings between different controller IDs', () => {
    const storage = memoryStorage();
    const mapping1 = { up: { type: 'button', index: 12 } };
    const mapping2 = { up: { type: 'button', index: 13 } };

    setControllerMapping('mame', 'pad-1', mapping1, storage);
    setControllerMapping('mame', 'pad-2', mapping2, storage);

    expect(getControllerMapping('mame', 'pad-1', storage)).toEqual(mapping1);
    expect(getControllerMapping('mame', 'pad-2', storage)).toEqual(mapping2);
  });

  it('isolates mappings between different systems', () => {
    const storage = memoryStorage();
    const mameMapping = { up: { type: 'button', index: 12 } };
    const nesMapping = { up: { type: 'button', index: 15 } };

    setControllerMapping('mame', 'test-pad', mameMapping, storage);
    setControllerMapping('nes', 'test-pad', nesMapping, storage);

    expect(getControllerMapping('mame', 'test-pad', storage)).toEqual(mameMapping);
    expect(getControllerMapping('nes', 'test-pad', storage)).toEqual(nesMapping);
  });

  it('validates correct mapping structure', () => {
    expect(validateMapping(testMapping)).toBe(true);
  });

  it('rejects mapping without type', () => {
    const invalid = { up: { index: 12 } };
    expect(validateMapping(invalid)).toBe(false);
  });

  it('rejects mapping with invalid type', () => {
    const invalid = { up: { type: 'invalid', index: 12 } };
    expect(validateMapping(invalid)).toBe(false);
  });

  it('rejects mapping with negative button index', () => {
    const invalid = { up: { type: 'button', index: -1 } };
    expect(validateMapping(invalid)).toBe(false);
  });

  it('rejects mapping with invalid axis direction', () => {
    const invalid = { up: { type: 'axis', index: 0, direction: 2 } };
    expect(validateMapping(invalid)).toBe(false);
  });

  it('rejects non-object mapping', () => {
    expect(validateMapping(null)).toBe(false);
    expect(validateMapping(undefined)).toBe(false);
    expect(validateMapping('string')).toBe(false);
  });
});
