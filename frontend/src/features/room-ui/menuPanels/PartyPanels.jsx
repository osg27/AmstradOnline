import React from 'react';

// Party / queue panels moved unchanged from RoomPage.

export function CpcPartyTurnPanel({
  activePartyPlayer,
  activePartyPlayerName,
  partyMaxPlayers,
  partyPlayerNameByNumber,
  partyRoster,
  nextPartyTurn,
  setPartyTurn,
}) {
  return (
    <div className="party-turn-panel">
      <div className="party-turn-header">
        <strong>Party turn</strong>
        <span>
          {activePartyPlayerName
            ? `P${activePartyPlayer}: ${activePartyPlayerName} controls the shared joystick`
            : `P${activePartyPlayer}: waiting for assigned player`}
        </span>
      </div>
      <div className="party-turn-controls">
        <button type="button" className="secondary" onClick={nextPartyTurn}>
          Next player
        </button>
        {Array.from({ length: partyMaxPlayers }, (_, index) => index + 1).map((playerNumber) => (
          <button
            key={playerNumber}
            type="button"
            className={activePartyPlayer === playerNumber ? 'active' : 'secondary'}
            onClick={() => setPartyTurn(playerNumber)}
          >
            <span>P{playerNumber}</span>
            {partyPlayerNameByNumber.get(playerNumber) ? <small>{partyPlayerNameByNumber.get(playerNumber)}</small> : null}
          </button>
        ))}
      </div>
      <div className="party-roster" aria-label="Party players">
        {partyRoster.map((player) => (
          <div key={player.playerNumber} className={player.connected ? 'connected' : ''}>
            <strong>P{player.playerNumber}</strong>
            <span>{player.username}</span>
            <small>{player.role}{player.connected ? ' connected' : ' joining'}</small>
          </div>
        ))}
      </div>
      <p className="muted">
        Guests appear here as they join, so the host can pick the right player turn before the game starts.
      </p>
    </div>
  );
}

export function ArcadeHostQueuePanel({ partyRoster, isHost, releaseArcadePlayer }) {
  return (
    <div className="party-turn-panel arcade-queue-panel">
      <div className="party-turn-header">
        <strong>10p queue</strong>
        <span>P1 always belongs to the host. P2 plays; everyone else watches until their coin reaches the front.</span>
      </div>
      <div className="party-roster" aria-label="Arcade cabinet players">
        {partyRoster
          .filter((player) => player.active)
          .map((player) => (
            <div key={player.playerNumber} className={player.connected ? 'connected' : ''}>
              <strong>{player.cabinetPlayerNumber ? `P${player.cabinetPlayerNumber}` : 'P1'}</strong>
              <span>{player.username}</span>
              <small>{player.role}{player.connected ? ' connected' : ' joining'}</small>
              {isHost && player.guestId ? (
                <span className="party-roster-actions">
                  <button type="button" className="secondary" onClick={() => releaseArcadePlayer(player.guestId)}>
                    Release
                  </button>
                  <button type="button" className="secondary" onClick={() => releaseArcadePlayer(player.guestId, { requeue: true })}>
                    Requeue
                  </button>
                </span>
              ) : null}
            </div>
          ))}
      </div>
      {partyRoster.some((player) => player.queued) ? (
        <>
          <div className="party-turn-header compact">
            <strong>Queue</strong>
          </div>
          <div className="party-roster" aria-label="Arcade queue">
            {partyRoster
              .filter((player) => player.queued)
              .map((player) => (
                <div key={player.playerNumber} className={player.connected ? 'connected' : ''}>
                  <strong>#{player.queuePosition}</strong>
                  <span>{player.username}</span>
                  <small>Waiting for a cabinet slot</small>
                </div>
              ))}
          </div>
        </>
      ) : null}
      {partyRoster.some((player) => !player.active && !player.queued) ? (
        <>
          <div className="party-turn-header compact">
            <strong>Spectators</strong>
          </div>
          <div className="party-roster" aria-label="Arcade spectators">
            {partyRoster
              .filter((player) => !player.active && !player.queued)
              .map((player) => (
                <div key={player.playerNumber} className={player.connected ? 'connected' : ''}>
                  <strong>Watch</strong>
                  <span>{player.username}</span>
                  <small>{player.connected ? 'Connected' : 'Joining'}</small>
                </div>
              ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function C64PartyPanel({ partyRoster }) {
  return (
    <div className="party-turn-panel">
      <div className="party-turn-header">
        <strong>C64 players</strong>
        <span>Players are assigned as they join.</span>
      </div>
      <div className="party-roster" aria-label="C64 party players">
        {partyRoster.map((player) => (
          <div key={player.playerNumber} className={player.connected ? 'connected' : ''}>
            <strong>P{player.playerNumber}</strong>
            <span>{player.username}</span>
            <small>{player.role}{player.connected ? ' connected' : ' joining'}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GuestArcadeQueuePanel({ partyPlayerNumber, arcadeQueueStatus, guestPrepared, sendArcadeQueueAction, compact = false }) {
  return (
    <div className={`party-turn-panel arcade-queue-panel guest-queue-panel ${compact ? 'osg-guest-queue-compact' : ''}`}>
      <div className="party-turn-header">
        <strong>{partyPlayerNumber ? `You are P${partyPlayerNumber}` : arcadeQueueStatus.queued ? `Queue #${arcadeQueueStatus.queuePosition || '?'}` : 'Spectator'}</strong>
        <span>{partyPlayerNumber ? 'You have cabinet controls.' : arcadeQueueStatus.queued ? 'Waiting for the next free cabinet slot.' : 'Watch the game or join the queue.'}</span>
      </div>
      <div className="party-turn-controls">
        {!partyPlayerNumber ? (
          <button
            type="button"
            className={arcadeQueueStatus.queued ? 'active' : 'secondary'}
            onClick={() => sendArcadeQueueAction(arcadeQueueStatus.queued ? 'arcade_leave_queue' : 'arcade_join_queue')}
            disabled={!guestPrepared}
          >
            {arcadeQueueStatus.queued ? 'Take back my 10p' : 'Put 10p on the cabinet'}
          </button>
        ) : (
          <button
            type="button"
            className="secondary"
            onClick={() => sendArcadeQueueAction('arcade_release_slot')}
            disabled={!guestPrepared}
          >
            Leave cabinet
          </button>
        )}
      </div>
    </div>
  );
}
