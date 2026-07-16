import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';
import {
  getLocalLibraryFolders,
  getLocalLibraryGames,
  getLocalLibrarySetting,
  saveLocalLibraryFolders,
  saveLocalLibraryGames,
  saveLocalLibrarySetting,
} from '../localLibraryDb';

export const SUPPORTED_SYSTEMS = [
  {
    id: 'arcade',
    roomSystem: 'arcade',
    label: 'MAME Arcade',
    shortLabel: 'MAME',
    extensions: ['zip', '7z'],
    pathHints: ['mame', 'arcade'],
    note: 'MAME 2003 / 2003-Plus romset',
  },
  {
    id: 'cpc',
    roomSystem: 'cpc',
    label: 'Amstrad CPC',
    shortLabel: 'CPC',
    extensions: ['dsk'],
    pathHints: ['amstrad', 'cpc'],
  },
  {
    id: 'spectrum',
    roomSystem: 'spectrum',
    label: 'ZX Spectrum',
    shortLabel: 'ZX',
    extensions: ['tap', 'tzx', 'z80', 'sna', 'szx'],
    pathHints: ['spectrum', 'zx'],
  },
  {
    id: 'c64',
    roomSystem: 'c64',
    label: 'Commodore 64',
    shortLabel: 'C64',
    extensions: ['d64', 't64', 'tap', 'prg', 'crt'],
    pathHints: ['c64', 'commodore'],
  },
  {
    id: 'atari8',
    roomSystem: 'atari8',
    label: 'Atari 400/800 XL',
    shortLabel: 'A8',
    extensions: ['atr', 'xex', 'car', 'rom', 'cas'],
    pathHints: ['atari 8', 'atari8', '800xl', '400'],
  },
  {
    id: 'nes',
    roomSystem: 'nes',
    label: 'NES',
    shortLabel: 'NES',
    extensions: ['nes'],
    pathHints: ['nes', 'nintendo entertainment'],
  },
  {
    id: 'snes',
    roomSystem: 'snes',
    label: 'SNES',
    shortLabel: 'SNES',
    extensions: ['sfc', 'smc'],
    pathHints: ['snes', 'super nintendo'],
  },
  {
    id: 'mastersystem',
    roomSystem: 'mastersystem',
    label: 'Sega Master System',
    shortLabel: 'SMS',
    extensions: ['sms'],
    pathHints: ['master system', 'mastersystem', 'sms'],
  },
  {
    id: 'megadrive',
    roomSystem: 'megadrive',
    label: 'Mega Drive',
    shortLabel: 'MD',
    extensions: ['bin', 'gen', 'md', 'smd'],
    pathHints: ['mega drive', 'megadrive', 'genesis'],
  },
  {
    id: 'pcengine',
    roomSystem: 'pcengine',
    label: 'PC Engine',
    shortLabel: 'PCE',
    extensions: ['pce', 'sgx'],
    pathHints: ['pc engine', 'pcengine', 'turbografx'],
  },
  {
    id: 'playstation',
    roomSystem: 'playstation',
    label: 'PlayStation',
    shortLabel: 'PS1',
    extensions: ['cue', 'chd', 'pbp', 'iso'],
    pathHints: ['playstation', 'ps1', 'psx'],
  },
  {
    id: 'amiga',
    roomSystem: 'amiga',
    label: 'Amiga',
    shortLabel: 'A500',
    extensions: ['adf'],
    pathHints: ['amiga', 'a500'],
  },
  {
    id: 'atarist',
    roomSystem: 'atarist',
    label: 'Atari ST',
    shortLabel: 'ST',
    extensions: ['st', 'msa', 'stx', 'ipf'],
    pathHints: ['atari st', 'atarist'],
  },
];

