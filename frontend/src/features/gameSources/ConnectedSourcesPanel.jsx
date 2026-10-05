import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { SOURCE_SYSTEMS, unlinkSourceCatalogue } from './sourceLibrary';
import './connectedSources.css';

export default function ConnectedSourcesPanel({ system, sources, folders, onSave, onAddFolder, onRescanFolder, onUnlinkFolder, onClose }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const controller = useRef(null);
  const dialog = useRef(null);
  const roomSystem = system.roomSystem || system.id;
  const linked = sources.filter((source) => source.system === roomSystem);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => { controller.current?.abort(); previous?.focus?.(); };
  }, []);

  async function link(event, existing) {
    event?.preventDefault();
    setBusy(true); setError(''); setStatus('Scanning file links…');
    const abort = new AbortController(); controller.current = abort;
    try {
      const result = await apiFetch('/auth/library/sources/saved', {
        method: 'POST', body: JSON.stringify({ url: existing?.url || url.trim(), system: roomSystem, refresh: Boolean(existing) }), signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      const source = result.source;
      await onSave([...sources.filter((item) => item.id !== source.id), source]);
      setUrl(''); setStatus(`${source.games.length.toLocaleString()} files linked to ${system.label}. They are now in your game shelf.`);
    } catch (err) { setStatus(''); if (err.name !== 'AbortError') setError(err.message); }
    finally { setBusy(false); }
  }

  async function change(action) {
    setBusy(true); setError('');
    try { await action(); } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <div className="library-version-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialog} tabIndex={-1} className="library-version-dialog platform-source-dialog" role="dialog" aria-modal="true" aria-labelledby="platform-sources-title" onKeyDown={(event) => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key === 'Tab') {
        const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="library-version-dialog-head"><h2 id="platform-sources-title">{system.label} sources</h2><button type="button" disabled={busy} onClick={onClose}>Done</button></div>
      <p>Link folders on your PC or a public source URL. Their games appear together on this system’s shelf and stay linked until you unlink them.</p>
      <button type="button" disabled={busy} onClick={() => change(onAddFolder)}>Add folder on your PC</button>
      {SOURCE_SYSTEMS.has(roomSystem) ? <form className="source-form" onSubmit={link}>
        <label>Source URL<input type="url" required maxLength={4096} value={url} disabled={busy} placeholder="https://…" onChange={(event) => setUrl(event.target.value)} /></label>
        <button type="submit" disabled={busy || !url.trim()}>Link source URL</button>
        <small>URL sources are saved to your account on all devices. PC folders stay on this device. Only the game you choose is downloaded.</small>
      </form> : <p>URL sources are not available for this system yet.</p>}
      <h3>Linked sources</h3>
      {!folders.length && !linked.length ? <p>No sources linked yet.</p> : null}
      <div className="library-folder-list">
        {folders.map((folder) => <div className="library-folder-row" key={folder.id}>
          <div><strong>{folder.name}</strong><small>PC folder · {folder.gameCount || 0} files</small></div>
          <div className="library-folder-actions">
            {folder.handle ? <button type="button" disabled={busy} onClick={() => change(() => onRescanFolder(folder))}>Rescan</button> : null}
            <button type="button" disabled={busy} onClick={() => change(() => onUnlinkFolder(folder.id))}>Unlink</button>
          </div>
        </div>)}
        {linked.map((source) => <div className="library-folder-row" key={source.id}>
          <div><strong className="source-address">{source.url}</strong><small>URL · {source.games.length.toLocaleString()} files</small></div>
          <div className="library-folder-actions">
            <button type="button" disabled={busy} onClick={() => link(null, source)}>Rescan</button>
            <button type="button" disabled={busy} onClick={() => change(async () => { await unlinkSourceCatalogue(source.id); await onSave(sources.filter((item) => item.id !== source.id)); })}>Unlink</button>
          </div>
        </div>)}
      </div>
      {status ? <p role="status">{status}</p> : null}
      {error ? <p role="alert" className="error">{error}</p> : null}
    </section>
  </div>;
}
