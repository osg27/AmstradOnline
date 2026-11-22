import { describe, expect, it } from 'vitest';
import { assertAccountSourcesReady, sourceManagerState } from './sourceManagerState';

describe('source manager gating', () => {
  it('keeps PC folder actions available while account URL sources are still loading', () => {
    const state = sourceManagerState({ sourcesReady: false, busy: false });
    expect(state.folderActionsEnabled).toBe(true);
    expect(state.urlActionsEnabled).toBe(false);
    expect(state.notice).toMatch(/PC folders can still be added and unlinked/);
  });

  it('enables URL source actions only once the account list has loaded', () => {
    const state = sourceManagerState({ sourcesReady: true, busy: false });
    expect(state.urlActionsEnabled).toBe(true);
    expect(state.folderActionsEnabled).toBe(true);
    expect(state.notice).toBe('');
  });

  it('blocks every action while another operation is running', () => {
    const state = sourceManagerState({ sourcesReady: true, busy: true });
    expect(state.folderActionsEnabled).toBe(false);
    expect(state.urlActionsEnabled).toBe(false);
  });

  it('refuses to save an account source list that has not loaded', () => {
    expect(() => assertAccountSourcesReady(false)).toThrow(/still loading/);
    expect(() => assertAccountSourcesReady(true)).not.toThrow();
  });
});
