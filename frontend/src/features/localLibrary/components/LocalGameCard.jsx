import React, { useState } from 'react';
import ReleaseSelector from './ReleaseSelector';

export default function LocalGameCard({
  game, activeRelease, preferredId, onPlay, onPrefer,
}) {
  const [expanded, setExpanded] = useState(false);
  const [releaseId, setReleaseId] = useState(activeRelease?.id || game.defaultReleaseId);
  const release = game.releases.find((item) => item.id === releaseId) || activeRelease;
  return (
    <article className="local-amiga-card">
      <div className="local-game-card-head">
        <span>{game.platform === 'c64' ? 'C64' : game.platform === 'spectrum' ? 'ZX Spectrum' : game.platform === 'amstrad' ? 'Amstrad CPC' : 'Amiga'}</span>
        <em>{game.releases.length} version{game.releases.length === 1 ? '' : 's'}</em>
      </div>
      <h3>{game.title}</h3>
      <p>{release?.media.length || 0} disk{release?.media.length === 1 ? '' : 's'}</p>
      {game.warnings.length ? <small className="local-release-warning">{game.warnings.join(' ')}</small> : null}
      <div className="local-amiga-card-actions">
        <button type="button" onClick={() => onPlay(game)}>Play</button>
        <button type="button" className="secondary" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Hide versions' : 'Versions'}
        </button>
      </div>
      {expanded ? (
        <ReleaseSelector
          game={game}
          releaseId={releaseId}
          preferredId={preferredId}
          onChange={setReleaseId}
          onPrefer={(id) => onPrefer(game, id)}
        />
      ) : null}
    </article>
  );
}
