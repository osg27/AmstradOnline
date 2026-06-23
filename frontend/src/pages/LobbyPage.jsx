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

const PLATFORM_SHELVES = [
  {
    id: 'micros',
    label: 'Micros',
    kicker: 'Keyboards, disks, tapes',
    strapline: 'Home computers with all their lovely awkward keys.',
    eras: [
      {
        id: '8bit',
        label: '8-bit',
        strapline: 'The classic home micro shelf.',
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
            id: 'cpc_pinball',
            name: 'Amstrad Pinball Dreams',
            shortName: 'CPC PD',
            accent: 'violet',
            summary: 'A separate CPC compatibility room for Pinball Dreams experiments.',
            formats: '.dsk',
            superAdminOnly: true,
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: false, note: 'Not available' },
              link: { enabled: false, note: 'Not available' },
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
        strapline: 'The bigger home machines.',
        systems: [
          {
            id: 'atarist',
            name: 'Atari ST',
            shortName: 'ST',
            accent: 'ruby',
            summary: 'Atari ST games powered by Hatari with keyboard, mouse, joystick, and multi-disk support.',
            formats: '.st .msa .stx .ipf',
            superAdminOnly: true,
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: false, note: 'Not available yet' },
              link: { enabled: false, note: 'Not available yet' },
            },
          },
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
        ],
      },
      {
        id: '32bit',
        label: '32-bit',
        strapline: 'Later home-computer experiments.',
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
        ],
      },
    ],
  },
  {
    id: 'consoles',
    label: 'Consoles',
    kicker: 'Pads, ports, living rooms',
    strapline: 'Console nights, with two-player rooms ready to go.',
    eras: [
      {
        id: '8bit',
        label: '8-bit',
        strapline: 'The first console shelf.',
        systems: [
          {
            id: 'mastersystem',
            name: 'Sega Master System',
            shortName: 'SMS',
            accent: 'violet',
            summary: 'Master System games with two-player controls.',
            formats: '.sms',
            testing: true,
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: false, note: 'Not available yet' },
              link: { enabled: false, note: 'Not available' },
            },
          },
          {
            id: 'nes',
            name: 'Nintendo Entertainment System',
            shortName: 'NES',
            accent: 'ruby',
            summary: 'NES games powered by the EmulatorJS FCEUmm core.',
            formats: '.nes',
            testing: true,
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
        id: '16bit',
        label: '16-bit',
        strapline: 'Cartridges, pads and fast restarts.',
        systems: [
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
            testing: true,
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
        strapline: 'Disc-era console rooms.',
        systems: [
          {
            id: 'playstation',
            name: 'Sony PlayStation',
            shortName: 'PS1',
            accent: 'violet',
            summary: 'Original PlayStation games using a locally supplied BIOS.',
            formats: '.cue/.bin .chd .pbp .iso .zip .7z',
            testing: true,
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: false, note: 'Not available yet' },
              link: { enabled: false, note: 'Not available' },
            },
          },
        ],
      },
    ],
  },
  {
    id: 'arcade',
    label: 'Arcade',
    kicker: 'Cabinets, coins, chaos',
    strapline: 'MAME rooms for one-on-one and party cabinet games.',
    eras: [
      {
        id: 'mame',
        label: 'MAME',
        strapline: 'Arcade boards powered by MAME 2003-Plus.',
        systems: [
          {
            id: 'arcade',
            name: 'MAME Arcade',
            shortName: 'MAME',
            accent: 'gold',
            summary: 'Arcade games using the MAME 2003-Plus ROM set.',
            formats: '.zip',
            testing: true,
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: true, system: 'arcade' },
              link: { enabled: false, note: 'Not available yet' },
            },
          },
        ],
      },
    ],
  },
];

