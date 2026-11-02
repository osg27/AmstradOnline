import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { apiFetch, clearAuthSession } from '../api/client';
import PlayerAvatar from './PlayerAvatar';
import logoUrl from '../../assets/Logo.png';
import VerifyBanner from './VerifyBanner';
import './AppShell.css';

const NAV_ITEMS = [
  { to: '/lobby', label: 'Play', icon: 'bi-play-fill' },
  { to: '/library', label: 'Library', icon: 'bi-grid-fill' },
  { to: '/tournaments', label: 'Compete', icon: 'bi-trophy-fill', badge: 'tournaments' },
  { to: '/messages', label: 'Friends', icon: 'bi-people-fill', badge: 'messages' },
];

function JoinRoomDialog({ onClose }) {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!code.trim()) return;
    setError('');
    setBusy(true);
    try {
      const room = await apiFetch('/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ room_code: code.trim().toUpperCase(), password: password || undefined }),
      });
      onClose();
      navigate(`/room/${room.room_code}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="osg-dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="osg-dialog" role="dialog" aria-modal="true" aria-labelledby="join-title" onSubmit={handleSubmit}>
        <h2 id="join-title">Join a room</h2>
        <p>Enter the code your friend shared with you.</p>
        <input
          ref={inputRef}
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="Room code, e.g. K7Q2XM"
          aria-label="Room code"
          maxLength={12}
          autoComplete="off"
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Room password (only if asked)"
          aria-label="Room password"
        />
        {error ? <p className="error">{error}</p> : null}
        <div className="osg-dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!code.trim() || busy}>{busy ? 'Joining…' : 'Join room'}</button>
        </div>
      </form>
    </div>
  );
}

function readRoles() {
  return {
    isAdmin: localStorage.getItem('isAdmin') === 'true' || localStorage.getItem('isSuperAdmin') === 'true',
    isTester: localStorage.getItem('isTester') === 'true',
  };
}

function AccountMenu() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [avatarId, setAvatarId] = useState(localStorage.getItem('playerAvatar') || 'arcade-green');
  const [roles, setRoles] = useState(readRoles);
  const [feedbackCount, setFeedbackCount] = useState(0);
  const menuRef = useRef(null);
  const username = localStorage.getItem('username') || 'Player';
  const { isAdmin, isTester } = roles;

  useEffect(() => {
    const refresh = () => setRoles(readRoles());
    window.addEventListener('osg-session-roles-changed', refresh);
    return () => window.removeEventListener('osg-session-roles-changed', refresh);
  }, []);

  // Unread feedback notifications for admins and testers (moved here from the old lobby header).
  useEffect(() => {
    if (!isAdmin && !isTester) { setFeedbackCount(0); return undefined; }
    let cancelled = false;
    apiFetch('/auth/feedback/notifications')
      .then((notifications) => {
        if (!cancelled) setFeedbackCount(Array.isArray(notifications) ? notifications.filter((item) => !item.is_read).length : 0);
      })
      .catch(() => { if (!cancelled) setFeedbackCount(0); });
    return () => { cancelled = true; };
  }, [isAdmin, isTester, open]);

  useEffect(() => {
    apiFetch('/auth/profile').then((profile) => {
      setAvatarId(profile.avatar_id);
      localStorage.setItem('playerAvatar', profile.avatar_id);
    }).catch(() => {});
    const refresh = (event) => setAvatarId(event.detail || localStorage.getItem('playerAvatar') || 'arcade-green');
    window.addEventListener('player-avatar-changed', refresh);
    return () => window.removeEventListener('player-avatar-changed', refresh);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (!menuRef.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function logout() {
    apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    clearAuthSession();
    navigate('/login');
  }

  return (
    <div className="osg-account" ref={menuRef}>
      <button
        type="button"
        className="osg-account-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${username} account menu${feedbackCount ? `, ${feedbackCount} unread feedback` : ''}`}
        onClick={() => setOpen((value) => !value)}
      >
        <PlayerAvatar avatarId={avatarId} size="small" />
        {feedbackCount ? <span className="osg-account-pip" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className="osg-account-menu" role="menu">
          <div className="osg-account-name">{username}</div>
          <button type="button" role="menuitem" onClick={() => navigate('/profile')}><i className="bi bi-person-fill" aria-hidden="true" />Profile</button>
          <button type="button" role="menuitem" onClick={() => navigate('/my-local-games')}><i className="bi bi-folder-fill" aria-hidden="true" />Manage game files</button>
          {isAdmin || isTester ? (
            <button type="button" role="menuitem" onClick={() => navigate('/feedback')}><i className="bi bi-chat-square-text-fill" aria-hidden="true" />Feedback{feedbackCount ? <span className="osg-count">{feedbackCount}</span> : null}</button>
          ) : null}
          {isAdmin ? (
            <button type="button" role="menuitem" onClick={() => navigate('/admin')}><i className="bi bi-shield-lock-fill" aria-hidden="true" />Admin</button>
          ) : null}
          <button type="button" role="menuitem" className="danger" onClick={logout}><i className="bi bi-box-arrow-right" aria-hidden="true" />Log out</button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Shared frame for every signed-in page except the game room:
 * a top bar on desktop and a bottom tab bar on phones, with the same four sections.
 */
export default function AppShell({ children, className = '' }) {
  const [joinOpen, setJoinOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [openTournaments, setOpenTournaments] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadUnread() {
      try {
        const status = await apiFetch('/auth/social/messages/unread');
        if (!cancelled) setUnread(Number(status.unread_count) || 0);
      } catch {
        if (!cancelled) setUnread(0);
      }
    }
    loadUnread();
    const timer = window.setInterval(loadUnread, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadTournaments() {
      try {
        const tournaments = await apiFetch('/auth/tournaments/public');
        if (!cancelled) {
          setOpenTournaments(Array.isArray(tournaments)
            ? tournaments.filter((item) => !item.joined && item.status !== 'completed').length
            : 0);
        }
      } catch {
        if (!cancelled) setOpenTournaments(0);
      }
    }
    loadTournaments();
    const timer = window.setInterval(loadTournaments, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const badgeFor = (item) => {
    if (item.badge === 'messages') return unread;
    if (item.badge === 'tournaments') return openTournaments;
    return 0;
  };
  const badgeLabel = (item) => {
    const count = badgeFor(item);
    if (!count) return item.label;
    return item.badge === 'messages' ? `${item.label}, ${count} unread` : `${item.label}, ${count} open`;
  };

  return (
    <div className={`osg-shell ${className}`}>
      <header className="osg-topbar">
        <div className="osg-topbar-in">
          <NavLink to="/lobby" className="osg-brand" aria-label="Old Style Gaming home">
            <img src={logoUrl} alt="" />
            <span>Old Style<br /><em>Gaming</em></span>
          </NavLink>
          <nav className="osg-nav" aria-label="Main">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')} aria-label={badgeLabel(item)}>
                {item.label}
                {badgeFor(item) ? <span className="osg-count">{badgeFor(item)}</span> : null}
              </NavLink>
            ))}
          </nav>
          <div className="osg-top-actions">
            <button type="button" className="secondary osg-join" onClick={() => setJoinOpen(true)}>
              <i className="bi bi-box-arrow-in-right" aria-hidden="true" />
              <span>Join with code</span>
            </button>
            <AccountMenu />
          </div>
        </div>
      </header>

      <VerifyBanner />
      <main className="osg-shell-main">{children}</main>

      <nav className="osg-tabbar" aria-label="Main">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')} aria-label={badgeLabel(item)}>
            <i className={`bi ${item.icon}`} aria-hidden="true" />
            {item.label}
            {badgeFor(item) ? <span className="osg-count">{badgeFor(item)}</span> : null}
          </NavLink>
        ))}
      </nav>

      {joinOpen ? <JoinRoomDialog onClose={() => setJoinOpen(false)} /> : null}
    </div>
  );
}
