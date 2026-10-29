import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

afterEach(() => vi.unstubAllGlobals());

describe('room clipboard', () => {
  it('uses the clipboard API when permitted', async () => {
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('ROOM01')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('ROOM01');
  });
  it('falls back when an awaited request loses clipboard permission', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) } });
    const input = { setAttribute: vi.fn(), style: {}, select: vi.fn(), remove: vi.fn() };
    const focus = vi.fn();
    vi.stubGlobal('document', {
      activeElement: { focus }, createElement: () => input,
      body: { appendChild: vi.fn() }, execCommand: vi.fn().mockReturnValue(true),
    });
    expect(await copyText('ROOM02')).toBe(true);
    expect(input.value).toBe('ROOM02');
    expect(input.select).toHaveBeenCalled();
    expect(input.remove).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });
  it('returns false instead of throwing when copying is blocked', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', { createElement: () => ({ setAttribute() {}, style: {}, select() {}, remove() {} }), body: { appendChild() {} }, execCommand: () => false });
    expect(await copyText('ROOM03')).toBe(false);
  });
});
