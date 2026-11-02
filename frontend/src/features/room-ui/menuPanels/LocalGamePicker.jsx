import React from 'react';

/** Local library "Change game" picker (moved from RoomPage's side panel into the menu). */
export default function LocalGamePicker({
  systemLabel,
  localGameSearch,
  setLocalGameSearch,
  filteredLocalRoomGames,
  localGameId,
  chooseLocalRoomGame,
  onClose,
}) {
  return (
    <aside className="panel local-room-game-picker osg-local-game-picker" aria-label="Local library games">
      <div className="local-room-game-picker-head">
        <div>
          <span>Local library</span>
          <strong>{systemLabel}</strong>
        </div>
        <button type="button" className="secondary icon-button" onClick={onClose} aria-label="Close local game list">
          x
        </button>
      </div>
      <input
        type="search"
        value={localGameSearch}
        onChange={(event) => setLocalGameSearch(event.target.value)}
        placeholder="Search games"
      />
      <div className="local-room-game-list">
        {filteredLocalRoomGames.map((game) => (
          <button
            key={game.id}
            type="button"
            className={`local-room-game-item ${game.id === localGameId ? 'active' : ''}`}
            onClick={() => chooseLocalRoomGame(game)}
          >
            <span className={`local-room-game-thumb ${game.boxArtUrl ? 'has-art' : ''}`}>
              {game.boxArtUrl ? <img src={game.boxArtUrl} alt="" loading="lazy" /> : <em>{game.system?.toUpperCase?.() || 'ROM'}</em>}
            </span>
            <span>
              <strong>{game.title}</strong>
              <small>{game.fileName}</small>
            </span>
          </button>
        ))}
        {filteredLocalRoomGames.length === 0 ? (
          <p className="muted">No matching games in this system.</p>
        ) : null}
      </div>
    </aside>
  );
}
