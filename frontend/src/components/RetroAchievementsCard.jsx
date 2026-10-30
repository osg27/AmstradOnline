import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';

export default function RetroAchievementsCard() {
  const [data, setData] = useState(null);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [connection, setConnection] = useState(null);
  const [adding, setAdding] = useState(false);
  const [connectUsername, setConnectUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    let active = true;
    apiFetch('/auth/profile/retroachievements').then((result) => {
      if (active) { setData(result); setUsername(result.username); }
    }).catch((err) => { if (active) setError(err.message); });
    apiFetch('/auth/profile/retroachievements/connection').then((result) => {
      if (active) { setConnection(result); setConnectUsername(result.username); }
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

  async function connect(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    const credentials = { username: connectUsername.trim(), password };
    setPassword('');
    try {
      const result = await apiFetch('/auth/profile/retroachievements/connection', { method: 'POST', body: JSON.stringify(credentials) });
      setConnection(result); setConnectUsername(result.username); setUsername(result.username); setAdding(false);
      setMessage('RetroAchievements connected. Supported solo games will sign in automatically.');
      const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('osg-retroachievements') : null;
      channel?.postMessage('connection-changed'); channel?.close();
      apiFetch('/auth/profile/retroachievements').then(setData).catch(() => {});
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await apiFetch('/auth/profile/retroachievements/connection', { method: 'DELETE' });
      setConnection(result); setAdding(false); setPassword('');
      setMessage('RetroAchievements disconnected.');
      const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('osg-retroachievements') : null;
      channel?.postMessage('connection-changed'); channel?.close();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const profile = data?.profile;
  return <section className="panel retroachievements-card">
    <div className="profile-section-heading"><div><p>RETROACHIEVEMENTS</p><h2>Retro game achievements</h2></div></div>
    <p className="ra-intro">Connect your RetroAchievements account once. Supported solo Mega Drive and Amstrad CPC games will sign in automatically and earn softcore achievements.</p>
    {connection?.connected ? <div className="ra-connection">
      <p><strong>Connected as {connection.username}</strong><br />Automatic sign-in is enabled.</p>
      <button type="button" className="secondary" disabled={busy} onClick={disconnect}>Disconnect RetroAchievements</button>
    </div> : adding ? <form onSubmit={connect} className="ra-connect-form">
      <label htmlFor="ra-connect-username">RetroAchievements username</label>
      <input id="ra-connect-username" autoComplete="username" value={connectUsername} maxLength={64} disabled={busy} onChange={(event) => setConnectUsername(event.target.value)} required />
      <label htmlFor="ra-connect-password">RetroAchievements password</label>
      <input id="ra-connect-password" type="password" autoComplete="current-password" value={password} maxLength={256} disabled={busy} onChange={(event) => setPassword(event.target.value)} required />
      <div><button type="submit" disabled={busy || !password}>{busy ? 'Connecting...' : 'Connect RetroAchievements'}</button> <button type="button" className="secondary" disabled={busy} onClick={() => { setAdding(false); setPassword(''); }}>Cancel</button></div>
      <small>Your password is used once and is not saved. Your sign-in token is stored encrypted so games can reconnect.</small>
    </form> : <button type="button" disabled={busy || !connection} onClick={() => { setConnectUsername(connection?.username || username); setAdding(true); }}>Add RetroAchievements</button>}
    {connection?.reconnect_required ? <p className="ra-notice">Please reconnect your RetroAchievements account.</p> : null}
    <details className="ra-public-settings"><summary>Public profile settings</summary>
    <form onSubmit={(event) => { event.preventDefault(); save(username); }}>
      <label htmlFor="ra-username">RetroAchievements username</label>
      <div className="ra-profile-form">
        <input id="ra-username" value={username} maxLength={64} autoComplete="off" placeholder="Your RetroAchievements username" disabled={busy} onChange={(event) => setUsername(event.target.value)} />
        <button type="submit" disabled={busy || !data || !username.trim()}>{busy ? 'Saving…' : 'Save profile'}</button>
        {data?.username ? <button type="button" className="secondary" disabled={busy} onClick={() => save('')}>Remove</button> : null}
      </div>
    </form>
    </details>
    {data && !data.configured ? <p className="ra-notice">Public profile statistics are waiting for the site API key. You can still connect your account and earn achievements in supported games.</p> : null}
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
