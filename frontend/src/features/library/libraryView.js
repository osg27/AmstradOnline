import { systemStyle } from '../home/systemCapabilities';

/**
 * Chips for the Library filter row: All, Favourites, then one per system that has
 * games or a linked folder. `systems` are SUPPORTED_SYSTEMS rows, `counts` is games
 * per system id.
 */
export function buildSystemChips({ systems, counts = {}, totalGames = 0, favouriteCount = 0, activeSystem = 'all' }) {
  const chips = [
    { id: 'all', label: 'All', count: totalGames, color: '' },
    { id: 'favourites', label: 'Favourites', count: favouriteCount, color: '', star: true },
  ];
  systems.forEach((system) => {
    const style = systemStyle(system.id);
    chips.push({ id: system.id, label: style.label, count: counts[system.id] || 0, color: style.color });
  });
  // A system picked through a link stays visible even before it has games.
  if (!chips.some((chip) => chip.id === activeSystem)) {
    const style = systemStyle(activeSystem);
    chips.push({ id: activeSystem, label: style.label, count: counts[activeSystem] || 0, color: style.color });
  }
  return chips;
}

/** "1,234 games", or "48 of 1,234 games" when filters narrow the list. */
export function formatLibraryCount({ shown = 0, total = 0, scopeLabel = 'games' }) {
  const fmt = (value) => Number(value || 0).toLocaleString('en-GB');
  if (!total) return `0 ${scopeLabel}`;
  if (shown === total) return `${fmt(total)} ${scopeLabel}`;
  return `${fmt(shown)} of ${fmt(total)} ${scopeLabel}`;
}

/**
 * Which empty state (if any) the grid should show. Returns null when there are
 * games to list.
 */
export function describeLibraryEmptyState({
  loading = false,
  totalGames = 0,
  matchCount = 0,
  activeSystem = 'all',
  systemLabel = '',
  systemGames = 0,
  filtersActive = false,
}) {
  if (loading) return { kind: 'loading', title: '', body: '' };
  if (!totalGames) {
    return {
      kind: 'empty',
      title: 'Add your games',
      body: 'Link a folder of game files on this computer, or a public source URL, and your games show up here with their box art. Your files are never changed or uploaded.',
    };
  }
  if (matchCount > 0) return null;
  if (activeSystem === 'favourites' && !filtersActive) {
    return { kind: 'favourites', title: 'No favourites yet', body: 'Tap the star on any game and it will be kept here.' };
  }
  if (activeSystem !== 'all' && activeSystem !== 'favourites' && !systemGames && !filtersActive) {
    return {
      kind: 'system-empty',
      title: `No ${systemLabel || 'system'} games yet`,
      body: `Add a ${systemLabel || 'system'} folder, or open an empty room and load a single game there.`,
    };
  }
  return { kind: 'no-results', title: 'No games match', body: 'Try a different search, or clear the filters.' };
}