const SYSTEM_BY_ID = Object.fromEntries(SUPPORTED_SYSTEMS.map((system) => [system.id, system]));
const EXTENSION_SYSTEMS = SUPPORTED_SYSTEMS.reduce((map, system) => {
  system.extensions.forEach((extension) => {
    if (!map.has(extension)) map.set(extension, []);
    map.get(extension).push(system);
  });
  return map;
}, new Map());

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[\[\(].*?[\]\)]/g, ' ')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleFromFileName(fileName) {
  return slugify(fileName)
    .split(' ')
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function getFileExtension(fileName) {
  const match = /\.([^.]+)$/.exec(fileName.toLowerCase());
  return match ? match[1] : '';
}

function detectSystem(fileName, relativePath) {
  const extension = getFileExtension(fileName);
  const candidates = EXTENSION_SYSTEMS.get(extension) || [];
  const path = relativePath.toLowerCase().replace(/[\\/]+/g, ' ');

  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const hinted = candidates.find((system) => system.pathHints.some((hint) => path.includes(hint)));
  if (hinted) return hinted;

  return candidates[0];
}

function canUseDirectoryPicker() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

async function* walkDirectory(directoryHandle, prefix = '') {
  for await (const [name, handle] of directoryHandle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      yield* walkDirectory(handle, path);
    } else if (handle.kind === 'file') {
      yield { handle, name, path };
    }
  }
}

function buildSystemCounts(games) {
  return games.reduce((counts, game) => {
    counts[game.system] = (counts[game.system] || 0) + 1;
    return counts;
  }, {});
}

