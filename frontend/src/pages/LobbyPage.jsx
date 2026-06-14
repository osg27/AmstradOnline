import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';
import LobbyChat from '../components/LobbyChat';
import SocialSidebar from '../components/SocialSidebar';

const PLAY_MODES = {
  solo: {
    label: '1 Player',
    kicker: 'Local',
    description: 'Play on your own.',
  },
  hosted: {
    label: 'Play Online',
    kicker: 'Friends',
    description: 'Start a room and share the code.',
  },
  party: {
    label: 'Party Mode',
    kicker: 'Turns',
    description: 'Take turns with a group.',
  },
  link: {
    label: 'Link Play',
    kicker: 'Linked',
    description: 'Connect two machines.',
  },
};

const SYSTEM_GROUPS = [
  {
    id: '8bit',
    label: '8-bit',
    strapline: 'Amstrad and Spectrum games.',
    systems: [
      {
        id: 'cpc',
        name: 'Amstrad CPC',
        shortName: 'CPC',
        accent: 'green',
        summary: 'Load a disk and play. Party Mode is also available.',
        formats: '.dsk',
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: true, system: 'cpc_party' },
          link: { enabled: false, note: 'Not available yet' },
        },
      },
      {
        id: 'spectrum',
        name: 'ZX Spectrum',
        shortName: 'ZX',
        accent: 'ruby',
        summary: 'Load a Spectrum game and play.',
        formats: '.tap .tzx .z80 .sna .szx',
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Not available yet' },
          link: { enabled: false, note: 'Not available yet' },
        },
      },
      {
        id: 'c64',
        name: 'Commodore 64',
        shortName: 'C64',
        accent: 'amber',
        summary: 'Commodore 64 games powered by a local VICE WASM runtime.',
        formats: '.d64 .t64 .tap .prg .crt .zip',
        testing: true,
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Not available yet' },
          link: { enabled: false, note: 'Not available yet' },
        },
      },
    ],
  },
  {
    id: '16bit',
    label: '16-bit',
    strapline: 'Amiga 500, Mega Drive, SNES and PC Engine games.',
    systems: [
      {
        id: 'amiga',
        name: 'Commodore Amiga',
        shortName: 'A500',
        accent: 'blue',
        summary: 'Amiga 500 games with joystick and mouse support.',
        formats: '.adf .zip',
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Not available yet' },
          link: { enabled: true, system: 'amiga_link', testing: true },
        },
      },
      {
        id: 'megadrive',
        name: 'Mega Drive',
        shortName: 'MD',
        accent: 'violet',
        summary: 'Mega Drive games with two-player controls.',
        formats: '.bin .gen .md .smd',
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Not available yet' },
          link: { enabled: false, note: 'Not available' },
        },
      },
      {
        id: 'snes',
        name: 'SNES',
        shortName: 'SNES',
        accent: 'amber',
        summary: 'SNES games with two-player controls.',
        formats: '.sfc .smc',
        testing: true,
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Not available yet' },
          link: { enabled: false, note: 'Not available' },
        },
      },
      {
        id: 'pcengine',
        name: 'PC Engine / TurboGrafx-16',
        shortName: 'PCE',
        accent: 'gold',
        summary: 'PC Engine and TurboGrafx-16 HuCard games.',
        formats: '.pce .sgx .zip',
        superAdminOnly: true,
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Not available yet' },
          link: { enabled: false, note: 'Not available' },
        },
      },
    ],
  },
  {
    id: '32bit',
    label: '32-bit',
    strapline: 'Amiga 1200, AGA and PlayStation games.',
    systems: [
      {
        id: 'amiga_aga',
        name: 'Amiga AGA',
        shortName: 'A1200',
        accent: 'blue',
        summary: 'Amiga 1200 and AGA games. Multi-disk games are supported.',
        formats: '.adf .zip',
        testing: true,
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Not available yet' },
          link: { enabled: false, note: 'Not available yet' },
        },
      },
      {
        id: 'playstation',
        name: 'Sony PlayStation',
        shortName: 'PS1',
        accent: 'violet',
        summary: 'Original PlayStation games using a locally supplied BIOS.',
        formats: '.cue/.bin .chd .pbp .iso .zip .7z',
        superAdminOnly: true,
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Not available yet' },
          link: { enabled: false, note: 'Not available' },
        },
      },
    ],
  },
  {
    id: 'arcade',
    label: 'Arcade',
    strapline: 'MAME arcade games.',
    systems: [
      {
        id: 'arcade',
        name: 'MAME Arcade',
        shortName: 'MAME',
        accent: 'gold',
        summary: 'MAME arcade games with configurable drivers and runtimes.',
        formats: '.zip',
        superAdminOnly: true,
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Not available yet' },
          link: { enabled: false, note: 'Not available' },
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
  const [isSuperAdmin, setIsSuperAdmin] = useState(localStorage.getItem('isSuperAdmin') === 'true');
  const [isTester, setIsTester] = useState(localStorage.getItem('isTester') === 'true');
  const [selectedEra, setSelectedEra] = useState('8bit');
  const [selectedSystemId, setSelectedSystemId] = useState('cpc');
  const [selectedMode, setSelectedMode] = useState('hosted');
  const [partyMaxPlayers, setPartyMaxPlayers] = useState(4);
  const [feedbackNotificationCount, setFeedbackNotificationCount] = useState(0);
  const canUsePreviewSystems = isAdmin || isTester;

  const visibleGroups = useMemo(() => SYSTEM_GROUPS.map((group) => ({
    ...group,
    systems: group.systems.filter((system) => (
      (!system.adminOnly || isAdmin) && (!system.superAdminOnly || isSuperAdmin)
    )).map((system) => {
      const lockedForTesting = Boolean(system.testing && !canUsePreviewSystems);
      const locked = lockedForTesting || Boolean(system.underConstruction);
      return {
        ...system,
        locked,
        badge: system.underConstruction
          ? 'Under construction'
          : system.testing
            ? canUsePreviewSystems ? 'Testing' : 'Coming soon - in testing'
            : null,
      };
    }),
  })).filter((group) => group.systems.length > 0), [canUsePreviewSystems, isAdmin, isSuperAdmin]);

  const selectedGroup = visibleGroups.find((group) => group.id === selectedEra) || visibleGroups[0];
  const selectedSystem = selectedGroup?.systems.find((system) => system.id === selectedSystemId) || selectedGroup?.systems[0];
  const selectedModeConfig = selectedSystem?.modes[selectedMode];

  useEffect(() => {
    async function loadSession() {
      try {
        const session = await apiFetch('/auth/me');
        const nextIsAdmin = Boolean(session.is_admin);
        const nextIsSuperAdmin = Boolean(session.is_super_admin);
        const nextIsTester = Boolean(session.is_tester);

        setIsAdmin(nextIsAdmin);
        setIsSuperAdmin(nextIsSuperAdmin);
        setIsTester(nextIsTester);
        localStorage.setItem('isAdmin', nextIsAdmin ? 'true' : 'false');
        localStorage.setItem('isSuperAdmin', nextIsSuperAdmin ? 'true' : 'false');
        localStorage.setItem('isTester', nextIsTester ? 'true' : 'false');
        if (nextIsAdmin || nextIsTester) {
          const notifications = await apiFetch('/auth/feedback/notifications');
          setFeedbackNotificationCount(notifications.filter((notification) => !notification.is_read).length);
        }
      } catch {
        setIsAdmin(false);
        setIsSuperAdmin(false);
        setIsTester(false);
        setFeedbackNotificationCount(0);
        localStorage.removeItem('isAdmin');
        localStorage.removeItem('isSuperAdmin');
        localStorage.removeItem('isTester');
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
    if (system.locked) return;
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
      if (!selectedSystem || selectedSystem.locked || !modeConfig?.enabled || (selectedSystem.adminOnly && !isAdmin) || (selectedSystem.superAdminOnly && !isSuperAdmin) || (modeConfig.testing && !canUsePreviewSystems)) {
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
    localStorage.removeItem('isSuperAdmin');
    localStorage.removeItem('isTester');
    navigate('/login');
  }

  return (
    <div className="page lobby-page">
      <div className="page-social-layout lobby-social-layout">
        <div className="lobby-shell">
        <header className="lobby-header">
          <BrandMark />
          <div className="account-strip">
            <span>{username}</span>
            {canUsePreviewSystems ? (
              <button className="secondary" onClick={() => navigate('/feedback')}>
                Feedback{feedbackNotificationCount ? ` (${feedbackNotificationCount})` : ''}
              </button>
            ) : null}
            {isAdmin ? (
              <button className="secondary" onClick={() => navigate('/admin')}>Admin</button>
            ) : null}
            <button className="secondary" onClick={logout}>Logout</button>
          </div>
        </header>

        <section className="lobby-hero">
          <div>
            <p className="lobby-eyebrow">Old games, online with mates</p>
            <h1>What do you fancy playing?</h1>
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
                  className={`system-card system-card-${system.accent} ${selectedSystem?.id === system.id ? 'active' : ''} ${system.locked ? 'locked' : ''}`}
                  onClick={() => chooseSystem(system)}
                  aria-disabled={system.locked}
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
              {Object.entries(PLAY_MODES).filter(([modeId]) => (
                modeId !== 'link' || selectedSystem?.id === 'amiga'
              )).map(([modeId, mode]) => {
                const modeConfig = selectedSystem?.modes[modeId];
                const enabled = Boolean(modeConfig?.enabled && !selectedSystem?.locked && (!modeConfig.testing || canUsePreviewSystems));
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
                    <small>{enabled ? mode.description : selectedSystem?.underConstruction ? 'Under construction' : selectedSystem?.testing || modeConfig?.testing ? 'Available to testers for now' : modeConfig?.note || 'Coming later'}</small>
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
              disabled={loadingCreate || selectedSystem?.locked || !selectedModeConfig?.enabled || (selectedModeConfig?.testing && !canUsePreviewSystems)}
            >
              {loadingCreate ? 'Starting...' : selectedSystem?.underConstruction ? 'Under construction' : selectedSystem?.locked ? 'Currently in testing' : selectedMode === 'solo' ? 'Play now' : selectedMode === 'party' ? 'Start Party Mode' : selectedMode === 'link' ? 'Start Link Play' : 'Start online room'}
            </button>

            {error ? <p className="error">{error}</p> : null}
          </aside>
        </main>
        </div>
        <div className="lobby-side-rail">
          <LobbyChat />
          <SocialSidebar />
        </div>
      </div>
    </div>
  );
}
