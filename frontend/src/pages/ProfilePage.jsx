import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';
import PlayerAvatar, { PLAYER_AVATARS } from '../components/PlayerAvatar';

const achievementIcons = {
  coin: '●', joystick: '🕹️', systems: '▦', flag: '⚑', bronze: '🥉', gold: '🏆', clock: '◷',
};

function memberSince(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(value));
}

function roleLabel(role) {
  if (role === 'vip') return 'VIP PLAYER';
  if (role === 'admin') return 'ADMIN PLAYER';
  return 'PLAYER ONE';
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState('Loading player card…');
  const [savingAvatar, setSavingAvatar] = useState('');

  useEffect(() => {
    apiFetch('/auth/profile')
      .then((data) => { setProfile(data); setStatus(''); })
      .catch((error) => setStatus(`Could not load profile: ${error.message}`));
  }, []);

  async function chooseAvatar(avatarId) {
    if (!profile || savingAvatar) return;
    setSavingAvatar(avatarId);
    try {
      await apiFetch('/auth/profile/avatar', {
        method: 'PATCH',
        body: JSON.stringify({ avatar_id: avatarId }),
      });
      setProfile((current) => ({ ...current, avatar_id: avatarId }));
      localStorage.setItem('playerAvatar', avatarId);
      window.dispatchEvent(new CustomEvent('player-avatar-changed', { detail: avatarId }));
      setStatus('Avatar saved.');
    } catch (error) {
      setStatus(`Could not save avatar: ${error.message}`);
    } finally {
      setSavingAvatar('');
    }
  }

  return (
    <div className="page profile-page">
      <header className="profile-topbar">
        <BrandMark />
        <div>
          <button type="button" className="secondary" onClick={() => navigate('/lobby')}>Lobby</button>
          <button type="button" className="secondary" onClick={() => navigate('/tournaments')}>Tournaments</button>
        </div>
      </header>

      {status && !profile ? <section className="panel profile-loading">{status}</section> : null}
      {profile ? (
        <main className="profile-shell">
          <section className="profile-identity-card">
            <div className="profile-scanlines" />
            <PlayerAvatar avatarId={profile.avatar_id} size="hero" />
            <div className="profile-identity-copy">
              <span>{roleLabel(profile.role)}</span>
              <h1>{profile.username}</h1>
              <p>Member since {memberSince(profile.member_since)}</p>
            </div>
            <div className="profile-level-chip"><small>ACHIEVEMENTS</small><strong>{profile.stats.achievements_unlocked}/{profile.achievements.length}</strong></div>
          </section>

          <section className="profile-stat-grid">
            <article><small>GAME ROOMS</small><strong>{profile.stats.games_played}</strong><span>played</span></article>
            <article><small>PLAY TIME</small><strong>{profile.stats.hours_played}</strong><span>hours</span></article>
            <article><small>SYSTEMS</small><strong>{profile.stats.systems_played}</strong><span>explored</span></article>
            <article><small>TOURNAMENTS</small><strong>{profile.stats.tournaments_entered}</strong><span>entered</span></article>
          </section>

          <div className="profile-content-grid">
            <section className="panel achievement-vault">
              <div className="profile-section-heading"><div><p>PLAYER CABINET</p><h2>Achievements</h2></div><span>{profile.stats.achievements_unlocked} unlocked</span></div>
              <div className="achievement-grid">
                {profile.achievements.map((achievement) => (
                  <article key={achievement.id} className={achievement.unlocked ? 'unlocked' : 'locked'}>
                    <div className="achievement-icon">{achievementIcons[achievement.icon] || '★'}</div>
                    <div><strong>{achievement.name}</strong><p>{achievement.description}</p></div>
                    <span>{achievement.unlocked ? 'UNLOCKED' : 'LOCKED'}</span>
                  </article>
                ))}
              </div>
            </section>

            <aside className="profile-side-column">
              <section className="panel trophy-case">
                <div className="profile-section-heading"><div><p>TOURNAMENTS</p><h2>Trophy case</h2></div></div>
                <div className="medal-shelf">
                  <article><span>🥇</span><strong>{profile.medals.gold}</strong><small>GOLD</small></article>
                  <article><span>🥈</span><strong>{profile.medals.silver}</strong><small>SILVER</small></article>
                  <article><span>🥉</span><strong>{profile.medals.bronze}</strong><small>BRONZE</small></article>
                </div>
                {profile.podiums.length ? (
                  <div className="podium-history">
                    {profile.podiums.slice(0, 5).map((result) => <div key={result.code}><span>{['🥇', '🥈', '🥉'][result.rank - 1]}</span><p><strong>{result.name}</strong><small>{result.game}</small></p><b>{Number(result.score).toLocaleString()}</b></div>)}
                  </div>
                ) : <p className="profile-empty">Your first podium finish will appear here.</p>}
              </section>

              <section className="panel avatar-locker">
                <div className="profile-section-heading"><div><p>PLAYER LOOK</p><h2>Avatar locker</h2></div></div>
                <div className="avatar-options">
                  {profile.available_avatars.map((avatarId) => (
                    <button key={avatarId} type="button" className={profile.avatar_id === avatarId ? 'selected' : ''} onClick={() => chooseAvatar(avatarId)} disabled={Boolean(savingAvatar)} title={PLAYER_AVATARS[avatarId]?.label}>
                      <PlayerAvatar avatarId={avatarId} size="small" />
                    </button>
                  ))}
                </div>
                <small>{status || 'Choose a character for your player bubble.'}</small>
              </section>
            </aside>
          </div>
        </main>
      ) : null}
    </div>
  );
}
