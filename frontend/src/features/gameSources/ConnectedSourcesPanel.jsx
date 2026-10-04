import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { registerRuntimeRelease } from '../localLibrary/storage/runtimeFileRegistry';
import { downloadSourceGame, readSources, SOURCE_SYSTEMS, writeSources } from './sourceLibrary';
import './connectedSources.css';

export default function ConnectedSourcesPanel({ systems, username }) {
  const navigate = useNavigate();
  const available = systems.filter((system) => SOURCE_SYSTEMS.has(system.roomSystem || system.id));
  const [sources, setSources] = useState(() => readSources(localStorage, username));
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [system, setSystem] = useState(available[0]?.roomSystem || available[0]?.id || 'cpc');
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [active, setActive] = useState('');
  const [query, setQuery] = useState('');
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const visible = sources.filter((source) => available.some((item) => (item.roomSystem || item.id) === source.system));
  const current = visible.find((source) => source.id === active) || visible[0];
  const games = (current?.games || []).filter((game) => `${game.title} ${game.file_name}`.toLowerCase().includes(query.toLowerCase()));

  function persist(next) {
    if (next.length > 20) throw new Error('Remove an old source before adding more than 20 sources.');
    try {
      writeSources(localStorage, username, next);
    } catch {
      throw new Error('Could not save this catalogue. Browser storage may be full or disabled; remove an old source and try again.');
    }
    setSources(next);
  }

  async function scan(event, source = null) {
    event?.preventDefault();
    const sourceUrl = source?.url || url.trim();
    const sourceSystem = source?.system || system;
    setError(''); setStatus('Scanning file links…'); setBusy(true); setPreview(null);
    const abort = new AbortController(); controller.current = abort;
    try {
      const result = await apiFetch('/library/sources/scan', {
        method: 'POST', body: JSON.stringify({ url: sourceUrl, system: sourceSystem }), signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      if (!result.games.length) {
        setStatus('No matching game files found. Choose the correct system and use an item or download-listing page. Pages with only buttons, login forms or scripts cannot be scanned yet.');
        return;
      }
      setPreview({ ...result, system: sourceSystem, replacing: source?.id });
      setSelected(new Set(result.games.map((game) => game.url)));
      setStatus(`${result.games.length} files found. Review them before saving; no games have been downloaded.`);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
      else setStatus('Scan cancelled.');
    } finally { setBusy(false); }
  }

  function savePreview() {
    try {
      const id = preview.replacing || crypto.randomUUID();
      const source = {
        id, url: preview.url, system: preview.system,
        label: `${new URL(preview.url).hostname} · ${preview.system.toUpperCase()}`,
        games: preview.games.filter((game) => selected.has(game.url)),
        scannedAt: new Date().toISOString(),
      };
      const next = sources.filter((item) => item.id !== id && !(item.url === source.url && item.system === source.system));
      persist([...next, source]); setActive(id); setPreview(null); setAdding(false); setQuery('');
      setStatus(`${source.games.length} games saved. Pick one to download and play.`);
    } catch (err) { setError(err.message); }
  }

  async function play(game) {
    setBusy(true); setError(''); setStatus(`Fetching ${game.file_name} from your source…`);
    const abort = new AbortController(); controller.current = abort;
    try {
      const file = await downloadSourceGame(game, current.system, {
        signal: abort.signal,
        onProgress: (loaded, total) => setStatus(`Downloading ${game.file_name}: ${total ? `${Math.round(loaded / total * 100)}%` : `${(loaded / 1048576).toFixed(1)} MB`}`),
      });
      if (abort.signal.aborted) return;
      setStatus('Game ready. Opening your room…');
      setOpening(true);
      // Use the existing file hand-off: no emulator-specific remote loading.
      const room = await apiFetch('/rooms/create', {
        method: 'POST', body: JSON.stringify({ system: current.system, hosting_mode: 'solo', party_max_players: current.system === 'arcade' ? 8 : 2 }),
      });
      const launchId = `source:${crypto.randomUUID()}`;
      registerRuntimeRelease(launchId, { title: game.title, files: [file], roomSystem: current.system });
      const params = new URLSearchParams({ localRelease: launchId, returnTo: '/library' });
      navigate(`/room/${room.room_code}?${params}`);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
      else setStatus('Download cancelled.');
    } finally { setBusy(false); setOpening(false); }
  }

  return (
    <section className="panel connected-sources" aria-label="Connected game sources">
      <div className="source-heading">
        <div><p className="lobby-eyebrow">CONNECT YOUR GAMES</p><h2>Connected sources</h2>
          <p>Add a public game-file page or Internet Archive item. Build your shelf once, download when you play.</p></div>
        <button type="button" disabled={busy} onClick={() => { setAdding(!adding); setPreview(null); setError(''); }}> {adding ? 'Close' : 'Add source'}</button>
      </div>
      <small>Catalogues are saved for your account in this browser. No personal cloud sign-in. For files on your device, use the folder controls below.</small>
      {adding ? <form className="source-form" onSubmit={scan}>
        <label>System<select value={system} disabled={busy} onChange={(event) => { setSystem(event.target.value); setPreview(null); }}>
          {available.map((item) => <option key={item.id} value={item.roomSystem || item.id}>{item.label}</option>)}
        </select></label>
        <label>Public source URL<input type="url" required maxLength={4096} placeholder="https://…" value={url} disabled={busy} onChange={(event) => { setUrl(event.target.value); setPreview(null); }} /></label>
        <button type="submit" disabled={busy || !url.trim()}>Scan source</button>
        <small>One page/item at a time, up to 500 files. Individual games or game ZIPs up to 128 MB; large collections, CD tracks and private links are not supported yet.</small>
      </form> : null}
      {preview ? <div className="source-preview">
        <h3>Review discovered files</h3>
        <p>System: {available.find((item) => (item.roomSystem || item.id) === preview.system)?.label}. Filenames identify candidates; compatibility is checked when a game loads.</p>
        {preview.truncated ? <p role="status">This source is larger than the preview limit. Only the first 500 matching files are shown.</p> : null}
        <button type="button" className="secondary" onClick={() => setSelected(new Set(preview.games.map((game) => game.url)))}>Select all</button>{' '}
        <button type="button" className="secondary" onClick={() => setSelected(new Set())}>Clear selection</button>
        <div className="source-file-list">{preview.games.map((game) => <label key={game.url}>
          <input type="checkbox" checked={selected.has(game.url)} onChange={(event) => setSelected((old) => {
            const next = new Set(old); if (event.target.checked) next.add(game.url); else next.delete(game.url); return next;
          })} /><span>{game.file_name}</span>
        </label>)}</div>
        <button type="button" disabled={busy || !selected.size} onClick={savePreview}>Save {selected.size} games</button>{' '}
        <button type="button" className="secondary" onClick={() => setPreview(null)}>Cancel review</button>
      </div> : null}
      {visible.length ? <>
        <div className="source-toolbar">
          <label>Source<select value={current?.id || ''} disabled={busy} onChange={(event) => { setActive(event.target.value); setQuery(''); setPreview(null); }}>
            {visible.map((source) => <option key={source.id} value={source.id}>{source.label} ({source.games.length})</option>)}
          </select></label>
          <label>Find a game<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search filenames" /></label>
          <button type="button" className="secondary" disabled={busy} onClick={() => scan(null, current)}>Rescan</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => {
            try { persist(sources.filter((source) => source.id !== current.id)); setPreview(null); setStatus('Source removed from this browser.'); }
            catch (err) { setError(err.message); }
          }}>Remove source</button>
        </div>
        <small className="source-address">{current?.url}</small>
        <div className="source-game-grid">{games.slice(0, 100).map((game) => <article key={game.url}>
          <strong>{game.title}</strong><small>{game.file_name}</small>
          <button type="button" disabled={busy} onClick={() => play(game)}>Play</button>
        </article>)}</div>
        {games.length > 100 ? <small>Showing 100 of {games.length} matches. Use search to find a game.</small> : null}
        {!games.length ? <p>No games match your search.</p> : null}
      </> : !adding ? <p>No sources connected yet.</p> : null}
      {status ? <p role="status" aria-live="polite">{status}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {busy && !opening ? <button type="button" className="secondary" onClick={() => controller.current?.abort()}>Cancel</button> : null}
    </section>
  );
}
