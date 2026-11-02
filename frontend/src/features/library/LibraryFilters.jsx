import React from 'react';

/** Search box plus the small filter row: genre, show clones (arcade), box art only. */
export default function LibraryFilters({
  query, onQuery, genreFilter, onGenre, genres,
  showClonesAvailable, showClones, onShowClones, boxArtOnly, onBoxArtOnly,
}) {
  return (
    <div className="osg-lib-filters">
      <label className="osg-lib-search">
        <i className="bi bi-search" aria-hidden="true" />
        <span className="osg-visually-hidden">Search your games</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search your games"
          autoComplete="off"
        />
      </label>
      <div className="osg-lib-filter-row">
        <select value={genreFilter} onChange={(event) => onGenre(event.target.value)} aria-label="Filter by genre">
          <option value="all">All genres</option>
          {genres.map(([genre, count]) => (
            <option key={genre} value={genre}>{genre} ({count})</option>
          ))}
        </select>
        {showClonesAvailable ? (
          <label className="osg-lib-toggle">
            <input type="checkbox" checked={showClones} onChange={(event) => onShowClones(event.target.checked)} />
            <span>Show clones</span>
          </label>
        ) : null}
        <label className="osg-lib-toggle">
          <input type="checkbox" checked={boxArtOnly} onChange={(event) => onBoxArtOnly(event.target.checked)} />
          <span>Box art only</span>
        </label>
      </div>
    </div>
  );
}
