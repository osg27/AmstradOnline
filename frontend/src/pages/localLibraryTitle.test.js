import { beforeAll, describe, expect, it, vi } from 'vitest';

let canonicalLibraryTitle;

beforeAll(async () => {
  // The page module reads window.location when it loads; the helper itself is pure.
  vi.stubGlobal('window', { location: { port: '', protocol: 'http:', hostname: 'localhost', origin: 'http://localhost' } });
  ({ canonicalLibraryTitle } = await import('./LocalLibraryPage'));
});

describe('canonicalLibraryTitle', () => {
  it('keeps a trailing "World" that belongs to the game name', () => {
    expect(canonicalLibraryTitle({ system: 'snes', title: 'Super Mario World', fileName: 'Super Mario World (USA).sfc' })).toBe('Super Mario World');
  });
  it('still drops region tags in brackets', () => {
    expect(canonicalLibraryTitle({ system: 'nes', title: 'Metroid (USA)', fileName: 'Metroid (USA).nes' })).toBe('Metroid');
  });
});
