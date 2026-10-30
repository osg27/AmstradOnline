import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';

export default function RetroAchievementsPlay({ frameRef, frameLoadCount, roomCode, solo }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState('Sign in to earn softcore achievements in this room.');
  const [toast, setToast] = useState(null);
  const loginTimer = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    let active = true;
    apiFetch('/auth/retroachievements/play/options').then((data) => {
      if (active) setUsername((value) => value || data.username);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    setReady(false); setSignedIn(false); setBusy(false); setToast(null);
    setStatus('Sign in to earn softcore achievements in this room.');
    let active = true;
    const send = (message) => frame?.contentWindow?.postMessage(message, location.origin);
    const configure = () => { send({ type: 'ra_configure', enabled: solo }); send({ type: 'ra_probe' }); };
    async function onMessage(event) {
      if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
      const message = event.data || {};
      if (message.type === 'ra_ready') {
        setReady(true);
        send({ type: 'ra_configure', enabled: solo });
      } else if (message.type === 'ra_request') {
        let response;
        try {
          if (!solo || message.url !== 'https://retroachievements.org/dorequest.php') throw new Error('Achievement tracking is available only in solo play.');
          response = await apiFetch('/auth/retroachievements/play/request', {
            method: 'POST', body: JSON.stringify({ room_code: roomCode, post_data: message.postData }),
          });
        } catch (error) {
          response = { status: 503, body: JSON.stringify({ Success: false, Error: error.message }) };
        }
        if (active) send({ type: 'ra_response', id: message.id, ...response });
      } else if (message.type === 'ra_status') {
        const item = message.event;
        if (!item) return;
        if (item.kind === 'login') {
          clearTimeout(loginTimer.current); setBusy(false);
          setSignedIn(item.result === 0);
          setStatus(item.result === 0 ? `Signed in as ${item.title}. Identifying your game…` : item.message || 'RetroAchievements sign-in failed.');
          if (item.result === 0) setUsername(item.title);
        } else if (item.kind === 'game') {
          setStatus(item.result === 0 && item.id ? `${item.title}: ${item.points} achievement${item.points === 1 ? '' : 's'}. Softcore tracking active.` : item.message || 'No matching achievement set was found for this ROM.');
        } else if (item.kind === 'unlock') {
          setToast(item); clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(null), 7000);
          setStatus(`Unlocked: ${item.title} (${item.points} points).`);
        } else if (item.kind === 'logout') {
          clearTimeout(loginTimer.current); setSignedIn(false); setBusy(false); setPassword('');
          setStatus('Sign in to earn softcore achievements in this room.');
        } else if (['error', 'pending', 'synced'].includes(item.kind)) {
          clearTimeout(loginTimer.current); setBusy(false);
          setStatus(item.message);
        }
      }
    }
    window.addEventListener('message', onMessage);
    frame?.addEventListener('load', configure);
    configure();
    return () => {
      active = false;
      window.removeEventListener('message', onMessage);
      frame?.removeEventListener('load', configure);
      send({ type: 'ra_configure', enabled: false });
      clearTimeout(loginTimer.current); clearTimeout(toastTimer.current);
    };
  }, [frameRef, frameLoadCount, roomCode, solo]);

  function login(event) {
    event.preventDefault();
    if (!solo || !ready || busy || !frameRef.current?.contentWindow) return;
    setBusy(true); setStatus('Signing in to RetroAchievements…');
    frameRef.current.contentWindow.postMessage({ type: 'ra_login', username: username.trim(), password }, location.origin);
    setPassword('');
    loginTimer.current = setTimeout(() => { setBusy(false); setStatus('Sign-in timed out. Please try again.'); }, 30000);
  }

  return <section className="ra-play-panel">
    <div><strong>RetroAchievements</strong><span>Softcore · Mega Drive</span></div>
    {!solo ? <p>Achievement earning is available in solo play. Tracking is stopped while guests can join.</p> : <>
      {!signedIn ? <form onSubmit={login}>
        <label>RA username<input autoComplete="username" value={username} maxLength={64} onChange={(event) => setUsername(event.target.value)} disabled={busy} /></label>
        <label>RA password<input type="password" autoComplete="current-password" value={password} maxLength={256} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>
        <button type="submit" disabled={!ready || busy || !username.trim() || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form> : <button className="secondary" type="button" onClick={() => frameRef.current?.contentWindow?.postMessage({ type: 'ra_logout' }, location.origin)}>Sign out</button>}
      <p role="status">{status}</p>
      <small>Sign-in lasts for this room only. Your password is not saved. ROM versions must match RetroAchievements’ supported hashes.</small>
    </>}
    {toast ? <div className="ra-unlock-toast" role="status"><strong>Achievement unlocked</strong><b>{toast.title}</b><span>{toast.points} points · Softcore</span></div> : null}
  </section>;
}
