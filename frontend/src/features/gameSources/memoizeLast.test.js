import { expect, it, vi } from 'vitest';
import { memoizeLast } from './memoizeLast';

it('reuses a prepared shelf and invalidates when sources or access change', () => {
  const build = vi.fn((sources, systems) => ({ sources, systems }));
  const prepare = memoizeLast(build);
  const source = [{ id: 'spectrum' }];
  const initial = prepare(source, 'spectrum');
  expect(prepare(source, 'spectrum')).toBe(initial);
  expect(build).toHaveBeenCalledTimes(1);
  expect(prepare(source, 'spectrum,msx')).not.toBe(initial);
  expect(prepare([], 'spectrum')).not.toBe(initial);
  expect(build).toHaveBeenCalledTimes(3);
});
