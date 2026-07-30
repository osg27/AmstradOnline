import React from 'react';

export default function ReleaseSelector({ game, releaseId, onChange, onPrefer, preferredId }) {
  const selected = game.releases.find((release) => release.id === releaseId) || game.releases[0];
  return (
    <div className="local-release-selector">
      <label>
        Version
        <select value={selected?.id || ''} onChange={(event) => onChange(event.target.value)}>
          {game.releases.map((release) => (
            <option key={release.id} value={release.id}>
              {release.label} {release.isComplete ? '' : '(incomplete)'}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="secondary" onClick={() => onPrefer(selected.id)}>
        {preferredId === selected.id ? 'Preferred version' : 'Make preferred'}
      </button>
      <span className={selected.isComplete ? 'local-release-complete' : 'local-release-warning'}>
        {selected.isComplete ? 'Complete release' : 'Incomplete release'}
      </span>
      {selected.warnings.map((warning) => <small key={warning}>{warning}</small>)}
      <ol>
        {selected.media.map((media) => (
          <li key={media.id}>{media.diskNumber ? `Disk ${media.diskNumber}: ` : ''}{media.name}</li>
        ))}
      </ol>
    </div>
  );
}

