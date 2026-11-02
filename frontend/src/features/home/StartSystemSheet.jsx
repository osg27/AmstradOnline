import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SUPPORTER_UI_ENABLED } from '../../config/supporterUi';
import useEntitlement from '../../hooks/useEntitlement';
import SupporterLockModal from '../../components/SupporterLockModal';
import HomeSheet from './HomeSheet';
import { PLAY_MODES, visibleCatalogSystems } from './systemCatalog';
import { systemStyle } from './systemCapabilities';
import { createSystemRoom, PARTY_ROOM_SYSTEMS } from './roomLaunch';

/**
 * "Play a game file": the old lobby's system + mode picker. Opens an empty room for
 * any system so players without a library can still load a file and play.
 */
export default function StartSystemSheet({ roles, onClose }) {
  const navigate = useNavigate();
  const canCreatePrivateRooms = useEntitlement('private_rooms');
  const canHostLargeSessions = useEntitlement('larger_multiplayer_sessions');
  const systems = useMemo(() => visibleCatalogSystems(roles), [roles]);
  const [systemId, setSystemId] = useState('');
  const [mode, setMode] = useState('hosted');
  const [partyMaxPlayers, setPartyMaxPlayers] = useState(4);
  const [arcadeMaxPlayers, setArcadeMaxPlayers] = useState(8);
  const [privateRoom, setPrivateRoom] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');
  const [supporterLock, setSupporterLock] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const system = systems.find((item) => item.id === systemId) || null;
  const isArcade = system?.id === 'arcade';
  const modeConfig = system ? (isArcade ? system.modes.solo : system.modes[mode]) : null;
  const canProtect = SUPPORTER_UI_ENABLED && Boolean(system && !isArcade && mode !== 'solo' && modeConfig?.enabled);
  const titleId = 'osg-start-sheet-title';

  useEffect(() => {
    if (!canProtect) {
      setPrivateRoom(false);
      setRoomPassword('');
    }
  }, [canProtect]);

  function chooseSystem(next) {
    setSystemId(next.id);
    setError('');
    if (!next.modes[mode]?.enabled) setMode(next.modes.hosted?.enabled ? 'hosted' : 'solo');
    if (next.modes.party?.system === 'arcade' && ![3, 4].includes(partyMaxPlayers)) setPartyMaxPlayers(4);
  }

  async function start() {
    const protectedRoom = SUPPORTER_UI_ENABLED && privateRoom && mode !== 'solo' && !isArcade;
    if (protectedRoom && !canCreatePrivateRooms) { setSupporterLock('Protected rooms'); return; }
    if (protectedRoom && roomPassword && roomPassword.length < 4) {
      setError('Use at least 4 characters for a room password, or leave it blank for invite-only access.');
      return;
    }
    if (partyMaxPlayers > 4 && mode === 'party' && !canHostLargeSessions) { setSupporterLock('Larger multiplayer sessions'); return; }
    if (isArcade && arcadeMaxPlayers > 8 && !canHostLargeSessions) { setSupporterLock('Larger multiplayer sessions'); return; }
    setError('');
    setBusy(true);
    try {
      const path = await createSystemRoom({ system, mode, partyMaxPlayers, arcadeMaxPlayers, protectedRoom, roomPassword });
      navigate(path);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const launchLabel = busy ? 'Starting…'
    : !system ? 'Choose a system'
      : isArcade ? 'Open MAME cabinet'
        : mode === 'solo' ? 'Play now'
          : mode === 'party' ? 'Start Party Mode'
            : mode === 'link' ? 'Start Link Play' : 'Start online room';

  return (
    <HomeSheet labelledBy={titleId} onClose={onClose} className="osg-start-sheet">
      <div className="osg-start">
        <span className="osg-eyebrow">Play a game file</span>
        <h2 id={titleId}>Pick a system</h2>
        <p className="osg-start-sub">The room opens empty and you load your game file there. Nothing is uploaded.</p>
        <div className="osg-system-grid" role="radiogroup" aria-label="System">
          {systems.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={systemId === item.id}
              className={`osg-system-pick${systemId === item.id ? ' active' : ''}`}
              style={{ '--sys': systemStyle(item.id).color }}
              onClick={() => chooseSystem(item)}
            >
              <span className="osg-system-logo">
                {item.logo ? <img src={item.logo} alt="" /> : <b>{item.shortName}</b>}
              </span>
              <span className="osg-system-name"><i />{item.name}</span>
              <small>{item.formats}</small>
            </button>
          ))}
        </div>

        {system && !isArcade ? (
          <div className="osg-start-modes" role="radiogroup" aria-label="Play mode">
            {Object.entries(PLAY_MODES).filter(([id]) => system.modes[id]?.enabled).map(([id, item]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={mode === id}
                className={`osg-start-mode${mode === id ? ' active' : ''}`}
                onClick={() => setMode(id)}
              >
                <b>{item.label}{system.modes[id]?.testing ? <span className="osg-tag-test">TESTING</span> : null}</b>
                <span>{item.description}</span>
              </button>
            ))}
          </div>
        ) : null}

        {system && !isArcade && mode === 'party' && PARTY_ROOM_SYSTEMS.includes(system.modes.party?.system || system.id) ? (
          <label className="osg-start-field">
            <span>Party players</span>
            <select value={partyMaxPlayers} onChange={(event) => setPartyMaxPlayers(Number(event.target.value))}>
              {(system.modes.party?.system === 'arcade' ? [3, 4] : [2, 3, 4, 5, 6, 7, 8])
                .filter((count) => SUPPORTER_UI_ENABLED || canHostLargeSessions || count <= 4)
                .map((count) => <option key={count} value={count}>{count > 4 && !canHostLargeSessions ? `🔒 ${count} players` : count}</option>)}
            </select>
          </label>
        ) : null}

        {isArcade ? (
          <label className="osg-start-field">
            <span>Cabinet connections</span>
            <select value={arcadeMaxPlayers} onChange={(event) => setArcadeMaxPlayers(Number(event.target.value))}>
              {[8, 12, 16, 20].filter((count) => SUPPORTER_UI_ENABLED || canHostLargeSessions || count <= 8)
                .map((count) => <option key={count} value={count}>{count > 8 && !canHostLargeSessions ? `🔒 ${count}` : count}</option>)}
            </select>
          </label>
        ) : null}

        {canProtect && (SUPPORTER_UI_ENABLED || canCreatePrivateRooms) ? (
          <div className="osg-start-protect">
            <label className="osg-start-check">
              <input
                type="checkbox"
                checked={privateRoom}
                onChange={() => {
                  if (privateRoom) setPrivateRoom(false);
                  else if (!canCreatePrivateRooms) setSupporterLock('Protected rooms');
                  else setPrivateRoom(true);
                }}
              />
              <span><b>Protected room{canCreatePrivateRooms ? '' : ' 🔒'}</b><small>Require an invite or password before someone can join.</small></span>
            </label>
            {privateRoom ? (
              <input type="password" placeholder="Room password (optional, 4+ characters)" minLength={4} maxLength={100} value={roomPassword} onChange={(event) => setRoomPassword(event.target.value)} aria-label="Room password" />
            ) : null}
          </div>
        ) : null}

        {error ? <p className="osg-sheet-error" role="alert">{error}</p> : null}
        <button type="button" className="osg-start-go" onClick={start} disabled={busy || !system || !modeConfig?.enabled}>{launchLabel}</button>
      </div>
      <SupporterLockModal feature={supporterLock} onClose={() => setSupporterLock('')} />
    </HomeSheet>
  );
}
