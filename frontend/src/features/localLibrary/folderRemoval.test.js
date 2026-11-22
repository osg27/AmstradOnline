import { describe, expect, it } from 'vitest';
import { libraryStateWithoutFolder } from './folderRemoval';

const folders = [{ id: 'a' }, { id: 'b' }];
const games = [
  { id: 'a:1', folderId: 'a' },
  { id: 'a:2', folderId: 'a' },
  { id: 'b:1', folderId: 'b' },
];

describe('libraryStateWithoutFolder', () => {
  it('removes only the chosen folder, its games and their favourites', () => {
    const next = libraryStateWithoutFolder({ folders, games, favourites: ['a:2', 'b:1'] }, 'a');
    expect(next.folders).toEqual([{ id: 'b' }]);
    expect(next.games).toEqual([{ id: 'b:1', folderId: 'b' }]);
    expect(next.favourites).toEqual(['b:1']);
  });

  it('leaves state unchanged for an unknown folder', () => {
    const next = libraryStateWithoutFolder({ folders, games, favourites: ['a:1'] }, 'missing');
    expect(next).toEqual({ folders, games, favourites: ['a:1'] });
  });

  it('does not mutate its input', () => {
    const input = { folders, games, favourites: ['a:1'] };
    libraryStateWithoutFolder(input, 'a');
    expect(input.games).toHaveLength(3);
    expect(input.favourites).toEqual(['a:1']);
  });
});