const EMPTY_ERA_COPY = {
  micros: {
    title: 'Nothing wired in here yet',
    detail: 'This shelf is ready for the next batch of home machines.',
  },
  consoles: {
    title: 'Console shelf coming later',
    detail: 'The 8-bit console row is reserved so the library can grow without another redesign.',
  },
  arcade: {
    title: 'No cabinets available yet',
    detail: 'Arcade support will appear here when it is ready for your account.',
  },
};

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
  const [isXyphoe, setIsXyphoe] = useState(localStorage.getItem('isXyphoe') === 'true');
  const [selectedPlatformId, setSelectedPlatformId] = useState('micros');
  const [selectedEra, setSelectedEra] = useState('8bit');
  const [selectedSystemId, setSelectedSystemId] = useState('cpc');
  const [selectedMode, setSelectedMode] = useState('hosted');
  const [partyMaxPlayers, setPartyMaxPlayers] = useState(4);
  const [feedbackNotificationCount, setFeedbackNotificationCount] = useState(0);
  const canUsePreviewSystems = isAdmin || isTester;

  const visibleShelves = useMemo(() => PLATFORM_SHELVES.map((platform) => ({
    ...platform,
    eras: platform.eras.map((era) => ({
      ...era,
      systems: era.systems.filter((system) => (
        (!system.adminOnly || isAdmin) && (!system.superAdminOnly || isSuperAdmin || (system.id === 'cpc_pinball' && (isAdmin || isTester || isXyphoe)) || (system.id === 'atarist' && canUsePreviewSystems))
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
    })),
  })), [canUsePreviewSystems, isAdmin, isSuperAdmin, isXyphoe]);

  const selectedPlatform = visibleShelves.find((platform) => platform.id === selectedPlatformId) || visibleShelves[0];
  const selectedGroup = selectedPlatform?.eras.find((era) => era.id === selectedEra) || selectedPlatform?.eras[0];
  const selectedSystem = selectedGroup?.systems.find((system) => system.id === selectedSystemId) || selectedGroup?.systems[0] || null;
  const selectedModeConfig = selectedSystem?.modes[selectedMode];
  const emptyEraCopy = EMPTY_ERA_COPY[selectedPlatform?.id] || EMPTY_ERA_COPY.micros;

  useEffect(() => {
    if (selectedMode !== 'party') return;
    if (selectedSystem?.modes.party?.system === 'arcade' && ![3, 4].includes(partyMaxPlayers)) {
      setPartyMaxPlayers(4);
    }
  }, [partyMaxPlayers, selectedMode, selectedSystem]);

  useEffect(() => {
    async function loadSession() {
      try {
        const session = await apiFetch('/auth/me');
        const nextIsAdmin = Boolean(session.is_admin);
        const nextIsSuperAdmin = Boolean(session.is_super_admin);
        const nextIsTester = Boolean(session.is_tester);
        const nextIsXyphoe = Boolean(session.is_xyphoe);

        setIsAdmin(nextIsAdmin);
        setIsSuperAdmin(nextIsSuperAdmin);
        setIsTester(nextIsTester);
        setIsXyphoe(nextIsXyphoe);
        localStorage.setItem('isAdmin', nextIsAdmin ? 'true' : 'false');
        localStorage.setItem('isSuperAdmin', nextIsSuperAdmin ? 'true' : 'false');
        localStorage.setItem('isTester', nextIsTester ? 'true' : 'false');
        localStorage.setItem('isXyphoe', nextIsXyphoe ? 'true' : 'false');
        if (nextIsAdmin || nextIsTester) {
          const notifications = await apiFetch('/auth/feedback/notifications');
          setFeedbackNotificationCount(notifications.filter((notification) => !notification.is_read).length);
        }
      } catch {
        setIsAdmin(false);
        setIsSuperAdmin(false);
        setIsTester(false);
        setIsXyphoe(false);
        setFeedbackNotificationCount(0);
        localStorage.removeItem('isAdmin');
        localStorage.removeItem('isSuperAdmin');
        localStorage.removeItem('isTester');
        localStorage.removeItem('isXyphoe');
      }
    }

    loadSession();
  }, []);

  function pickFirstSystem(era) {
    return era?.systems.find((system) => !system.locked) || era?.systems[0] || null;
  }

  function choosePlatform(platformId) {
    const platform = visibleShelves.find((item) => item.id === platformId);
    const nextEra = platform?.eras.find((era) => era.systems.length > 0) || platform?.eras[0];
    const firstSystem = pickFirstSystem(nextEra);

    setSelectedPlatformId(platformId);
    setSelectedEra(nextEra?.id || '8bit');
    if (firstSystem) {
      setSelectedSystemId(firstSystem.id);
      setSelectedMode(firstSystem.modes.hosted?.enabled ? 'hosted' : 'solo');
    }
  }

  function chooseGroup(groupId, group = selectedPlatform?.eras.find((item) => item.id === groupId)) {
    const firstSystem = pickFirstSystem(group);
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
      if (!selectedSystem || selectedSystem.locked || !modeConfig?.enabled || (selectedSystem.adminOnly && !isAdmin) || (selectedSystem.superAdminOnly && !isSuperAdmin && !(selectedSystem.id === 'cpc_pinball' && (isAdmin || isTester || isXyphoe)) && !(selectedSystem.id === 'atarist' && canUsePreviewSystems)) || (modeConfig.testing && !canUsePreviewSystems)) {
        throw new Error('That play mode is not ready yet.');
      }

      const roomSystem = modeConfig.system || selectedSystem.id;
      const isPartyRoom = mode === 'party' && (roomSystem === 'cpc_party' || roomSystem === 'arcade');
      const nextPartyMaxPlayers = roomSystem === 'arcade'
        ? Math.min(4, Math.max(3, partyMaxPlayers))
        : partyMaxPlayers;
      const room = await apiFetch('/rooms/create', {
        method: 'POST',
        body: JSON.stringify({
          system: roomSystem,
          party_max_players: isPartyRoom ? nextPartyMaxPlayers : 2,
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
    localStorage.removeItem('isXyphoe');
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
            {visibleShelves.map((platform) => (
              <button
                key={platform.id}
                type="button"
                className={selectedPlatform?.id === platform.id ? 'active' : 'secondary'}
                onClick={() => choosePlatform(platform.id)}
              >
                <span>{platform.label}</span>
                <small>{platform.kicker}</small>
              </button>
            ))}
          </nav>

          <section className="system-library" aria-label={`${selectedPlatform?.label} ${selectedGroup?.label} systems`}>
            <div className="library-head">
              <div>
                <span>{selectedPlatform?.label}</span>
                <h2>{selectedGroup?.label}</h2>
                <p>{selectedGroup?.strapline}</p>
              </div>
            </div>

            <nav className="era-tabs" aria-label={`${selectedPlatform?.label} era`}>
              {selectedPlatform?.eras.map((era) => (
                <button
                  key={era.id}
                  type="button"
                  className={selectedGroup?.id === era.id ? 'active' : 'secondary'}
                  onClick={() => chooseGroup(era.id, era)}
                >
                  <span>{era.label}</span>
                  <small>{era.systems.length ? `${era.systems.length} ready` : 'empty'}</small>
                </button>
              ))}
            </nav>

            {selectedGroup?.systems.length ? (
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
            ) : (
              <div className="empty-system-shelf">
                <strong>{emptyEraCopy.title}</strong>
                <span>{emptyEraCopy.detail}</span>
              </div>
            )}
          </section>

          <aside className="mode-panel" aria-label="Play modes">
            <div className="mode-head">
              <span>{selectedSystem?.shortName || selectedGroup?.label}</span>
              <h2>{selectedSystem?.name || 'Choose a system'}</h2>
              <p>{selectedSystem?.summary || 'Pick a shelf with available systems to start a room.'}</p>
            </div>

            {selectedSystem ? (
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
            ) : null}

            {selectedMode === 'party' && ['cpc_party', 'arcade'].includes(selectedSystem?.modes.party?.system) ? (
              <label className="party-player-select mode-party-select">
                <span>Party players</span>
                <select
                  value={partyMaxPlayers}
                  onChange={(event) => setPartyMaxPlayers(Number(event.target.value))}
                >
                  {(selectedSystem?.modes.party?.system === 'arcade' ? [3, 4] : [2, 3, 4, 5, 6, 7, 8]).map((count) => (
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
              {loadingCreate ? 'Starting...' : !selectedSystem ? 'Choose a system' : selectedSystem?.underConstruction ? 'Under construction' : selectedSystem?.locked ? 'Currently in testing' : selectedMode === 'solo' ? 'Play now' : selectedMode === 'party' ? 'Start Party Mode' : selectedMode === 'link' ? 'Start Link Play' : 'Start online room'}
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
