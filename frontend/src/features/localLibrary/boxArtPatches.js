// Applies box-art results to the current library list. Only games still in the list
// are changed, so a job that started before a folder was unlinked cannot bring the
// removed games back.
export function applyGameMediaPatches(games, patches) {
  if (!patches.size) return games;
  return games.map((game) => (patches.has(game.id) ? { ...game, ...patches.get(game.id) } : game));
}
