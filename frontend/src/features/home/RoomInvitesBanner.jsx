import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { armNotificationSound, playRoomInviteSound } from '../../utils/notificationSound';

// Shared with SocialSidebar so an invite only chimes once per browser session.
const NOTIFIED_ROOM_INVITES_KEY = 'oldstylegaming:notified-room-invites';

function readNotified() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(NOTIFIED_ROOM_INVITES_KEY) || '[]').map(String));
  } catch {
    return new Set();
  }
}

function saveNotified(ids) {
  try {
    sessionStorage.setItem(NOTIFIED_ROOM_INVITES_KEY, JSON.stringify(Array.from(ids).slice(-100)));
  } catch {
    // The in-memory set still prevents repeats.
  }
}

/** Pending room invites from friends, shown at the top of Play (previously in the lobby sidebar). */
export default function RoomInvitesBanner() {
  const navigate = useNavigate();
  const [invites, setInvites] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const notifiedRef = useRef(readNotified());

  useEffect(() => {
    let active = true;
    const disarm = armNotificationSound();
    async function load() {
      try {
        const overview = await apiFetch('/auth/social');
        if (!active) return;
        const next = Array.isArray(overview?.room_invites) ? overview.room_invites : [];
        const fresh = next.map((invite) => String(invite.id)).filter((id) => !notifiedRef.current.has(id));
        fresh.forEach((id) => notifiedRef.current.add(id));
        saveNotified(notifiedRef.current);
        setInvites(next);
        if (fresh.length) {
          playRoomInviteSound().then((played) => {
            if (played) return;
            fresh.forEach((id) => notifiedRef.current.delete(id));
            saveNotified(notifiedRef.current);
          });
        }
      } catch {
        // Invites are optional on this page; the Friends page shows errors.
      }
    }
    load();
    const timer = window.setInterval(load, 8000);
    return () => { active = false; window.clearInterval(timer); disarm(); };
  }, []);

  async function join(invite) {
    setBusy(true);
    setError('');
    try {
      await apiFetch('/rooms/join', { method: 'POST', body: JSON.stringify({ room_code: invite.room_code }) });
      navigate(`/room/${invite.room_code}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function dismiss(invite) {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/auth/social/invites/${invite.id}`, { method: 'DELETE' });
      setInvites((current) => current.filter((item) => item.id !== invite.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!invites.length) return null;

  return (
    <section className="osg-invites" aria-label="Room invites" aria-live="polite">
      {invites.map((invite) => (
        <div className="osg-invite" key={invite.id}>
          <span className="osg-invite-pip" aria-hidden="true" />
          <p><b>{invite.sender_username}</b> invited you to room <span className="osg-invite-code">{invite.room_code}</span></p>
          <div className="osg-invite-actions">
            <button type="button" className="secondary" disabled={busy} onClick={() => dismiss(invite)}>Dismiss</button>
            <button type="button" disabled={busy} onClick={() => join(invite)}>Join</button>
          </div>
        </div>
      ))}
      {error ? <p className="osg-sheet-error" role="alert">{error}</p> : null}
    </section>
  );
}
