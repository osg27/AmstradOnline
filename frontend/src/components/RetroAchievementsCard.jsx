import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';

export default function RetroAchievementsCard() {
  const [data, setData] = useState(null);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiFetch('/auth/profile/retroachievements').then((result) => {
      if (active) { setData(result); setUsername(result.username); }
    }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);

  async function save(value) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await apiFetch('/auth/profile/retroachievements', {
        method: 'PATCH', body: JSON.stringify({ username: value.trim() }),
      });
      setData(result); setUsername(result.username);
      setMessage(result.username ? 'Public profile saved.' : 'Public profile removed.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const profile = data?.profile;
  return <section className="panel retroachievements-card">
    <div className="profile-section-heading"><div><p>RETROACHIEVEMENTS</p><h2>Retro game achievements</h2></div></div>
    <p className="ra-intro">Display your public RetroAchievements profile here. Earning achievements while playing on this site is not enabled yet.</p>
    <form onSubmit={(event) => { event.preventDefault(); save(username); }}>
      <label htmlFor="ra-username">RetroAchievements username</label>
      <div className="ra-profile-form">
        <input id="ra-username" value={username} maxLength={64} autoComplete="off" placeholder="Your RetroAchievements username" disabled={busy} onChange={(event) => setUsername(event.target.value)} />
        <button type="submit" disabled={busy || !data || !username.trim()}>{busy ? 'Saving…' : 'Save profile'}</button>
        {data?.username ? <button type="button" className="secondary" disabled={busy} onClick={() => save('')}>Remove</button> : null}
      </div>
    </form>
    {data && !data.configured ? <p className="ra-notice">Your username can be saved now. Achievement syncing will become available when the site’s RetroAchievements connection is configured.</p> : null}
    {error || data?.error ? <p role="alert" className="ra-error">{error || data.error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {!data && !error ? <p role="status">Loading RetroAchievements…</p> : null}
    {profile ? <>
      <div className="ra-player">
        <img src={profile.avatar_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
        <div><a href={profile.profile_url} target="_blank" rel="noopener noreferrer">{profile.username}</a><small>Public profile</small></div>
      </div>
      <div className="ra-stats">
        <div><strong>{profile.points.toLocaleString()}</strong><small>Hardcore points</small></div>
        <div><strong>{profile.softcore_points.toLocaleString()}</strong><small>Softcore points</small></div>
      </div>
      <h3>Recent unlocks <small>Past 7 days</small></h3>
      {profile.recent_error ? <p className="ra-notice">{profile.recent_error}</p> : !profile.recent_unlocks.length ? <p className="profile-empty">No unlocks in the past seven days.</p> : <ul className="ra-unlocks">
        {profile.recent_unlocks.map((item) => <li key={item.id}>
          {item.badge_url ? <img src={item.badge_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
          <div><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a><small>{item.game_title}</small><p>{item.description}</p></div>
          <span>{item.points} pts<small>{item.hardcore ? 'Hardcore' : 'Softcore'}</small></span>
        </li>)}
      </ul>}
    </> : null}
    <a className="ra-site-link" href="https://retroachievements.org/" target="_blank" rel="noopener noreferrer">Visit RetroAchievements ↗</a>
  </section>;
}
