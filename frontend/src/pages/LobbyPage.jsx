import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';

const PLAY_MODES = {
  solo: {
    label: '1 Player',
    kicker: 'Local',
    description: 'Boot the emulator for a single-player session.',
  },
  hosted: {
    label: 'Hosted',
    kicker: 'Online',
    description: 'Create a room and stream the host emulator to guests.',
  },
  party: {
    label: 'Party Mode',
    kicker: 'Turns',
    description: 'Shared-room play for more than two players.',
  },
  link: {
    label: 'Link Play',
    kicker: 'Twin emu',
    description: 'Two emulator instances connected together.',
  },
};

const SYSTEM_GROUPS = [
  {
    id: '8bit',
    label: '8-bit',
    strapline: 'Home computers, tapes, disks, and proper living-room chaos.',
    systems: [
      {
        id: 'cpc',
        name: 'Amstrad CPC',
        shortName: 'CPC',
        accent: 'green',
        summary: 'Cursor keys, disks, party turns, and classic two-player sessions.',
        formats: '.dsk',
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: true, system: 'cpc_party' },
          link: { enabled: false, note: 'Not planned for CPC yet' },
        },
      },
      {
        id: 'spectrum',
        name: 'ZX Spectrum',
        shortName: 'ZX',
        accent: 'ruby',
        summary: 'Tape snapshots and Sinclair joystick controls.',
        formats: '.tap .tzx .z80 .sna .szx',
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Party mode later' },
          link: { enabled: false, note: 'No link mode yet' },
        },
      },
    ],
  },
  {
    id: '16bit',
    label: '16-bit',
    strapline: 'The big jump: disks, pads, mice, and richer multiplayer ideas.',
    previewOnly: true,
    systems: [
      {
        id: 'amiga',
        name: 'Commodore Amiga',
        shortName: 'A500',
        accent: 'blue',
        summary: 'ADF/LHA loading, mouse support, AROS fallback, and future serial link play.',
        formats: '.adf .adz .dms .hdf .lha .zip',
        badge: 'Preview',
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Design stage' },
          link: { enabled: false, note: 'Needs serial bridge' },
        },
      },
      {
        id: 'amiga_aga',
        name: 'Amiga AGA',
        shortName: 'A1200',
        accent: 'blue',
        summary: 'A1200/AGA games through dedicated PUAE WASM with real Kickstart and multi-disk support.',
        formats: '.uae .adf .adz .dms .hdf .lha .zip',
        badge: 'Preview',
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Not wired' },
          link: { enabled: false, note: 'Serial bridge later' },
        },
      },
      {
        id: 'megadrive',
        name: 'Mega Drive',
        shortName: 'MD',
        accent: 'violet',
        summary: 'Fast pad play with A/B/C and Start mapped for guests.',
        formats: '.bin .gen .md .smd',
        badge: 'Preview',
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Not wired' },
          link: { enabled: false, note: 'Not applicable' },
        },
      },
      {
        id: 'snes',
        name: 'SNES',
        shortName: 'SNES',
        accent: 'amber',
        summary: 'Pad-first console rooms for couch co-op classics.',
        formats: '.sfc .smc',
        badge: 'Preview',
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Not wired' },
          link: { enabled: false, note: 'Not applicable' },
        },
      },
    ],
  },
  {
    id: 'arcade',
    label: 'Arcade',
    strapline: 'Cabinet games, ROM zips, and experiments that need careful handling.',
    adminOnly: true,
    systems: [
      {
        id: 'arcade',
        name: 'MAME Arcade',
        shortName: 'MAME',
        accent: 'gold',
        summary: 'Admin-only test bench for arcade ROMs and WASM runtimes.',
        formats: '.zip',
        badge: 'Admin',
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Cabinet party later' },
          link: { enabled: false, note: 'Not wired' },
        },
      },
    ],
  },
];

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
  const [selectedSystemId, setSelectedSystemId] = useState('cpc');
  const [selectedMode, setSelectedMode] = useState('hosted');
  const [partyMaxPlayers, setPartyMaxPlayers] = useState(4);
  const canUsePreviewSystems = isAdmin || isTester;

  const visibleGroups = useMemo(() => SYSTEM_GROUPS.map((group) => ({
    ...group,
    systems: group.systems.filter((system) => !system.adminOnly || isAdmin),
  })).filter((group) => {
    if (group.adminOnly) return isAdmin;
    if (group.previewOnly) return canUsePreviewSystems;
    return group.systems.length > 0;
  }), [canUsePreviewSystems, isAdmin]);

  const selectedGroup = visibleGroups.find((group) => group.id === selectedEra) || visibleGroups[0];
  const selectedSystem = selectedGroup?.systems.find((system) => system.id === selectedSystemId) || selectedGroup?.systems[0];
  const selectedModeConfig = selectedSystem?.modes[selectedMode];

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
        if (!nextIsAdmin && !nextIsTester && selectedEra !== '8bit') {
          chooseGroup('8bit', SYSTEM_GROUPS[0]);
        }
      } catch {
        setIsAdmin(false);
        setIsTester(false);
        localStorage.removeItem('isAdmin');
        localStorage.removeItem('isTester');
        chooseGroup('8bit', SYSTEM_GROUPS[0]);
      }
    }

    loadSession();
  }, []);

  function chooseGroup(groupId, group = visibleGroups.find((item) => item.id === groupId)) {
    const firstSystem = group?.systems[0];
    setSelectedEra(groupId);
    if (firstSystem) {
      setSelectedSystemId(firstSystem.id);
      setSelectedMode(firstSystem.modes.hosted?.enabled ? 'hosted' : 'solo');
    }
  }

  function chooseSystem(system) {
    setSelectedSystemId(system.id);
    if (!system.modes[selectedMode]?.enabled) {
      setSelectedMode(system.modes.hosted?.enabled ? 'hosted' : 'solo');
    }
  }

  async function createSession(mode = selectedMode) {
    setError('');
    setLoadingCreate(true);
    try {
      const modeConfig = selectedSystem?.modes[mode];
      if (!selectedSystem || !modeConfig?.enabled) {
        throw new Error('That play mode is not ready yet.');
      }

      const roomSystem = modeConfig.system || selectedSystem.id;
      const room = await apiFetch('/rooms/create', {
        method: 'POST',
        body: JSON.stringify({
          system: roomSystem,
          party_max_players: roomSystem === 'cpc_party' ? partyMaxPlayers : 2,
        }),
      });

      const query = mode === 'solo' ? '?mode=solo' : '';
      navigate(`/room/${room.room_code}${query}`);
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
      <div className="lobby-shell">
        <header className="lobby-header">
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
        </header>

        <section className="lobby-hero">
          <div>
            <p className="lobby-eyebrow">Retro Gaming is better with mates</p>
            <h1>Choose a machine and play.</h1>
          </div>
          <form
            className="quick-join"
            onSubmit={(event) => {
              event.preventDefault();
              if (joinCode) handleJoin();
            }}
          >
            <label>
              <span>Join room</span>
              <input
                placeholder="ABC123"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                maxLength={8}
              />
            </label>
            <button type="submit" disabled={!joinCode || loadingJoin}>
              {loadingJoin ? 'Joining...' : 'Join'}
            </button>
          </form>
        </section>

        <main className="library-layout">
          <nav className="platform-tabs" aria-label="Platform category">
            {visibleGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={selectedGroup.id === group.id ? 'active' : 'secondary'}
                onClick={() => chooseGroup(group.id, group)}
              >
                <span>{group.label}</span>
                <small>{group.systems.length} system{group.systems.length === 1 ? '' : 's'}</small>
              </button>
            ))}
          </nav>

          <section className="system-library" aria-label={`${selectedGroup.label} systems`}>
            <div className="library-head">
              <div>
                <h2>{selectedGroup.label}</h2>
                <p>{selectedGroup.strapline}</p>
              </div>
            </div>

            <div className="system-grid">
              {selectedGroup.systems.map((system) => (
                <button
                  key={system.id}
                  type="button"
                  className={`system-card system-card-${system.accent} ${selectedSystem?.id === system.id ? 'active' : ''}`}
                  onClick={() => chooseSystem(system)}
                >
                  <span className="system-short">{system.shortName}</span>
                  <span className="system-name">{system.name}</span>
                  <span className="system-summary">{system.summary}</span>
                  <span className="system-foot">
                    <small>{system.formats}</small>
                    {system.badge ? <em>{system.badge}</em> : null}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <aside className="mode-panel" aria-label="Play modes">
            <div className="mode-head">
              <span>{selectedSystem?.shortName}</span>
              <h2>{selectedSystem?.name}</h2>
              <p>{selectedSystem?.summary}</p>
            </div>

            <div className="mode-list">
              {Object.entries(PLAY_MODES).map(([modeId, mode]) => {
                const modeConfig = selectedSystem?.modes[modeId];
                const enabled = Boolean(modeConfig?.enabled);
                const active = selectedMode === modeId;

                return (
                  <button
                    key={modeId}
                    type="button"
                    className={`mode-card ${active ? 'active' : ''}`}
                    disabled={!enabled}
                    onClick={() => setSelectedMode(modeId)}
                  >
                    <span>{mode.kicker}</span>
                    <strong>{mode.label}</strong>
                    <small>{enabled ? mode.description : modeConfig?.note || 'Coming later'}</small>
                  </button>
                );
              })}
            </div>

            {selectedMode === 'party' && selectedSystem?.modes.party?.system === 'cpc_party' ? (
              <label className="party-player-select mode-party-select">
                <span>Party players</span>
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

            <button
              className="launch-button"
              onClick={() => createSession()}
              disabled={loadingCreate || !selectedModeConfig?.enabled}
            >
              {loadingCreate ? 'Starting...' : selectedMode === 'solo' ? 'Start 1 Player' : selectedMode === 'party' ? 'Start Party Mode' : selectedMode === 'link' ? 'Start Link Play' : 'Start Hosted Room'}
            </button>

            {error ? <p className="error">{error}</p> : null}
          </aside>
        </main>
      </div>
    </div>
  );
}
