import { describe, expect, it, beforeEach, vi } from 'vitest';
import { getDetectionLabel, getGamepadNameAndId, isAxisActive } from './controllerInputDetection';

describe('controller input detection helpers', () => {
  describe('getDetectionLabel', () => {
    it('returns button label for button detection', () => {
      const result = getDetectionLabel({ type: 'button', index: 5 });
      expect(result).toBe('Button 5');
    });

    it('returns positive axis label', () => {
      const result = getDetectionLabel({ type: 'axis', index: 2, direction: 1 });
      expect(result).toBe('Axis 2 (positive)');
    });

    it('returns negative axis label', () => {
      const result = getDetectionLabel({ type: 'axis', index: 2, direction: -1 });
      expect(result).toBe('Axis 2 (negative)');
    });

    it('returns disconnected message', () => {
      const result = getDetectionLabel({ type: 'disconnected' });
      expect(result).toBe('Controller disconnected');
    });

    it('returns unknown input for unknown type', () => {
      const result = getDetectionLabel({ type: 'unknown' });
      expect(result).toBe('Unknown input');
    });

    it('returns null for null input', () => {
      const result = getDetectionLabel(null);
      expect(result).toBe(null);
    });
  });

  describe('getGamepadNameAndId', () => {
    it('returns no controller when no gamepad at index', () => {
      const originalGetGamepads = navigator.getGamepads;
      navigator.getGamepads = () => [null];

      const result = getGamepadNameAndId(0);
      expect(result).toEqual({ name: 'No controller', id: null });

      navigator.getGamepads = originalGetGamepads;
    });

    it('returns gamepad info when available', () => {
      const mockGamepad = { id: 'Generic Gamepad' };
      const originalGetGamepads = navigator.getGamepads;
      navigator.getGamepads = () => [mockGamepad];

      const result = getGamepadNameAndId(0);
      expect(result).toEqual({ name: 'Generic Gamepad', id: 'Generic Gamepad' });

      navigator.getGamepads = originalGetGamepads;
    });

    it('handles missing getGamepads function', () => {
      const originalGetGamepads = navigator.getGamepads;
      delete navigator.getGamepads;

      const result = getGamepadNameAndId(0);
      expect(result).toEqual({ name: 'No controller', id: null });

      navigator.getGamepads = originalGetGamepads;
    });
  });

  describe('isAxisActive', () => {
    it('returns true for positive value above threshold', () => {
      const result = isAxisActive(0.6, 0.5);
      expect(result).toBe(true);
    });

    it('returns true for negative value below threshold', () => {
      const result = isAxisActive(-0.6, 0.5);
      expect(result).toBe(true);
    });

    it('returns false for value at threshold', () => {
      const result = isAxisActive(0.5, 0.5);
      expect(result).toBe(false);
    });

    it('returns false for value below threshold', () => {
      const result = isAxisActive(0.3, 0.5);
      expect(result).toBe(false);
    });

    it('uses default threshold of 0.5', () => {
      expect(isAxisActive(0.6)).toBe(true);
      expect(isAxisActive(0.4)).toBe(false);
    });

    it('handles zero value', () => {
      const result = isAxisActive(0, 0.5);
      expect(result).toBe(false);
    });

    it('handles NaN gracefully', () => {
      const result = isAxisActive(NaN, 0.5);
      expect(result).toBe(false);
    });
  });
});