export default function LocalLibraryPage({ embedded = false, onboarding = false, onComplete = null }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedSystem = searchParams.get('system');
  const requestedSystemExists = SUPPORTED_SYSTEMS.some((system) => system.id === requestedSystem);
  const username = localStorage.getItem('username');
  const [folders, setFolders] = useState([]);
  const [games, setGames] = useState([]);
  const [selectedSystems, setSelectedSystems] = useState([]);
  const [activeSystem, setActiveSystem] = useState(requestedSystemExists ? requestedSystem : 'all');
  const [query, setQuery] = useState('');
  const [favourites, setFavourites] = useState([]);
  const [status, setStatus] = useState('Loading library...');
  const [scanProgress, setScanProgress] = useState(null);
  const [launchingId, setLaunchingId] = useState(null);

  useEffect(() => {
    async function loadLibrary() {
      try {
        const [savedFolders, savedGames, savedSystems, savedFavourites] = await Promise.all([
          getLocalLibraryFolders(),
          getLocalLibraryGames(),
          getLocalLibrarySetting('selectedSystems', []),
          getLocalLibrarySetting('favourites', []),
        ]);
        setFolders(savedFolders);
        setGames(savedGames);
        setSelectedSystems(savedSystems.length ? savedSystems : SUPPORTED_SYSTEMS.map((system) => system.id));
        setFavourites(savedFavourites);
        setStatus(savedGames.length ? 'Library ready' : 'Choose a ROM folder to build your local library.');
      } catch (err) {
        setStatus(`Could not load local library: ${err.message}`);
      }
    }

    loadLibrary();
  }, []);

  useEffect(() => {
    if (requestedSystemExists) {
      setActiveSystem(requestedSystem);
    }
  }, [requestedSystem, requestedSystemExists]);

  const systemCounts = useMemo(() => buildSystemCounts(games), [games]);
  const visibleSystems = useMemo(() => SUPPORTED_SYSTEMS.filter((system) => selectedSystems.includes(system.id)), [selectedSystems]);
  const favouriteSet = useMemo(() => new Set(favourites), [favourites]);
  const filteredGames = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return games
      .filter((game) => selectedSystems.includes(game.system))
      .filter((game) => activeSystem === 'all' || game.system === activeSystem || (activeSystem === 'favourites' && favouriteSet.has(game.id)))
      .filter((game) => !normalizedQuery || `${game.title} ${game.fileName} ${game.path}`.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [activeSystem, favouriteSet, games, query, selectedSystems]);

  async function toggleSystem(systemId) {
    const next = selectedSystems.includes(systemId)
      ? selectedSystems.filter((id) => id !== systemId)
      : [...selectedSystems, systemId];
    setSelectedSystems(next);
    await saveLocalLibrarySetting('selectedSystems', next);
    if (activeSystem !== 'all' && activeSystem !== 'favourites' && !next.includes(activeSystem)) {
      setActiveSystem('all');
    }
  }

  async function toggleFavourite(gameId) {
    const next = favouriteSet.has(gameId)
      ? favourites.filter((id) => id !== gameId)
      : [...favourites, gameId];
    setFavourites(next);
    await saveLocalLibrarySetting('favourites', next);
  }

  async function finishSetup() {
    await saveLocalLibrarySetting('librarySetupComplete', true);
    if (onComplete) {
      onComplete();
      return;
    }
    navigate('/lobby');
  }

  async function scanFolder(targetSystemId = null) {
    if (!canUseDirectoryPicker()) {
      setStatus('Folder scanning needs Chrome, Edge, or another Chromium browser.');
      return;
    }

    try {
      const targetSystem = targetSystemId ? SYSTEM_BY_ID[targetSystemId] : null;
      const directoryHandle = await window.showDirectoryPicker({ mode: 'read' });
      const folderId = targetSystem ? `system:${targetSystem.id}` : `mixed:${directoryHandle.name}-${Date.now()}`;
      const nextGames = [];
      const sampleHandles = [];
      let scanned = 0;
      setScanProgress({ scanned: 0, matched: 0 });
      setStatus(`Scanning ${directoryHandle.name}${targetSystem ? ` for ${targetSystem.label}` : ''}...`);

      for await (const entry of walkDirectory(directoryHandle)) {
        scanned += 1;
        const extension = getFileExtension(entry.name);
        const pathParts = entry.path.split(/[\\/]+/).map((part) => part.toLowerCase());
        const inSamplesFolder = pathParts.includes('samples');

        if ((targetSystem?.id === 'arcade' || !targetSystem) && inSamplesFolder && ['zip', '7z'].includes(extension)) {
          sampleHandles.push({
            key: entry.name.replace(/\.(zip|7z)$/i, '').toLowerCase(),
            name: entry.name,
            path: entry.path,
            handle: entry.handle,
          });
          continue;
        }

        const system = targetSystem && targetSystem.extensions.includes(extension)
          ? targetSystem
          : targetSystem
            ? null
            : detectSystem(entry.name, entry.path);
        if (system) {
          nextGames.push({
            id: `${folderId}:${entry.path}`,
            folderId,
            folderName: directoryHandle.name,
            folderSystem: targetSystem?.id || 'mixed',
            title: titleFromFileName(entry.name),
            fileName: entry.name,
            path: entry.path,
            extension,
            system: system.id,
            roomSystem: system.roomSystem,
            handle: entry.handle,
            indexedAt: new Date().toISOString(),
          });
        }
        if (scanned % 100 === 0) {
          setScanProgress({ scanned, matched: nextGames.length });
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      }

      const folder = {
        id: folderId,
        name: directoryHandle.name,
        system: targetSystem?.id || 'mixed',
        systemLabel: targetSystem?.label || 'Mixed library',
        handle: directoryHandle,
        scannedAt: new Date().toISOString(),
        gameCount: nextGames.length,
        sampleCount: sampleHandles.length,
        samples: sampleHandles,
      };

      const [storedFolders, storedGames] = await Promise.all([
        getLocalLibraryFolders(),
        getLocalLibraryGames(),
      ]);
      const mergedFolders = [
        ...storedFolders.filter((existingFolder) => existingFolder.id !== folderId),
        folder,
      ].sort((left, right) => (left.systemLabel || left.name).localeCompare(right.systemLabel || right.name));
      const mergedGames = [
        ...storedGames.filter((game) => game.folderId !== folderId),
        ...nextGames,
      ];

      await saveLocalLibraryFolders(mergedFolders);
      await saveLocalLibraryGames(mergedGames);
      setFolders(mergedFolders);
      setGames(mergedGames);
      setScanProgress(null);
      setStatus(`Found ${nextGames.length} ${targetSystem ? targetSystem.label : 'playable'} file${nextGames.length === 1 ? '' : 's'} in ${directoryHandle.name}${sampleHandles.length ? `, plus ${sampleHandles.length} MAME sample zip${sampleHandles.length === 1 ? '' : 's'}` : ''}.`);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setStatus(`Scan failed: ${err.message}`);
      }
      setScanProgress(null);
    }
  }

  async function launchGame(game) {
    setLaunchingId(game.id);
    setStatus(`Starting ${game.title}...`);
    try {
      sessionStorage.setItem('oldstylegaming:pendingLocalGame', JSON.stringify({
        id: game.id,
        title: game.title,
        fileName: game.fileName,
        system: game.system,
        roomSystem: game.roomSystem,
      }));

      const room = await apiFetch('/rooms/create', {
        method: 'POST',
        body: JSON.stringify({
          system: game.roomSystem,
          party_max_players: 2,
        }),
      });
      navigate(`/room/${room.room_code}?mode=solo&localGame=${encodeURIComponent(game.id)}`);
    } catch (err) {
      setStatus(`Could not start ${game.title}: ${err.message}`);
    } finally {
      setLaunchingId(null);
    }
  }

  const content = (
    <div className="local-library-shell">
      {!embedded ? (
      <header className="lobby-header local-library-header">
        <BrandMark />
        <div className="account-strip">
          <span>{username}</span>
          <Link className="button-like secondary" to="/lobby">Lobby</Link>
        </div>
      </header>
      ) : null}

        <section className={`local-library-hero ${onboarding ? 'welcome-library-hero' : ''}`}>
          <div>
            <p className="lobby-eyebrow">{onboarding ? 'Welcome to Old Style Gaming' : 'Your ROMs, your machine'}</p>
            <h1>{onboarding ? 'Set up your game shelves' : 'Local Game Library'}</h1>
            <p>{onboarding ? (games.length ? 'Your browser already has a scanned library. Pick the systems you want on your home page, then continue.' : 'Choose the systems you care about, attach local ROM folders, and your home page will become your own retro dashboard.') : 'Pick a folder once, build a searchable library, and keep the ROMs on your own drive.'}</p>
          </div>
          <div className="local-library-actions">
            <button type="button" onClick={() => scanFolder()}>
              <i className="bi bi-folder2-open" aria-hidden="true" />
              Add mixed ROM folder
            </button>
            <span>{folders.length ? `${folders.length} folder${folders.length === 1 ? '' : 's'} connected` : 'No folders connected yet'}</span>
          </div>
        </section>

        <section className="setup-wizard" aria-label="Setup wizard">
          <div className="setup-step active">
            <span>1</span>
            <strong>Select systems</strong>
            <small>{selectedSystems.length} enabled</small>
          </div>
          <div className={`setup-step ${folders.length ? 'active' : ''}`}>
            <span>2</span>
            <strong>Choose folders</strong>
            <small>{folders.length ? `${folders.length} connected` : 'Waiting'}</small>
          </div>
          <div className={`setup-step ${games.length ? 'active' : ''}`}>
            <span>3</span>
            <strong>Scan library</strong>
            <small>{scanProgress ? `${scanProgress.scanned} scanned` : `${games.length} games`}</small>
          </div>
          <div className={`setup-step ${games.length ? 'active' : ''}`}>
            <span>4</span>
            <strong>Play</strong>
            <small>Solo rooms first</small>
          </div>
        </section>

        {onboarding ? (
          <div className="onboarding-finish-bar">
            <div>
              <strong>{games.length ? `${games.length} local games indexed` : 'Pick your systems first'}</strong>
              <span>{folders.length ? `${folders.length} folder${folders.length === 1 ? '' : 's'} connected` : 'Add folders now, or just choose systems and add folders later from My Library.'}</span>
            </div>
            <button type="button" onClick={finishSetup} disabled={!selectedSystems.length}>
              Continue to home
            </button>
          </div>
        ) : null}

        <main className={`local-library-layout ${onboarding ? 'onboarding-library-layout' : ''}`}>
          <aside className="local-library-sidebar">
            <div className="local-library-panel">
              <h2>Systems</h2>
              <div className="system-picker-list">
                {SUPPORTED_SYSTEMS.map((system) => {
                  const linkedFolder = folders.find((folder) => folder.system === system.id);
                  return (
                    <div key={system.id} className={selectedSystems.includes(system.id) ? 'system-picker-row enabled' : 'system-picker-row'}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedSystems.includes(system.id)}
                          onChange={() => toggleSystem(system.id)}
                        />
                        <span>{system.label}</span>
                        <small>{systemCounts[system.id] || 0}</small>
                      </label>
                      <button type="button" className="secondary" onClick={() => scanFolder(system.id)}>
                        {linkedFolder ? 'Change folder' : 'Add folder'}
                      </button>
                      {linkedFolder ? <em>{linkedFolder.name}</em> : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="local-library-panel library-status-panel">
              <h2>Status</h2>
              <p>{status}</p>
              {scanProgress ? (
                <dl>
                  <div>
                    <dt>Scanned</dt>
                    <dd>{scanProgress.scanned}</dd>
                  </div>
                  <div>
                    <dt>Matched</dt>
                    <dd>{scanProgress.matched}</dd>
                  </div>
                </dl>
              ) : null}
            </div>

            <div className="local-library-panel">
              <h2>Folders</h2>
              {folders.length ? (
                <div className="library-folder-list">
                  {folders.map((folder) => (
                    <div key={folder.id}>
                      <strong>{folder.systemLabel || folder.system || 'Library'}</strong>
                      <span>{folder.name}</span>
                      <small>{folder.gameCount || 0} game{folder.gameCount === 1 ? '' : 's'}{folder.sampleCount ? `, ${folder.sampleCount} samples` : ''}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">Add a folder beside each system, or use one mixed folder.</p>
              )}
            </div>
          </aside>

          {!onboarding ? (
          <section className="local-library-main">
            <div className="local-library-toolbar">
              <div className="library-filter-tabs" aria-label="Library filters">
                <button type="button" className={activeSystem === 'all' ? 'active' : 'secondary'} onClick={() => setActiveSystem('all')}>
                  All
                </button>
                <button type="button" className={activeSystem === 'favourites' ? 'active' : 'secondary'} onClick={() => setActiveSystem('favourites')}>
                  Favourites
                </button>
                {visibleSystems.map((system) => (
                  <button
                    key={system.id}
                    type="button"
                    className={activeSystem === system.id ? 'active' : 'secondary'}
                    onClick={() => setActiveSystem(system.id)}
                  >
                    {system.shortLabel}
                  </button>
                ))}
              </div>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search your games"
              />
            </div>

            <div className="library-summary-strip">
              <strong>{filteredGames.length}</strong>
              <span>shown from {games.length} indexed files</span>
            </div>

            {filteredGames.length ? (
              <div className="local-game-grid">
                {filteredGames.map((game) => {
                  const system = SYSTEM_BY_ID[game.system];
                  const favourite = favouriteSet.has(game.id);
                  return (
                    <article key={game.id} className="local-game-card">
                      <div className="local-game-card-head">
                        <span>{system?.shortLabel || game.system}</span>
                        <button
                          type="button"
                          className={favourite ? 'active icon-button' : 'secondary icon-button'}
                          onClick={() => toggleFavourite(game.id)}
                          title={favourite ? 'Remove favourite' : 'Add favourite'}
                          aria-label={favourite ? `Remove ${game.title} from favourites` : `Add ${game.title} to favourites`}
                        >
                          <i className={favourite ? 'bi bi-star-fill' : 'bi bi-star'} aria-hidden="true" />
                        </button>
                      </div>
                      <h3>{game.title}</h3>
                      <p>{system?.label || 'Unknown system'}</p>
                      <small>{game.path}</small>
                      <button type="button" onClick={() => launchGame(game)} disabled={launchingId === game.id}>
                        {launchingId === game.id ? 'Starting...' : 'Play'}
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-local-library">
                <strong>{games.length ? 'No games match that filter' : 'No local library yet'}</strong>
                <span>{games.length ? 'Try another system or search term.' : 'Use Locate ROM folder to scan a folder you choose.'}</span>
              </div>
            )}
          </section>
          ) : null}
        </main>
    </div>
  );

  if (embedded) return content;

  return (
    <div className="page local-library-page">
      {content}
    </div>
  );
}
