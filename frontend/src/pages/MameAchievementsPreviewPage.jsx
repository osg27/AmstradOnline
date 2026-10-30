import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createMamePreview } from '../features/retroachievements/mamePreview';

const keys = { ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7, Digit5: 2, Digit1: 3, Enter: 3 };
export default function MameAchievementsPreviewPage() {
  const canvas = useRef(null), preview = useRef(null);
  const [message, setMessage] = useState('Choose your own pacman.zip to begin.'), [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false), [data, setData] = useState(null), [hits, setHits] = useState([]);
  const [controller, setController] = useState('');
  const [softcore, setSoftcore] = useState(false), [confirmed, setConfirmed] = useState([]);
  useEffect(() => () => preview.current?.stop(), []);
  async function start(event) {
    const file = event.target.files?.[0]; if (!file) return;
    preview.current?.stop(); setBusy(true); setData(null); setHits([]); setPaused(false); setController(''); setConfirmed([]);
    const instance = createMamePreview({ canvas: canvas.current, status: setMessage, snapshot: setData,
      hit: event => setHits(previous => previous.some(item => item.id === event.id) ? previous : [...previous, event]),
      submitted: id => setConfirmed(previous => previous.includes(id) ? previous : [...previous, id]),
      controller: setController, softcore });
    preview.current = instance;
    try { await instance.start(file); }
    catch (error) { instance.stop(); setMessage(error.message); setBusy(false); }
  }
  function key(event, down) {
    const bit = keys[event.code]; if (bit === undefined) return;
    event.preventDefault(); preview.current?.input(bit, down);
  }
  return <main style={{ maxWidth: 1000, margin: '2rem auto', padding: '1rem', display: 'block' }}>
    <h1>{softcore ? 'Pac-Man softcore test' : 'Pac-Man achievement preview'}</h1>
    <p>Isolated MAME 2003-Plus experiment. Choose local preview or submit Pac-Man softcore achievements using your saved Profile connection. Hardcore is unavailable on this emulator.</p>
    <p><Link to="/profile">Connect RetroAchievements in Profile</Link> · <Link to="/library?system=arcade">Back to Arcade</Link></p>
    <label style={{ display: 'block', marginBottom: '1rem' }}><input type="checkbox" checked={softcore} disabled={busy}
      onChange={event => { setSoftcore(event.target.checked); setData(null); setHits([]); setConfirmed([]); }} /> Submit Pac-Man softcore achievements to RetroAchievements</label>
    <p>{softcore ? 'A new session will record Pac-Man activity and newly earned softcore unlocks. Previous local preview hits are not submitted.' : 'Local preview: no points, unlocks or played-game activity are submitted.'}</p>
    <label>Pac-Man ROM archive <input type="file" accept=".zip" onChange={start} disabled={busy} /></label>
    <p role="status">{message}</p>
    <p>Click the screen, then use arrows to move, 5 for a coin and 1 or Enter to start.</p>
    <p>Controller: D-pad or left stick to move, Back/Select or B to insert a coin, Start or A to start. Click the screen to enable controls.</p>
    {busy && <p role="status">{controller ? `Controller detected: ${controller}` : 'Press a button on your controller to connect it. Standard browser gamepads are supported.'}</p>}
    <canvas ref={canvas} tabIndex={0} aria-label="Pac-Man preview. Arrow keys or controller move, 5 inserts a coin, 1 starts."
      onKeyDown={event => key(event, true)} onKeyUp={event => key(event, false)} onBlur={() => preview.current?.release()}
      style={{ background: '#000', width: 'min(100%, 448px)', aspectRatio: '224 / 288', imageRendering: 'pixelated', display: 'block' }} />
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '1rem 0' }}>
      {[[2, 'Insert coin'], [3, 'Start']].map(([bit, label]) => <button key={bit} disabled={!busy}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); preview.current?.input(bit, true); }}
        onPointerUp={() => preview.current?.input(bit, false)} onPointerCancel={() => preview.current?.release()}>{label}</button>)}
      <button disabled={!busy} onClick={() => { preview.current?.pause(!paused); setPaused(!paused); }}>{paused ? 'Resume' : 'Pause'}</button>
      <button disabled={!busy} onClick={() => preview.current?.reset()}>Reset</button>
      <button disabled={!busy} onClick={() => { preview.current?.stop(); setBusy(false); setController(''); setMessage('Preview stopped. Choose a file to restart.'); }}>Stop</button>
    </div>
    {hits.some(item => item.points === 0) && <p>Compatibility notice: {hits.filter(item => item.points === 0).map(item => item.title).join(', ')}. This does not count as an achievement.</p>}
    {hits.some(item => item.points > 0) && <p role="status">{softcore ? 'Conditions met this session' : 'Local condition hits (not submitted)'}: {hits.filter(item => item.points > 0).map(item => item.title).join(', ')}</p>}
    {softcore && confirmed.length > 0 && <p role="status">{confirmed.length} softcore unlock{confirmed.length === 1 ? '' : 's'} confirmed by RetroAchievements. <a href="https://retroachievements.org/" target="_blank" rel="noreferrer">Check your RetroAchievements profile</a>.</p>}
    {data && <>
      <p>{data.items.filter(item => item.points > 0).length} achievements · {data.frames} frames checked · {data.failures} unavailable memory reads. Conditions requiring unmapped memory are disabled.</p>
      <ul>{data.items.map(item => <li key={item.id}><strong>{item.title}</strong> — {item.description} ({item.points} points)
        {item.state === 3 ? ' · unavailable memory' : item.unlocked ? item.points === 0 ? ' · compatibility notice' : !softcore ? ' · condition met locally' : confirmed.includes(item.id) ? ' · confirmed on RetroAchievements' : hits.some(hit => hit.id === item.id) ? ' · awaiting server confirmation' : ' · already earned' : item.progress ? ` · ${item.progress}` : ''}</li>)}</ul>
    </>}
  </main>;
}
