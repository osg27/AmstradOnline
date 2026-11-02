import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { systemStyle } from '../home/systemCapabilities';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The one place to manage where games come from: link PC folders or source URLs per
 * system, rescan or remove folders, open an empty room for a system, download box art.
 * A centred dialog on desktop, a full-height bottom sheet on phones. Scanning and
 * indexing stay in LocalLibraryPage; this only renders and calls back.
 *
 * `suspended` is true while the per-system source dialog is open on top: this panel
 * then ignores Esc and Tab so only the top dialog reacts.
 */
export default function AddGamesPanel({
  systems, counts, folders, sources, sourcesReady, status, scanProgress, mediaProgress, shownCount,
  launchingSystemId, suspended, onClose, onAddFolder, onOpenSources, onOpenRoom,
  onRescanFolder, onRemoveFolder, onDownloadBoxArt,
}) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const openerRef = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  const live = useRef({ suspended, onClose });
  live.current = { suspended, onClose };

  useEffect(() => {
    const opener = openerRef.current;
    const root = document.documentElement;
    root.classList.add('osg-locked');
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event) => {
      if (live.current.suspended) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        live.current.onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll(FOCUSABLE);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      root.classList.remove('osg-locked');
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  const sourceCountFor = (system) => sources.filter((source) => source.system === system.roomSystem).length;
  const folderCountFor = (system) => folders.filter((folder) => folder.system === system.id).length;

  return createPortal(
    <div
      className="osg-lib-scrim"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !suspended) onClose(); }}
    >
      <section
        ref={panelRef}
        className="osg-lib-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="osg-addgames-title"
        aria-hidden={suspended ? 'true' : undefined}
      >
        <header className="osg-lib-panel-head">
          <div>
            <h2 id="osg-addgames-title">Add games</h2>
            <p>Link a folder on this computer or a public source URL for each system. Your game files are never changed.</p>
          </div>
          <button ref={closeRef} type="button" className="osg-lib-panel-close" aria-label="Close" onClick={onClose}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </header>

        <div className="osg-lib-panel-body">
          <section aria-labelledby="osg-addgames-systems">
            <h3 id="osg-addgames-systems">Systems</h3>
            <ul className="osg-lib-sys-list">
              {systems.map((system) => {
                const style = systemStyle(system.id);
                const count = counts[system.id] || 0;
                const linked = folderCountFor(system) + sourceCountFor(system);
                const opening = launchingSystemId === system.id;
                return (
                  <li key={system.id} className="osg-lib-sys" style={{ '--sys': style.color }}>
                    <div className="osg-lib-sys-name">
                      <i aria-hidden="true" />
                      <div>
                        <strong>{style.label}</strong>
                        <small>{count.toLocaleString('en-GB')} game{count === 1 ? '' : 's'}{linked ? ` · ${linked} source${linked === 1 ? '' : 's'}` : ''}</small>
                      </div>
                    </div>
                    <div className="osg-lib-sys-actions">
                      <button type="button" className="secondary" onClick={() => onAddFolder(system.id)} aria-label={`Add ${style.label} folder`}>
                        <i className="bi bi-folder-plus" aria-hidden="true" />Add folder
                      </button>
                      <button type="button" className="secondary" disabled={!sourcesReady} onClick={() => onOpenSources(system)} aria-label={`Manage ${style.label} sources and URLs`}>
                        <i className="bi bi-link-45deg" aria-hidden="true" />Sources
                      </button>
                      <button type="button" className="secondary" disabled={opening} onClick={() => onOpenRoom(system)} aria-label={`Open an empty ${style.label} room`}>
                        <i className="bi bi-door-open" aria-hidden="true" />{opening ? 'Opening…' : 'Open room'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="osg-addgames-folders">
            <h3 id="osg-addgames-folders">Linked folders</h3>
            {folders.length ? (
              <ul className="osg-lib-folders">
                {folders.map((folder) => (
                  <li key={folder.id}>
                    <div>
                      <strong>{folder.name}</strong>
                      <small>
                        {folder.systemLabel || folder.system || 'Library'} · {folder.gameCount || 0} game{folder.gameCount === 1 ? '' : 's'}
                        {folder.sampleCount ? `, ${folder.sampleCount} samples` : ''}
                      </small>
                    </div>
                    {folder.system ? (
                      <div className="osg-lib-folder-actions">
                        {folder.handle ? (
                          <button type="button" className="secondary" onClick={() => onRescanFolder(folder)} aria-label={`Rescan ${folder.name}`}>
                            <i className="bi bi-arrow-clockwise" aria-hidden="true" />Rescan
                          </button>
                        ) : null}
                        <button type="button" className="secondary" onClick={() => onRemoveFolder(folder.id)} aria-label={`Remove ${folder.name}`}>
                          <i className="bi bi-trash3" aria-hidden="true" />Remove
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="osg-lib-muted">No folders linked yet. Use Add folder beside a system, or one mixed folder per system.</p>
            )}
          </section>

          <section aria-labelledby="osg-addgames-art">
            <h3 id="osg-addgames-art">Box art</h3>
            <p className="osg-lib-muted">Fetch missing covers for the {shownCount.toLocaleString('en-GB')} game{shownCount === 1 ? '' : 's'} currently shown. Change the system, search or filters first to download for fewer.</p>
            <button type="button" className="secondary" onClick={onDownloadBoxArt} disabled={!shownCount || Boolean(mediaProgress)}>
              <i className="bi bi-image" aria-hidden="true" />
              {mediaProgress ? `Box art ${mediaProgress.checked}/${mediaProgress.total}` : 'Download box art'}
            </button>
            {mediaProgress ? (
              <div className="media-progress-bar" role="progressbar" aria-label="Box art download progress" aria-valuemin="0" aria-valuemax={mediaProgress.total} aria-valuenow={mediaProgress.checked}>
                <span style={{ width: `${Math.round((mediaProgress.checked / mediaProgress.total) * 100)}%` }} />
              </div>
            ) : null}
          </section>

          {status || scanProgress ? (
            <section aria-labelledby="osg-addgames-status">
              <h3 id="osg-addgames-status">Status</h3>
              {status ? <p className="osg-lib-status-text" role="status">{status}</p> : null}
              {scanProgress ? <p className="osg-lib-muted">Scanned {scanProgress.scanned}, matched {scanProgress.matched}</p> : null}
            </section>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}
