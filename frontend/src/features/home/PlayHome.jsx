import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { launchLibraryGame } from '../../pages/LocalLibraryPage';
import GameSheet from './GameSheet';
import StartSystemSheet from './StartSystemSheet';
import LibraryPicks from './LibraryPicks';
import RecentlyPlayed, { LastPlayedHero } from './RecentlyPlayed';
import RoomInvitesBanner from './RoomInvitesBanner';
import TournamentSpotlight from './TournamentSpotlight';
import { systemFamily } from './systemCapabilities';
import {
  boxArtFor,
  buildLaunchGame,
  buildLibraryPicks,
  buildRecentGames,
  readLibraryGameCount,
  screenshotFor,
  useHomeLibrary,
} from './homeLibrary';
import './home.css';

const RECENT_RAIL_SIZE = 5;
let historyCache = null;

function itemFromLibraryGame(game, recent) {
  const played = recent.find((entry) => entry.libraryGame && game.variants?.some((variant) => variant.id === entry.libraryGame.id));
  return {
    key: game.id,
    system: systemFamily(game.system),
    title: game.title,
    libraryGame: game,
    variantCount: game.variantCount || 1,
    boxArt: boxArtFor(game),
    screenshot: screenshotFor(game),
    lastPlayedAt: played?.lastPlayedAt || '',
    totalSeconds: played?.totalSeconds || 0,
  };
}

/** The signed-in Play page: last played + tournament, recent games, a row of library picks. */
export default function PlayHome({ roles }) {
  const navigate = useNavigate();
  const library = useHomeLibrary();
  const [history, setHistory] = useState(() => historyCache || { loaded: false, entries: [] });
  const [sheet, setSheet] = useState(null);
  const [starting, setStarting] = useState(false);
  const [heroError, setHeroError] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch('/auth/profile/recent-games?limit=12')
      .then((entries) => { if (!cancelled) { historyCache = { loaded: true, entries: Array.isArray(entries) ? entries : [] }; setHistory(historyCache); } })
      .catch(() => { if (!cancelled) setHistory({ loaded: true, entries: [] }); });
    return () => { cancelled = true; };
  }, []);

  const recent = useMemo(
    () => buildRecentGames(history.entries, library.games),
    [history.entries, library.games],
  );
  const picks = useMemo(
    () => buildLibraryPicks(library.games, library.favourites),
    [library.games, library.favourites],
  );
  const stackArt = useMemo(() => (
    [...picks.added, ...picks.favourites, ...picks.arcade].map(boxArtFor).filter(Boolean)
      .filter((src, index, list) => list.indexOf(src) === index).slice(0, 3)
  ), [picks]);
  const artForRom = useCallback((romName) => {
    const key = String(romName || '').toLowerCase();
    const match = library.games.find((game) => game.system === 'arcade' && (game.romKey || '').toLowerCase() === key && game.boxArtUrl);
    return boxArtFor(match);
  }, [library.games]);

  const featured = recent[0] || null;
  const rail = recent.slice(1, 1 + RECENT_RAIL_SIZE);
  const ready = history.loaded && !library.loading;

  async function playAgain() {
    if (!featured) return;
    if (!featured.libraryGame) { setSheet({ type: 'game', item: featured }); return; }
    setStarting(true);
    setHeroError('');
    try {
      await launchLibraryGame(buildLaunchGame(library.games, featured.libraryGame), { navigate });
    } catch (err) {
      setHeroError(`Could not start ${featured.title}: ${err.message}`);
      setStarting(false);
    }
  }

  return (
    <div className="osg-home">
      <RoomInvitesBanner />

      <section className="osg-hero-row" aria-label="Pick up where you left off">
        {ready ? (
          <LastPlayedHero
            item={featured}
            starting={starting}
            onPlay={playAgain}
            onMore={() => setSheet({ type: 'game', item: featured })}
            onStartFile={() => setSheet({ type: 'start' })}
            onOpenLibrary={() => navigate('/library')}
          />
        ) : <article className="osg-feature is-loading" aria-busy="true" aria-label="Loading your last game" />}
        <TournamentSpotlight artFor={artForRom} />
      </section>
      {heroError ? <p className="osg-sheet-error osg-hero-error" role="alert">{heroError}</p> : null}

      <RecentlyPlayed items={rail} onOpen={(item) => setSheet({ type: 'game', item })} />

      <LibraryPicks
        loading={library.loading}
        picks={picks}
        totalCount={readLibraryGameCount()}
        stackArt={stackArt}
        onOpen={(game) => setSheet({ type: 'game', item: itemFromLibraryGame(game, recent) })}
        onBrowse={() => navigate('/library')}
        onStartFile={() => setSheet({ type: 'start' })}
      />

      {sheet?.type === 'game' ? <GameSheet item={sheet.item} games={library.games} onClose={() => setSheet(null)} /> : null}
      {sheet?.type === 'start' ? <StartSystemSheet roles={roles} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}
