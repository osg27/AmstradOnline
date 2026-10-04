import { expect, it } from 'vitest';
import { shelfArtworkUrl } from './shelfArtwork';

it('uses the same versioned thumbnail for preloading and shelf rendering', () => {
  const url = '/library/media/files/boxart/spectrum-front/cover.jpg?v=123';
  expect(shelfArtworkUrl(url)).toBe(`${url}&size=shelf`);
  expect(shelfArtworkUrl(shelfArtworkUrl(url))).toBe(`${url}&size=shelf`);
  expect(shelfArtworkUrl('https://example.com/cover.jpg')).toBe('https://example.com/cover.jpg');
});
