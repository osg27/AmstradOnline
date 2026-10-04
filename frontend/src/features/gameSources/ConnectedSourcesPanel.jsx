import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { registerRuntimeRelease } from '../localLibrary/storage/runtimeFileRegistry';
import { downloadSourceGame, loadSourceCatalogues, SOURCE_SYSTEMS, saveSourceCatalogues } from './sourceLibrary';
import './connectedSources.css';

export default function ConnectedSourcesPanel({ systems, username }) {
  const navigate = useNavigate();
  const available = systems.filter((system) => SOURCE_SYSTEMS.has(system.roomSystem || system.id));
  const [sources, setSources] = useState([]);
  const [storageReady, setStorageReady] = useState(false);
  const [page, setPage] = useState(0);
  const [reviewPage, setReviewPage] = useState(0);
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
  useEffect(() => {
    let cancelled = false;
    loadSourceCatalogues(username).then((saved) => {
      if (!cancelled) { setSources(saved); setStorageReady(true); }
    }).catch(() => { if (!cancelled) setError('Could not open catalogue storage. Allow browser storage and reload to try again.'); });
    return () => { cancelled = true; };
  }, [username]);
  useEffect(() => { setPage(0); }, [active, query, sources]);
  useEffect(() => () => controller.current?.abort(), []);
  const visible = sources.filter((source) => available.some((item) => (item.roomSystem || item.id) === source.system));
  const current = visible.find((source) => source.id === active) || visible[0];
  const games = (current?.games || []).filter((game) => `${game.title} ${game.file_name}`.toLowerCase().includes(query.toLowerCase()));

  async function persist(next) {
    if (next.length > 20) throw new Error('Remove an old source before adding more than 20 sources.');
    try {
      await saveSourceCatalogues(username, next);
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
      const result = await apiFetch('/auth/library/sources/scan', {
        method: 'POST', body: JSON.stringify({ url: sourceUrl, system: sourceSystem }), signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      if (!result.games.length) {
        setStatus('No matching game files found. Choose the correct system and use an item or download-listing page. Pages with only buttons, login forms or scripts cannot be scanned yet.');
        return;
      }
      setPreview({ ...result, system: sourceSystem, replacing: source?.id });
      setReviewPage(0);
      setSelected(new Set(result.games.map((game) => game.url)));
      setStatus(`${result.games.length} files found. Review them before saving; no games have been downloaded.`);
    } catch (err) {
      setStatus('');
      if (err.name !== 'AbortError') setError(err.message);
      else setStatus('Scan cancelled.');
    } finally { setBusy(false); }
  }

  async function savePreview() {
    setBusy(true);
    try {
      const id = preview.replacing || crypto.randomUUID();
      const source = {
        id, url: preview.url, system: preview.system,
        label: `${new URL(preview.url).hostname} · ${preview.system.toUpperCase()}`,
        games: preview.games.filter((game) => selected.has(game.url)),
        scannedAt: new Date().toISOString(),
      };
      const next = sources.filter((item) => item.id !== id && !(item.url === source.url && item.system === source.system));
      await persist([...next, source]); setActive(id); setPreview(null); setAdding(false); setQuery('');
      setStatus(`${source.games.length} games saved. Pick one to download and play.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
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
          <p>Add a public game-file page of your choice. Build your shelf once, download when you play.</p></div>
        <button type="button" disabled={busy || !storageReady} onClick={() => { setAdding(!adding); setPreview(null); setError(''); }}> {adding ? 'Close' : 'Add source'}</button>
      </div>
      <small>Catalogues are saved for your account in this browser. No personal cloud sign-in. For files on your device, use the folder controls below.</small>
      {adding ? <form className="source-form" onSubmit={scan}>
        <label>System<select value={system} disabled={busy} onChange={(event) => { setSystem(event.target.value); setPreview(null); }}>
          {available.map((item) => <option key={item.id} value={item.roomSystem || item.id}>{item.label}</option>)}
        </select></label>
        <label>Public source URL<input type="url" required maxLength={4096} placeholder="https://…" value={url} disabled={busy} onChange={(event) => { setUrl(event.target.value); setPreview(null); }} /></label>
        <button type="submit" disabled={busy || !url.trim()}>Scan source</button>
        <small>Scan a directory of individual games, then search or browse the full catalogue. Only the game you choose is downloaded (up to 128 MB per game). CD tracks and private links are not supported yet.</small>
      </form> : null}
      {preview ? <div className="source-preview">
        <h3>Review discovered files</h3>
        <p>System: {available.find((item) => (item.roomSystem || item.id) === preview.system)?.label}. Filenames identify candidates; compatibility is checked when a game loads.</p>
        {preview.truncated ? <p role="status">This listing exceeds the scan safety limit (100,000 games or 300,000 links). Choose a smaller subfolder to include the remaining files.</p> : null}
        <button type="button" className="secondary" onClick={() => setSelected(new Set(preview.games.map((game) => game.url)))}>Select all</button>{' '}
        <button type="button" className="secondary" onClick={() => setSelected(new Set())}>Clear selection</button>
        <div className="source-file-list">{preview.games.slice(reviewPage * 100, (reviewPage + 1) * 100).map((game) => <label key={game.url}>
          <input type="checkbox" checked={selected.has(game.url)} onChange={(event) => setSelected((old) => {
            const next = new Set(old); if (event.target.checked) next.add(game.url); else next.delete(game.url); return next;
          })} /><span>{game.file_name}</span>
        </label>)}</div>
        <SourcePages page={reviewPage} count={preview.games.length} onChange={setReviewPage} />
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
          <button type="button" className="secondary" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await persist(sources.filter((source) => source.id !== current.id)); setPreview(null); setStatus('Source removed from this browser.'); }
            catch (err) { setError(err.message); }
            finally { setBusy(false); }
          }}>Remove source</button>
        </div>
        <small className="source-address">{current?.url}</small>
        <div className="source-game-grid">{games.slice(page * 100, (page + 1) * 100).map((game) => <article key={game.url}>
          <strong>{game.title}</strong><small>{game.file_name}</small>
          <button type="button" disabled={busy} onClick={() => play(game)}>Play</button>
        </article>)}</div>
        <SourcePages page={page} count={games.length} onChange={setPage} />
        {!games.length ? <p>No games match your search.</p> : null}
      </> : !adding ? <p>No sources connected yet.</p> : null}
      {status ? <p role="status" aria-live="polite">{status}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {busy && !opening && !preview ? <button type="button" className="secondary" onClick={() => controller.current?.abort()}>Cancel</button> : null}
    </section>
  );
}

function SourcePages({ page, count, onChange }) {
  if (!count) return null;
  const pages = Math.ceil(count / 100);
  return <nav className="source-toolbar" aria-label="Catalogue pages">
    <button type="button" disabled={page === 0} onClick={() => onChange(page - 1)}>Previous</button>
    <span>{page * 100 + 1}–{Math.min((page + 1) * 100, count)} of {count.toLocaleString()} files</span>
    <button type="button" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>Next</button>
  </nav>;
}
