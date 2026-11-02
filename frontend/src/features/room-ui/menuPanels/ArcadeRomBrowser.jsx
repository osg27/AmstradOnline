import React from 'react';

/** MAME ROM folder browser (moved unchanged from RoomPage). */
export default function ArcadeRomBrowser({
  arcadeRomFolderName,
  arcadeRomEntries,
  filteredArcadeRomEntries,
  arcadeParentRomCount,
  arcadeCloneRomCount,
  arcadeSampleCount,
  showArcadeCloneRoms,
  setShowArcadeCloneRoms,
  arcadeRomSearch,
  setArcadeRomSearch,
  loadedDiskName,
  loadArcadeRomEntry,
}) {
  if (!arcadeRomEntries.length) return null;
  return (
    <div className="arcade-rom-browser">
      <div className="arcade-rom-browser-head">
        <div className="arcade-rom-browser-title">
          <strong>{arcadeRomFolderName || 'MAME ROMs'}</strong>
          <span>
            {showArcadeCloneRoms
              ? `${arcadeRomEntries.length} ROM archive${arcadeRomEntries.length === 1 ? '' : 's'} found`
              : `${arcadeParentRomCount} parent game${arcadeParentRomCount === 1 ? '' : 's'} shown${arcadeCloneRomCount ? ` (${arcadeCloneRomCount} clones hidden)` : ''}`}
            {arcadeSampleCount ? ` - ${arcadeSampleCount} sample zip${arcadeSampleCount === 1 ? '' : 's'} available` : ''}
          </span>
        </div>
        <div className="arcade-rom-browser-actions">
          <label className="arcade-rom-toggle">
            <input
              type="checkbox"
              checked={showArcadeCloneRoms}
              onChange={(event) => setShowArcadeCloneRoms(event.target.checked)}
            />
            <span>Show clones/children</span>
          </label>
          <input
            type="search"
            value={arcadeRomSearch}
            onChange={(event) => setArcadeRomSearch(event.target.value)}
            placeholder="Search games or zip names"
          />
        </div>
      </div>
      <div className="arcade-rom-list" aria-label="MAME ROM folder games">
        {filteredArcadeRomEntries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            className={`${loadedDiskName === entry.name ? 'active' : 'secondary'}${entry.isClone ? ' clone-rom' : ''}`}
            onClick={() => loadArcadeRomEntry(entry)}
          >
            <span>{entry.displayName}</span>
            <small>{entry.path}{entry.isClone && entry.parentTitle ? ` - clone of ${entry.parentTitle}` : ''}</small>
          </button>
        ))}
      </div>
      {filteredArcadeRomEntries.length < arcadeRomEntries.length ? (
        <p className="muted">Showing {filteredArcadeRomEntries.length} of {arcadeRomEntries.length}. Use search to narrow the list.</p>
      ) : null}
    </div>
  );
}
