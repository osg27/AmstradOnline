// Library state after a PC folder is unlinked. Only that folder's folders entry,
// game rows and favourites are removed; ROM files on disk are never touched.
export function libraryStateWithoutFolder({ folders = [], games = [], favourites = [] }, folderId) {
  const removedGameIds = new Set(
    games.filter((game) => game.folderId === folderId).map((game) => game.id),
  );
  return {
    folders: folders.filter((folder) => folder.id !== folderId),
    games: games.filter((game) => game.folderId !== folderId),
    favourites: favourites.filter((id) => !removedGameIds.has(id)),
  };
}
