import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';

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
    ],
  },
  {
    id: '16bit',
    label: '16-bit',
    strapline: 'Amiga, Mega Drive and SNES games.',
    previewOnly: true,
    systems: [
      {
        id: 'amiga',
        name: 'Commodore Amiga',
        shortName: 'A500',
        accent: 'blue',
        summary: 'Amiga 500 games with joystick and mouse support.',
        formats: '.adf .zip',
        badge: 'Testing',
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Not available yet' },
          link: { enabled: false, note: 'Not available yet' },
        },
      },
      {
        id: 'amiga_aga',
        name: 'Amiga AGA',
        shortName: 'A1200',
        accent: 'blue',
        summary: 'Amiga 1200 and AGA games. Multi-disk games are supported.',
        formats: '.adf .zip',
        badge: 'Testing',
        modes: {
          solo: { enabled: true },
          hosted: { enabled: true },
          party: { enabled: false, note: 'Not available yet' },
          link: { enabled: false, note: 'Not available yet' },
        },
      },
      {
        id: 'megadrive',
        name: 'Mega Drive',
        shortName: 'MD',
        accent: 'violet',
        summary: 'Mega Drive games with two-player controls.',
        formats: '.bin .gen .md .smd',
        badge: 'Testing',
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
        badge: 'Testing',
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
    adminOnly: true,
    systems: [
      {
        id: 'arcade',
        name: 'MAME Arcade',
        shortName: 'MAME',
        accent: 'gold',
        summary: 'Load a MAME ROM and play.',
        formats: '.zip',
        badge: 'Admin',
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
  const [isTester, setIsTester] = useState(localStorage.getItem('isTester') === 'true');
  const [selectedEra, setSelectedEra] = useState('8bit');
  const [selectedSystemId, setSelectedSystemId] = useState('cpc');
  const [selectedMode, setSelectedMode] = useState('hosted');
  const [partyMaxPlayers, setPartyMaxPlayers] = useState(4);
  const [feedbackNotificationCount, setFeedbackNotificationCount] = useState(0);
  const [social, setSocial] = useState({
    online_users: [],
    friends: [],
    incoming_requests: [],
    outgoing_requests: [],
  });
  const [friendUsername, setFriendUsername] = useState('');
  const [socialMessage, setSocialMessage] = useState('');
  const [socialError, setSocialError] = useState('');
  const [socialBusy, setSocialBusy] = useState(false);
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
        if (nextIsAdmin || nextIsTester) {
          const notifications = await apiFetch('/auth/feedback/notifications');
          setFeedbackNotificationCount(notifications.filter((notification) => !notification.is_read).length);
        }
      } catch {
        setIsAdmin(false);
        setIsTester(false);
        setFeedbackNotificationCount(0);
        localStorage.removeItem('isAdmin');
        localStorage.removeItem('isTester');
        chooseGroup('8bit', SYSTEM_GROUPS[0]);
      }
    }

    loadSession();
  }, []);

  useEffect(() => {
    let active = true;

    async function loadSocial() {
      try {
        const overview = await apiFetch('/auth/social');
        if (active) setSocial(overview);
      } catch (err) {
        if (active) setSocialError(err.message);
      }
    }

    loadSocial();
    const socialTimer = window.setInterval(loadSocial, 20000);
    return () => {
      active = false;
      window.clearInterval(socialTimer);
    };
  }, []);

  async function refreshSocial() {
    const overview = await apiFetch('/auth/social');
    setSocial(overview);
  }

  async function runSocialAction(action, successMessage) {
    setSocialBusy(true);
    setSocialError('');
    setSocialMessage('');
    try {
      await action();
      await refreshSocial();
      setSocialMessage(successMessage);
      return true;
    } catch (err) {
      setSocialError(err.message);
      return false;
    } finally {
      setSocialBusy(false);
    }
  }

  async function sendFriendRequest(event) {
    event.preventDefault();
    const requestedUsername = friendUsername.trim();
    if (!requestedUsername) return;
    const sent = await runSocialAction(
      () => apiFetch('/auth/social/requests', {
        method: 'POST',
        body: JSON.stringify({ username: requestedUsername }),
      }),
      `Friend request sent to ${requestedUsername}.`,
    );
    if (sent) setFriendUsername('');
  }

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

        <section className="social-panel" aria-label="Friends and online players">
          <div className="social-column">
            <div className="social-heading">
              <div>
                <h2>Online now</h2>
                <p>{social.online_users.length} other player{social.online_users.length === 1 ? '' : 's'} online</p>
              </div>
              <button
                className="secondary social-refresh"
                type="button"
                onClick={() => runSocialAction(() => Promise.resolve(), 'Online list refreshed.')}
                title="Refresh online players"
              >
                Refresh
              </button>
            </div>
            <div className="social-list">
              {social.online_users.length ? social.online_users.map((player) => (
                <div className="social-player" key={player.id}>
                  <span className="online-dot" aria-label="Online" />
                  <strong>{player.username}</strong>
                  {player.is_friend ? (
                    <small>Friend</small>
                  ) : player.request_pending ? (
                    <small>Request pending</small>
                  ) : (
                    <button
                      className="secondary social-action"
                      type="button"
                      disabled={socialBusy}
                      onClick={() => runSocialAction(
                        () => apiFetch('/auth/social/requests', {
                          method: 'POST',
                          body: JSON.stringify({ username: player.username }),
                        }),
                        `Friend request sent to ${player.username}.`,
                      )}
                    >
                      Add
                    </button>
                  )}
                </div>
              )) : <p className="social-empty">Nobody else is online just now.</p>}
            </div>
          </div>

          <div className="social-column">
            <div className="social-heading">
              <div>
                <h2>Friends</h2>
                <p>{social.friends.filter((friend) => friend.is_online).length} online</p>
              </div>
            </div>

            {social.incoming_requests.length ? (
              <div className="friend-requests">
                <strong>Friend requests</strong>
                {social.incoming_requests.map((request) => (
                  <div className="social-player" key={request.friendship_id}>
                    <strong>{request.username}</strong>
                    <button
                      className="social-action"
                      type="button"
                      disabled={socialBusy}
                      onClick={() => runSocialAction(
                        () => apiFetch(`/auth/social/requests/${request.friendship_id}/accept`, { method: 'POST' }),
                        `${request.username} added as a friend.`,
                      )}
                    >
                      Accept
                    </button>
                    <button
                      className="secondary social-action"
                      type="button"
                      disabled={socialBusy}
                      onClick={() => runSocialAction(
                        () => apiFetch(`/auth/social/requests/${request.friendship_id}`, { method: 'DELETE' }),
                        'Friend request declined.',
                      )}
                    >
                      Decline
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="social-list">
              {social.friends.length ? social.friends.map((friend) => (
                <div className="social-player" key={friend.id}>
                  <span className={friend.is_online ? 'online-dot' : 'offline-dot'} aria-label={friend.is_online ? 'Online' : 'Offline'} />
                  <strong>{friend.username}</strong>
                  <small>{friend.is_online ? 'Online' : 'Offline'}</small>
                  <button
                    className="secondary social-action"
                    type="button"
                    disabled={socialBusy}
                    onClick={() => runSocialAction(
                      () => apiFetch(`/auth/social/friends/${friend.id}`, { method: 'DELETE' }),
                      `${friend.username} removed from friends.`,
                    )}
                  >
                    Remove
                  </button>
                </div>
              )) : <p className="social-empty">Add a player by username to start your friends list.</p>}
            </div>

            <form className="friend-add" onSubmit={sendFriendRequest}>
              <input
                value={friendUsername}
                onChange={(event) => setFriendUsername(event.target.value)}
                placeholder="Player username"
                maxLength={50}
              />
              <button type="submit" disabled={!friendUsername.trim() || socialBusy}>Add friend</button>
            </form>

            {social.outgoing_requests.length ? (
              <div className="friend-requests outgoing-requests">
                <strong>Sent requests</strong>
                {social.outgoing_requests.map((request) => (
                  <div className="social-player" key={request.friendship_id}>
                    <strong>{request.username}</strong>
                    <button
                      className="secondary social-action"
                      type="button"
                      disabled={socialBusy}
                      onClick={() => runSocialAction(
                        () => apiFetch(`/auth/social/requests/${request.friendship_id}`, { method: 'DELETE' }),
                        'Friend request cancelled.',
                      )}
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {socialMessage ? <p className="social-message">{socialMessage}</p> : null}
            {socialError ? <p className="error social-message">{socialError}</p> : null}
          </div>
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
              {Object.entries(PLAY_MODES).filter(([modeId]) => (
                modeId !== 'link' || selectedSystem?.id === 'amiga'
              )).map(([modeId, mode]) => {
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
              {loadingCreate ? 'Starting...' : selectedMode === 'solo' ? 'Play now' : selectedMode === 'party' ? 'Start Party Mode' : selectedMode === 'link' ? 'Start Link Play' : 'Start online room'}
            </button>

            {error ? <p className="error">{error}</p> : null}
          </aside>
        </main>
      </div>
    </div>
  );
}
