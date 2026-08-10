import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';
import LocalGameCard from '../features/localLibrary/components/LocalGameCard';
import { useLocalLibrary } from '../features/localLibrary/hooks/useLocalLibrary';
import { prepareLocalGameLaunch } from '../features/localLibrary/services/localGameLaunchAdapter';
import {
  getPreferredRelease,
  resolveRelease,
  setPreferredRelease,
} from '../features/localLibrary/storage/preferredReleaseStorage';

const LOCAL_PLATFORMS = [
  { id: 'amiga', label: 'Amiga', accept: '.zip,.adf,.adz,.dms,.ipf,.hdf' },
  { id: 'c64', label: 'Commodore 64', accept: '.zip,.d64,.g64,.f64,.t64,.p00,.p01,.tap,.prg,.crt' },
  { id: 'spectrum', label: 'ZX Spectrum', accept: '.zip,.tap,.tzx,.z80,.sna' },
  { id: 'amstrad', label: 'Amstrad CPC', accept: '.zip,.dsk,.cdt' },
];

export default function MyLocalGamesPage() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const { games, progress, error, folderName, scan } = useLocalLibrary();
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('amiga');
  const [status, setStatus] = useState('Choose an Amiga games folder to begin.');
  const [preferenceVersion, setPreferenceVersion] = useState(0);
  const filteredGames = useMemo(() => games.filter((game) => (
    game.title.toLowerCase().includes(search.trim().toLowerCase())
  )), [games, search]);
  const releaseCount = games.reduce((total, game) => total + game.releases.length, 0);

  async function chooseFiles(event) {
    const selected = Array.from(event.target.files || []);
    if (!selected.length) return;
    setStatus(`Scanning ${selected.length} files...`);
    await scan(selected, platform);
    event.target.value = '';
    setStatus('Scan complete. Files remain on this device and are available only for this session.');
  }

  async function play(game) {
    try {
      setStatus(`Starting ${game.title}...`);
      const launch = prepareLocalGameLaunch(game);
      const room = await apiFetch('/rooms/create', {
        method: 'POST',
        body: JSON.stringify({
          system: launch.roomSystem,
          party_max_players: launch.roomSystem === 'arcade' ? 8 : 2,
          arcade_multiplayer: false,
        }),
      });
      const params = new URLSearchParams({ localRelease: launch.launchId, returnTo: '/my-local-games' });
      navigate(`/room/${room.room_code}?${params.toString()}`);
    } catch (launchError) {
      setStatus(`Could not start ${game.title}: ${launchError.message}`);
    }
  }

  function prefer(game, releaseId) {
    setPreferredRelease(game, releaseId);
    setPreferenceVersion((value) => value + 1);
    setStatus(`Preferred version saved for ${game.title}.`);
  }

  return (
    <div className="page local-library-page">
      <div className="local-library-shell">
        <header className="lobby-header local-library-header">
          <BrandMark />
          <div className="account-strip">
            <button type="button" className="secondary" onClick={() => navigate('/library')}>My Library</button>
            <button type="button" className="secondary" onClick={() => navigate('/lobby')}>Lobby</button>
          </div>
        </header>
        <section className="local-library-hero local-amiga-hero">
          <div>
            <p className="lobby-eyebrow">Private, browser-only library</p>
            <h1>My Local Games</h1>
            <p>Select a folder for Amiga, C64, ZX Spectrum, or Amstrad CPC. ZIP files are grouped from filenames and are not opened, changed, or uploaded while scanning.</p>
          </div>
          <div className="local-library-actions">
            <input
              ref={inputRef}
              className="visually-hidden"
              type="file"
              accept={LOCAL_PLATFORMS.find((item) => item.id === platform)?.accept}
              webkitdirectory=""
              multiple
              onChange={chooseFiles}
            />
            <label>
              Platform
              <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                {LOCAL_PLATFORMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => inputRef.current?.click()}>
              {games.length ? 'Change folder / rescan' : `Choose ${LOCAL_PLATFORMS.find((item) => item.id === platform)?.label} folder`}
            </button>
          </div>
        </section>
        <main className="local-amiga-library">
          <div className="local-library-titlebar">
            <div>
              <span>{folderName || 'No folder selected'}</span>
              <h2>{LOCAL_PLATFORMS.find((item) => item.id === platform)?.label} games</h2>
              <span>{games.length} games · {releaseCount} releases</span>
            </div>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search local games"
              aria-label="Search local games"
              disabled={!games.length}
            />
          </div>
          {progress ? (
            <div className="local-scan-progress" role="status">
              <progress value={progress.complete} max={Math.max(progress.total, 1)} />
              <span>Scanning {progress.complete} of {progress.total}: {progress.currentFile}</span>
            </div>
          ) : null}
          {error ? <p className="error">{error}</p> : <p className="local-library-status">{status}</p>}
          {filteredGames.length ? (
            <div className="local-amiga-grid">
              {filteredGames.map((game) => {
                const preferred = getPreferredRelease(game);
                return (
                  <LocalGameCard
                    key={`${game.id}:${preferenceVersion}`}
                    game={game}
                    activeRelease={resolveRelease(game)}
                    preferredId={preferred?.id}
                    onPlay={play}
                    onPrefer={prefer}
                  />
                );
              })}
            </div>
          ) : !progress ? (
            <div className="empty-local-library">
              <strong>{games.length ? 'No games match that search' : 'No local folder selected'}</strong>
              <span>{games.length ? 'Try another title.' : 'Choose a folder containing ZIP or supported media files for the selected platform.'}</span>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
