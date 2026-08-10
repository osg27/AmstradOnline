import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { armNotificationSound, playRoomInviteSound } from '../utils/notificationSound';

const NOTIFIED_ROOM_INVITES_KEY = 'oldstylegaming:notified-room-invites';

function readNotifiedInviteIds() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(NOTIFIED_ROOM_INVITES_KEY) || '[]').map(String));
  } catch {
    return new Set();
  }
}

const EMPTY_SOCIAL = {
  online_users: [],
  friends: [],
  incoming_requests: [],
  outgoing_requests: [],
  room_invites: [],
};

export default function SocialSidebar({ roomCode = '', allowInvites = false, showOnline = true, onMessagePlayer = null }) {
  const navigate = useNavigate();
  const [social, setSocial] = useState(EMPTY_SOCIAL);
  const [friendUsername, setFriendUsername] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invitedFriendIds, setInvitedFriendIds] = useState(() => new Set());
  const notifiedInviteIdsRef = useRef(readNotifiedInviteIds());

  function applySocialOverview(overview) {
    const inviteIds = (overview?.room_invites || []).map((invite) => String(invite.id));
    const newInviteIds = inviteIds.filter((id) => !notifiedInviteIdsRef.current.has(id));
    inviteIds.forEach((id) => notifiedInviteIdsRef.current.add(id));
    try {
      sessionStorage.setItem(
        NOTIFIED_ROOM_INVITES_KEY,
        JSON.stringify(Array.from(notifiedInviteIdsRef.current).slice(-100)),
      );
    } catch {
      // Storage can be unavailable in private browsing; the in-memory set still prevents repeats.
    }
    setSocial(overview);
    if (newInviteIds.length) {
      playRoomInviteSound().then((played) => {
        if (!played) {
          newInviteIds.forEach((id) => notifiedInviteIdsRef.current.delete(id));
          try {
            sessionStorage.setItem(
              NOTIFIED_ROOM_INVITES_KEY,
              JSON.stringify(Array.from(notifiedInviteIdsRef.current).slice(-100)),
            );
          } catch {
            // Keep retrying from the in-memory set when storage is unavailable.
          }
        }
      });
    }
  }

  async function refreshSocial() {
    const overview = await apiFetch('/auth/social');
    applySocialOverview(overview);
  }

  useEffect(() => {
    let active = true;
    const disarm = armNotificationSound();

    async function loadSocial() {
      try {
        const overview = await apiFetch('/auth/social');
        if (active) applySocialOverview(overview);
      } catch (err) {
        if (active) setError(err.message);
      }
    }

    loadSocial();
    const timer = window.setInterval(loadSocial, 8000);
    return () => {
      active = false;
      window.clearInterval(timer);
      disarm();
    };
  }, []);

  useEffect(() => {
    setInvitedFriendIds(new Set());
  }, [roomCode]);

  async function runAction(action, successMessage) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      await refreshSocial();
      setMessage(successMessage);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendFriendRequest(event) {
    event.preventDefault();
    const requestedUsername = friendUsername.trim();
    if (!requestedUsername) return;
    const sent = await runAction(
      () => apiFetch('/auth/social/requests', {
        method: 'POST',
        body: JSON.stringify({ username: requestedUsername }),
      }),
      `Friend request sent to ${requestedUsername}.`,
    );
    if (sent) setFriendUsername('');
  }

  async function joinInvite(invite) {
    setBusy(true);
    setError('');
    try {
      await apiFetch('/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ room_code: invite.room_code }),
      });
      navigate(`/room/${invite.room_code}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function sendRoomInvite(friend) {
    const sent = await runAction(
      () => apiFetch(`/auth/social/friends/${friend.id}/invite/${roomCode}`, { method: 'POST' }),
      `Room invite sent to ${friend.username}.`,
    );
    if (sent) {
      setInvitedFriendIds((current) => new Set(current).add(friend.id));
    }
  }

  return (
    <aside className="social-sidebar" aria-label="Friends and online players">
      {social.room_invites.length ? (
        <section className="social-sidebar-section room-invites">
          <div className="social-heading">
            <h2>Room invites</h2>
          </div>
          <div className="social-list">
            {social.room_invites.map((invite) => (
              <div className="social-player social-invite" key={invite.id}>
                <span>
                  <strong>{invite.sender_username}</strong>
                  <small>Room {invite.room_code}</small>
                </span>
                <button type="button" disabled={busy} onClick={() => joinInvite(invite)}>Join</button>
                <button
                  className="secondary social-action"
                  type="button"
                  disabled={busy}
                  onClick={() => runAction(
                    () => apiFetch(`/auth/social/invites/${invite.id}`, { method: 'DELETE' }),
                    'Invite dismissed.',
                  )}
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {showOnline ? <section className="social-sidebar-section">
        <div className="social-heading">
          <div>
            <h2>Online now</h2>
            <p>{social.online_users.length} other player{social.online_users.length === 1 ? '' : 's'}</p>
          </div>
          <button
            className="secondary social-refresh"
            type="button"
            disabled={busy}
            onClick={() => runAction(() => Promise.resolve(), 'Online list refreshed.')}
          >
            Refresh
          </button>
        </div>
        <div className="social-list">
          {social.online_users.length ? social.online_users.map((player) => (
            <div className="social-player" key={player.id}>
              <span className="online-dot" aria-label="Online" />
              <strong>{player.username}</strong>
              {onMessagePlayer ? (
                <button
                  className="secondary social-action"
                  type="button"
                  disabled={busy}
                  onClick={() => onMessagePlayer(player)}
                >
                  Message
                </button>
              ) : null}
              {player.is_friend ? <small>Friend</small> : player.request_pending ? <small>Pending</small> : (
                <button
                  className="secondary social-action"
                  type="button"
                  disabled={busy}
                  onClick={() => runAction(
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
      </section> : null}

      <section className="social-sidebar-section">
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
                  disabled={busy}
                  onClick={() => runAction(
                    () => apiFetch(`/auth/social/requests/${request.friendship_id}/accept`, { method: 'POST' }),
                    `${request.username} added as a friend.`,
                  )}
                >
                  Accept
                </button>
                <button
                  className="secondary social-action"
                  type="button"
                  disabled={busy}
                  onClick={() => runAction(
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
              {onMessagePlayer ? (
                <button
                  className="secondary social-action"
                  type="button"
                  disabled={busy}
                  onClick={() => onMessagePlayer(friend)}
                >
                  Message
                </button>
              ) : null}
              {allowInvites ? (
                <button
                  className="social-action"
                  type="button"
                  disabled={busy || invitedFriendIds.has(friend.id)}
                  onClick={() => sendRoomInvite(friend)}
                >
                  {invitedFriendIds.has(friend.id) ? 'Invite sent' : 'Invite'}
                </button>
              ) : null}
            </div>
          )) : <p className="social-empty">Add someone by username to start your friends list.</p>}
        </div>

        <form className="friend-add" onSubmit={sendFriendRequest}>
          <input
            value={friendUsername}
            onChange={(event) => setFriendUsername(event.target.value)}
            placeholder="Player username"
            maxLength={50}
          />
          <button type="submit" disabled={!friendUsername.trim() || busy}>Add</button>
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
                  disabled={busy}
                  onClick={() => runAction(
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
      </section>

      {message ? <p className="social-message">{message}</p> : null}
      {error ? <p className="error social-message">{error}</p> : null}
    </aside>
  );
}
