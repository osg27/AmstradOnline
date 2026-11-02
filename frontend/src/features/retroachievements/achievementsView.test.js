import { describe, expect, it } from 'vitest';
import { deriveAchievementsView, summariseAchievements } from './achievementsView';

describe('deriveAchievementsView', () => {
  it('maps each state', () => {
    expect(deriveAchievementsView({ solo: false, itemCount: 0 })).toBe('online');
    expect(deriveAchievementsView({ solo: true, connected: null, itemCount: 0 })).toBe('loading');
    expect(deriveAchievementsView({ solo: true, connected: false, itemCount: 0 })).toBe('notConnected');
    expect(deriveAchievementsView({ solo: true, connected: true, problem: 'error', itemCount: 0 })).toBe('error');
    expect(deriveAchievementsView({ solo: true, connected: true, problem: 'nogame', itemCount: 0 })).toBe('unsupported');
    expect(deriveAchievementsView({ solo: true, connected: true, signedIn: true, itemCount: 0 })).toBe('loading');
    expect(deriveAchievementsView({ solo: true, connected: true, signedIn: true, itemCount: 5 })).toBe('ready');
  });
});

describe('summariseAchievements', () => {
  it('counts unlocked and points', () => {
    expect(summariseAchievements([{ points: 5, unlocked: true }, { points: 10 }, { points: 25, unlocked: true }]))
      .toEqual({ unlocked: 2, total: 3, points: 30, totalPoints: 40 });
    expect(summariseAchievements(null).total).toBe(0);
  });
});
