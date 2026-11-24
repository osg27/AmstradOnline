import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { apiFetch } from '../api/client';
import { normaliseFilename } from '../features/localLibrary/core/normalise';
import { startSharedLinkRoom } from '../features/amiga/sharedLinkGames';
import '../features/amiga/link-games.css';

export default function LinkGamesPage() {
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [notes, setNotes] = useState('');
  const isAdmin = localStorage.getItem('isAdmin') === 'true' || localStorage.getItem('isSuperAdmin') === 'true';

  useEffect(() => {
    let cancelled = false;
    apiFetch('/auth/link-games').then((data) => { if (!cancelled) setGames(data.games); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function upload(event) {
    event.preventDefault();
    if (busy || !file || !title.trim()) return;
    const form = event.currentTarget;
    setBusy('upload');
    setError('');
    try {
      const body = new FormData();
      body.append('title', title.trim());
      body.append('notes', notes.trim());
      body.append('file', file);
      const game = await apiFetch('/auth/link-games', { method: 'POST', body });
      setGames((items) => [...items, game].sort((a, b) => a.title.localeCompare(b.title)));
      setTitle(''); setFile(null); setNotes(''); form.reset();
      setUploadOpen(false);
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  }

  async function play(game) {
    if (busy) return;
    setBusy(game.id); setError('');
    try { await startSharedLinkRoom(game.id, navigate); }
    catch (err) { setError(err.message); setBusy(''); }
  }

  async function remove(game) {
    if (busy || !window.confirm(`Remove ${game.title} from the shared Link Games section?`)) return;
    setBusy(game.id); setError('');
    try {
      await apiFetch(`/auth/link-games/${game.id}`, { method: 'DELETE' });
      setGames((items) => items.filter((item) => item.id !== game.id));
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  }

  const shown = games.filter((game) => game.title.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <AppShell>
      <section className="osg-link-games">
        <header className="osg-link-games-head">
          <div><h1>Link Games</h1><p>Shared Amiga ADF games for two linked machines.</p></div>
          {isAdmin ? <button type="button" onClick={() => setUploadOpen((open) => !open)} aria-expanded={uploadOpen}>{uploadOpen ? 'Close upload' : 'Upload ADF'}</button> : null}
        </header>
        <p>Choose a game, host a room and share its code. Both players load the same disk automatically. Your saved A500 Kickstart is used on each machine.</p>
        <p className="osg-link-games-note">Link Play is in testing. Use the game’s computer-link mode; game compatibility varies.</p>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {isAdmin && uploadOpen ? (
          <form className="osg-link-upload" onSubmit={upload}>
            <h2>Add a shared game</h2>
            <label>ADF disk<input type="file" accept=".adf" required disabled={Boolean(busy)} onChange={(event) => {
              const chosen = event.target.files?.[0] || null;
              setFile(chosen);
              if (chosen && !title) setTitle(normaliseFilename(chosen.name).cleanedTitle);
            }} /></label>
            <label>Game title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required disabled={Boolean(busy)} /></label>
            <label>Link instructions or notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} disabled={Boolean(busy)} /></label>
            <small>Upload a standard 880 KB ADF. It will be available to all signed-in players. Kickstart ROMs and WHDLoad archives are not accepted.</small>
            <button type="submit" disabled={Boolean(busy) || !file || !title.trim()}>{busy === 'upload' ? 'Uploading...' : 'Publish game'}</button>
          </form>
        ) : null}
        <label className="osg-link-search">Search Link Games<input type="search" placeholder="Search games" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {loading ? <p role="status">Loading Link Games...</p> : !shown.length ? (
          <div className="osg-link-empty"><h2>{games.length ? 'No matching games' : 'The first link games are coming soon'}</h2><p>{games.length ? 'Try another search.' : isAdmin ? 'Upload an ADF above to make it available to everyone.' : 'An admin will add the shared ADF games here.'}</p></div>
        ) : (
          <div className="osg-link-game-grid">
            {shown.map((game) => (
              <article key={game.id} className="osg-link-game-card">
                <span className="osg-link-disk" aria-hidden="true"><i className="bi bi-floppy" /></span>
                <div><span className="osg-link-format">AMIGA · ADF</span><h2>{game.title}</h2><p className="osg-link-file">{game.file_name}</p></div>
                {game.notes ? <p>{game.notes}</p> : null}
                <button type="button" disabled={Boolean(busy)} onClick={() => play(game)}>{busy === game.id ? 'Opening...' : 'Host Link Play'}</button>
                {isAdmin ? <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => remove(game)}>Remove from section</button> : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
