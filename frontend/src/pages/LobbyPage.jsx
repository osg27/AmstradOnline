import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';

export default function LobbyPage() {
  const navigate = useNavigate();
  const username = localStorage.getItem('username');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loadingCreate, setLoadingCreate] = useState(false);
  const [loadingJoin, setLoadingJoin] = useState(false);
  const [isAdmin, setIsAdmin] = useState(localStorage.getItem('isAdmin') === 'true');
  const [isTester, setIsTester] = useState(localStorage.getItem('isTester') === 'true');
  const [selectedEra, setSelectedEra] = useState('8bit');
  const [selectedSystem, setSelectedSystem] = useState('cpc');
  const [partyMaxPlayers, setPartyMaxPlayers] = useState(4);
  const canUsePreviewSystems = isAdmin || isTester;

  const systemGroups = [
    {
      id: '8bit',
      label: '8-bit',
      systems: [
        { id: 'cpc', label: 'Amstrad CPC' },
        { id: 'spectrum', label: 'ZX Spectrum' },
      ],
    },
    {
      id: 'party',
      label: 'Party Games',
      adminOnly: true,
      systems: [
        { id: 'cpc_party', label: 'Amstrad CPC Party', note: 'Preview' },
      ],
    },
    {
      id: '16bit',
      label: '16-bit',
      adminOnly: true,
      systems: [
        { id: 'amiga', label: 'Amiga', note: 'Preview' },
        { id: 'megadrive', label: 'Mega Drive', note: 'Preview' },
        { id: 'snes', label: 'SNES', note: 'Preview' },
      ],
    },
  ];

  const visibleGroups = systemGroups.filter((group) => !group.adminOnly || canUsePreviewSystems);
  const selectedGroup = visibleGroups.find((group) => group.id === selectedEra) || visibleGroups[0];
  const selectedMachine = selectedGroup?.systems.find((system) => system.id === selectedSystem);

  useEffect(() => {
    async function loadSession() {
      try {
        const session = await apiFetch('/auth/me');
        const nextIsAdmin = Boolean(session.is_admin);
        const nextIsTester = Boolean(session.is_tester);

        setIsAdmin(nextIsAdmin);
        setIsTester(nextIsTester);
        localStorage.setItem('isAdmin', nextIsAdmin ? 'true' : 'false');
        localStorage.setItem('isTester', nextIsTester ? 'true' : 'false');
        if (!nextIsAdmin && !nextIsTester) {
          setSelectedEra('8bit');
          setSelectedSystem('cpc');
        }
      } catch {
        setIsAdmin(false);
        setIsTester(false);
        localStorage.removeItem('isAdmin');
        localStorage.removeItem('isTester');
        setSelectedEra('8bit');
        setSelectedSystem('cpc');
      }
    }

    loadSession();
  }, []);

  async function handleCreate() {
    setError('');
    setLoadingCreate(true);
    try {
      if (!selectedMachine || selectedMachine.disabled) {
        throw new Error('That system is not ready yet.');
      }

      const room = await apiFetch('/rooms/create', {
        method: 'POST',
        body: JSON.stringify({
          system: selectedSystem,
          party_max_players: selectedSystem === 'cpc_party' ? partyMaxPlayers : 2,
        }),
      });
      navigate(`/room/${room.room_code}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingCreate(false);
    }
  }

  async function handleJoin() {
    setError('');
    setLoadingJoin(true);
    try {
      const room = await apiFetch('/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ room_code: joinCode.trim().toUpperCase() }),
      });
      navigate(`/room/${room.room_code}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingJoin(false);
    }
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('isAdmin');
    localStorage.removeItem('isTester');
    navigate('/login');
  }

  return (
    <div className="page lobby-page">
      <div className="card lobby-card">
        <div className="lobby-header">
          <BrandMark />
          <div className="account-strip">
            <span>{username}</span>
            {canUsePreviewSystems ? (
              <button className="secondary" onClick={() => navigate('/feedback')}>Feedback</button>
            ) : null}
            {isAdmin ? (
              <button className="secondary" onClick={() => navigate('/admin')}>Admin</button>
            ) : null}
            <button className="secondary" onClick={logout}>Logout</button>
          </div>
        </div>

        <div className="lobby-intro">
          <h1>Retro Games Are Better With Mates</h1>
          <p>Pick a system, create a room, and stream the session straight from the browser.</p>
        </div>

        <div className="lobby-actions">
          <div className="panel action-panel">
            <span className="panel-kicker">Host</span>
            <h2>Create room</h2>
            <p>Start a fresh multiplayer session.</p>
            <div className="era-tabs" aria-label="System category">
              {visibleGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className={selectedGroup.id === group.id ? 'active' : 'secondary'}
                  onClick={() => {
                    setSelectedEra(group.id);
                    setSelectedSystem(group.systems[0]?.id || 'cpc');
                  }}
                >
                  {group.label}
                </button>
              ))}
            </div>
            <div className="system-picker" aria-label="System">
              {selectedGroup.systems.map((system) => (
                <button
                  key={system.id}
                  type="button"
                  className={selectedSystem === system.id ? 'active' : 'secondary'}
                  disabled={system.disabled}
                  onClick={() => setSelectedSystem(system.id)}
                >
                  <span>{system.label}</span>
                  {system.note ? <small>{system.note}</small> : null}
                </button>
              ))}
            </div>
            {selectedSystem === 'cpc_party' ? (
              <label className="party-player-select">
                <span>Players</span>
                <select
                  value={partyMaxPlayers}
                  onChange={(event) => setPartyMaxPlayers(Number(event.target.value))}
                >
                  {[2, 3, 4, 5, 6, 7, 8].map((count) => (
                    <option key={count} value={count}>{count}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <button onClick={handleCreate} disabled={loadingCreate || !selectedMachine || selectedMachine.disabled}>
              {loadingCreate ? 'Creating...' : 'Create room'}
            </button>
          </div>

          <div className="panel action-panel">
            <span className="panel-kicker">Guest</span>
            <h2>Join room</h2>
            <p>Enter the six-character room code.</p>
            <input
              placeholder="Room code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            />
            <button onClick={handleJoin} disabled={!joinCode || loadingJoin}>
              {loadingJoin ? 'Joining...' : 'Join room'}
            </button>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </div>
    </div>
  );
}
