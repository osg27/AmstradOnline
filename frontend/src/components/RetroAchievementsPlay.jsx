import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';

export default function RetroAchievementsPlay({ frameRef, frameLoadCount, roomCode, solo }) {
  const [connection, setConnection] = useState(null);
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState('Checking your RetroAchievements connection…');
  const [toast, setToast] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [retry, setRetry] = useState(0);
  const toastTimer = useRef(null);

  useEffect(() => {
    const frame = frameRef.current;
    let active = true;
    let ready = false;
    let options;
    let requested = false;
    let loginTimer;
    setSignedIn(false); setToast(null); setSnapshot(null); setConnection(null);
    setStatus('Checking your RetroAchievements connection…');
    const send = (message) => frame?.contentWindow?.postMessage(message, location.origin);
    async function signIn() {
      if (!active || !solo || !ready || !options?.connected || requested) return;
      requested = true;
      setStatus('Connecting to RetroAchievements…');
      try {
        const session = await apiFetch('/auth/retroachievements/play/session', {
          method: 'POST', body: JSON.stringify({ room_code: roomCode }),
        });
        if (!active) return;
        send({ type: 'ra_login_token', ...session });
        loginTimer = setTimeout(() => { if (active) setStatus('RetroAchievements sign-in timed out. Retry, or reconnect in Profile.'); }, 30000);
      } catch (error) { if (active) setStatus(error.message); }
    }
    const configure = () => { send({ type: 'ra_configure', enabled: solo }); send({ type: 'ra_probe' }); };
    async function onMessage(event) {
      if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
      const message = event.data || {};
      if (message.type === 'ra_ready') {
        ready = true; send({ type: 'ra_configure', enabled: solo }); signIn();
      } else if (message.type === 'ra_request') {
        let response;
        try {
          if (!solo || message.url !== 'https://retroachievements.org/dorequest.php') throw new Error('Achievement tracking is available only in solo play.');
          response = await apiFetch('/auth/retroachievements/play/request', {
            method: 'POST', body: JSON.stringify({ room_code: roomCode, post_data: message.postData }),
          });
        } catch (error) { response = { status: 503, body: JSON.stringify({ Success: false, Error: error.message }) }; }
        if (active) send({ type: 'ra_response', id: message.id, ...response });
      } else if (message.type === 'ra_achievements') {
        setSnapshot(message.snapshot);
      } else if (message.type === 'ra_status') {
        const item = message.event;
        if (!item) return;
        if (item.kind === 'login') {
          clearTimeout(loginTimer); setSignedIn(item.result === 0);
          setStatus(item.result === 0 ? `Connected as ${item.title}. Waiting for the game’s achievement set…` : 'RetroAchievements sign-in failed. Reconnect your account in Profile.');
        } else if (item.kind === 'game') {
          setSnapshot(null);
          setStatus(item.result === 0 && item.id ? `${item.title}: ${item.points} achievement${item.points === 1 ? '' : 's'} loaded.` : item.message || 'No matching achievement set was found for this ROM.');
        } else if (item.kind === 'unlock') {
          setToast(item); clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(null), 7000);
          setStatus(`Unlocked: ${item.title} (${item.points} points).`);
        } else if (item.kind === 'logout') {
          clearTimeout(loginTimer); setSignedIn(false); setSnapshot(null);
        } else if (['error', 'pending', 'synced'].includes(item.kind)) {
          clearTimeout(loginTimer); setStatus(item.message);
        }
      }
    }
    apiFetch('/auth/retroachievements/play/options').then((result) => {
      if (!active) return;
      options = result; setConnection(result);
      if (!result.connected) setStatus('Add RetroAchievements in Profile to enable automatic sign-in.');
      signIn();
    }).catch((error) => { if (active) setStatus(error.message); });
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('osg-retroachievements') : null;
    if (channel) channel.onmessage = () => setRetry((value) => value + 1);
    window.addEventListener('message', onMessage);
    frame?.addEventListener('load', configure);
    configure();
    return () => {
      active = false; channel?.close();
      window.removeEventListener('message', onMessage);
      frame?.removeEventListener('load', configure);
      send({ type: 'ra_configure', enabled: false });
      clearTimeout(loginTimer); clearTimeout(toastTimer.current);
    };
  }, [frameRef, frameLoadCount, roomCode, solo, retry]);

  const items = snapshot?.items || [];
  const unlocked = items.filter((item) => item.unlocked).length;
  const disabled = items.filter((item) => item.state === 3).length;
  return <section className="ra-play-panel">
    <div><strong>RetroAchievements</strong><span>Softcore · Mega Drive</span></div>
    {!solo ? <p>Achievement earning is available in solo play. Tracking is stopped while guests can join.</p> : <>
      <p role="status">{status}</p>
      <Link to="/profile">{connection?.connected ? 'Manage RetroAchievements in Profile' : 'Add RetroAchievements in Profile'}</Link>
      {connection?.connected && !signedIn ? <button className="secondary" type="button" onClick={() => setRetry((value) => value + 1)}>Retry connection</button> : null}
      {disabled ? <p className="ra-error" role="alert">{disabled} achievement{disabled === 1 ? '' : 's'} could not be monitored by this emulator. Reload the page to ensure the latest emulator is loaded.</p> : null}
      {items.length ? <details className="ra-game-achievements"><summary>Achievements: {unlocked}/{items.length} unlocked</summary>
        <ul>{items.map((item) => <li key={item.id} className={item.unlocked ? 'earned' : ''}>
          <div><a href={`https://retroachievements.org/achievement/${item.id}`} target="_blank" rel="noopener noreferrer">{item.title}</a><p>{item.description}</p>{item.progress ? <small>{item.progress}</small> : null}</div>
          <span>{item.points} pts<small>{item.unlocked ? 'Unlocked' : item.state === 3 ? 'Unavailable' : 'Locked'}</small></span>
        </li>)}</ul>
      </details> : null}
      <small className="ra-play-note">Your Profile connection signs in automatically. ROM versions must match RetroAchievements’ supported hashes.</small>
    </>}
    {toast ? <div className="ra-unlock-toast" role="status"><strong>Achievement unlocked</strong><b>{toast.title}</b><span>{toast.points} points · Softcore</span></div> : null}
  </section>;
}
