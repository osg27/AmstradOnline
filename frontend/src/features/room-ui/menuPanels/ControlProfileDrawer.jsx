import React from 'react';

/** Amstrad game instructions drawer (moved unchanged from RoomPage). */
export default function ControlProfileDrawer({
  controlProfileMatches,
  selectedControlProfile,
  selectedControlPlayers,
  chooseControlProfile,
  onClose,
  children = null,
}) {
  return (
    <aside className="control-profile-drawer osg-control-profile-drawer" aria-label="Amstrad instructions">
      <div className="control-profile-header">
        <div>
          <span>Amstrad instructions</span>
          <h2>{selectedControlProfile ? selectedControlProfile.title : 'Choose profile'}</h2>
        </div>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>

      {children}

      {controlProfileMatches.length > 1 ? (
        <div className="control-match-list">
          {controlProfileMatches.map((match) => (
            <button
              key={match.profile.gameSlug}
              type="button"
              className={selectedControlProfile?.gameSlug === match.profile.gameSlug ? 'active' : 'secondary'}
              onClick={() => chooseControlProfile(match.profile)}
            >
              <span>{match.profile.title}</span>
              <small>{match.score}% match</small>
            </button>
          ))}
        </div>
      ) : null}

      {selectedControlProfile ? (
        <>
          <div className="control-profile-meta">
            <span>{selectedControlProfile.supportsJoystick ? 'Joystick supported' : 'Keyboard'}</span>
            <span>{selectedControlProfile.redefinableKeys ? 'Redefinable keys' : 'Fixed keys'}</span>
            {selectedControlProfile.confidence ? <span>{Math.round(selectedControlProfile.confidence * 100)}% confidence</span> : null}
          </div>

          <div className="control-profile-sections">
            {selectedControlPlayers.map((player) => (
              <section key={player.key} className="control-profile-section">
                <div className="control-player-heading">
                  <h3>{player.label}</h3>
                  <span>{player.hasInput ? 'Game profile' : 'No mapping'}</span>
                </div>

                {player.hasInput ? (
                  <div className="control-visual-panel">
                    <div className="control-stick" aria-label={`${player.label} joystick directions`}>
                      {player.directionEntries.map((entry) => (
                        <div
                          key={`${player.key}-${entry.action}`}
                          className={`control-stick-zone ${entry.action === 'fire1' ? 'fire' : ''} ${entry.key || entry.detail ? 'mapped' : 'empty'}`}
                        >
                          <span>{entry.label}</span>
                          <strong>{entry.key || '-'}</strong>
                          {entry.detail ? <small>{entry.detail}</small> : null}
                        </div>
                      ))}
                    </div>

                    {player.utilityEntries.length ? (
                      <div className="control-key-row" aria-label={`${player.label} utility keys`}>
                        {player.utilityEntries.map((entry) => (
                          <div key={`${player.key}-${entry.action}`} className="control-keycap">
                            <span>{entry.label}</span>
                            <strong>{entry.key || '-'}</strong>
                            {entry.detail ? <small>{entry.detail}</small> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="muted">No fixed key mapping in this profile.</p>
                )}

                {player.overlayEntries.length ? (
                  <div className="control-overlay-list">
                    {player.overlayEntries.map(([action, value]) => (
                      <div key={`${player.key}-overlay-${action}`}>
                        <strong>{action}</strong>
                        <span>{value}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ))}
          </div>

          {selectedControlProfile.notes?.length ? (
            <section className="control-profile-section">
              <h3>Notes</h3>
              <ul className="control-notes-list">
                {selectedControlProfile.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {selectedControlProfile.source ? (
            <div className="control-profile-source">
              <span>{selectedControlProfile.source.manualFile}</span>
              {selectedControlProfile.source.pages?.length ? (
                <small>Pages {selectedControlProfile.source.pages.join(', ')}</small>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="muted">Default controls remain active until a profile is selected.</p>
      )}
    </aside>
  );
}
