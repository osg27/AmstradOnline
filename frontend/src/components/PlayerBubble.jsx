import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import PlayerAvatar from './PlayerAvatar';

export default function PlayerBubble({ compact = false }) {
  const navigate = useNavigate();
  const username = localStorage.getItem('username') || 'Player';
  const [avatarId, setAvatarId] = useState(localStorage.getItem('playerAvatar') || 'arcade-green');

  useEffect(() => {
    apiFetch('/auth/profile').then((profile) => {
      setAvatarId(profile.avatar_id);
      localStorage.setItem('playerAvatar', profile.avatar_id);
    }).catch(() => {});
    const refresh = (event) => setAvatarId(event.detail || localStorage.getItem('playerAvatar') || 'arcade-green');
    window.addEventListener('player-avatar-changed', refresh);
    return () => window.removeEventListener('player-avatar-changed', refresh);
  }, []);

  return (
    <button type="button" className={`player-bubble${compact ? ' compact' : ''}`} onClick={() => navigate('/profile')} title="Open player profile">
      <PlayerAvatar avatarId={avatarId} size="small" />
      {!compact ? <span><small>PLAYER PROFILE</small><strong>{username}</strong></span> : null}
      <i className="bi bi-chevron-right" aria-hidden="true" />
    </button>
  );
}
