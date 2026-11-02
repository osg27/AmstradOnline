import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { getLocalLibraryGames } from '../../localLibraryDb';
import { getMameDisplayName } from '../../data/mameTitleLookup';
import { formatPlayedAgo, isRecentScoreLive } from './homeFormat';

function recentScoreGameName(entry) {
  if (entry?.system !== 'arcade') return entry?.game_name || entry?.game_key || 'Unknown game';
  return getMameDisplayName(entry.game_key || entry.rom_name, entry.game_name);
}

function entryRomKey(entry) {
  return String(entry?.game_key || entry?.rom_name || '').replace(/\.(zip|7z)$/i, '').toLowerCase();
}

/** Site-wide recent arcade/Amiga scores (moved from the old lobby side rail to Compete). */
export default function RecentArcadeScores() {
  const navigate = useNavigate();
  const [scores, setScores] = useState([]);
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const next = await apiFetch('/scores/recent?limit=10');
        if (active) setScores(Array.isArray(next) ? next : []);
      } catch {
        if (active) setScores([]);
      }
    }
    load();
    const timer = window.setInterval(load, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  // Unchanged from the old lobby: open the scored game from the local library in a solo room.
  async function openGame(entry) {
    const entrySystem = entry?.system === 'amiga' ? 'amiga' : 'arcade';
    const romKey = entryRomKey(entry);
    if (!romKey || opening) return;
    setError('');
    setOpening(romKey);
    try {
      const games = await getLocalLibraryGames().catch(() => []);
      const systemGames = games.filter((game) => entrySystem === 'amiga'
        ? game.system === 'amiga' || game.system === 'amiga_aga'
        : game.system === 'arcade');
      const valueMatches = (value) => {
        const normalised = String(value || '').replace(/\.(zip|7z)$/i, '').toLowerCase();
        return entrySystem === 'amiga'
          ? normalised.includes(romKey.replace(/-/g, '')) || normalised.replace(/[^a-z0-9]/g, '').includes(romKey.replace(/[^a-z0-9]/g, ''))
          : normalised === romKey;
      };
      // An exact ROM archive must win over a parent/clone fallback.
      const matchingGame = systemGames.find((game) => (
        [game.romKey, game.fileName].some(valueMatches)
      )) || systemGames.find((game) => (
        [game.parentRomKey, game.title].some(valueMatches)
      ));
      const canUseMatchedGame = matchingGame?.handle || matchingGame?.runtimeFileKey;
      const pendingGame = canUseMatchedGame ? matchingGame : {
        id: `recent-${entrySystem}:${romKey}`,
        title: entry.game_name || romKey,
        fileName: entrySystem === 'amiga' ? '' : `${romKey}.zip`,
        system: entrySystem,
        roomSystem: entrySystem === 'amiga' ? 'amiga_aga' : 'arcade',
        source: `recent-${entrySystem}-score`,
      };
      sessionStorage.setItem('oldstylegaming:pendingLocalGame', JSON.stringify({
        id: pendingGame.id,
        title: pendingGame.title,
        fileName: pendingGame.fileName || (entrySystem === 'arcade' ? `${romKey}.zip` : ''),
        system: pendingGame.system || entrySystem,
        roomSystem: pendingGame.roomSystem || (entrySystem === 'amiga' ? 'amiga_aga' : 'arcade'),
        source: pendingGame.source || 'local',
        archiveSampleFileName: pendingGame.archiveSampleFileName || '',
      }));
      const room = await apiFetch('/rooms/create', {
        method: 'POST',
        body: JSON.stringify({ system: pendingGame.roomSystem || (entrySystem === 'amiga' ? 'amiga_aga' : 'arcade'), hosting_mode: 'solo', party_max_players: 8, arcade_multiplayer: false }),
      });
      const params = new URLSearchParams({ localGame: pendingGame.id, returnTo: '/', mode: 'solo' });
      navigate(`/room/${room.room_code}?${params.toString()}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setOpening('');
    }
  }

  const live = scores.length > 0 && isRecentScoreLive(scores[0]?.created_at);

  return (
    <section className="panel recent-arcade-scores osg-recent-scores" aria-labelledby="osg-recent-scores-title">
      <div className="recent-arcade-heading">
        <div>
          <span>At the arcade</span>
          <h2 id="osg-recent-scores-title">Recent scores</h2>
        </div>
        {live ? <span className="recent-live-badge">Live</span> : null}
      </div>
      {scores.length ? (
        <ol className="recent-arcade-list">
          {scores.map((entry) => (
            <li key={`${entry.username}-${entry.system}-${entry.game_key || entry.rom_name}-${entry.created_at}`}>
              <span className="recent-score-player">{entry.username}</span>
              <strong>{Number(entry.score || 0).toLocaleString()}</strong>
              <button
                className="recent-score-game"
                type="button"
                disabled={Boolean(opening)}
                title={`Play ${recentScoreGameName(entry)}`}
                onClick={() => openGame(entry)}
              >
                {opening === entryRomKey(entry) ? 'Opening...' : recentScoreGameName(entry)}
              </button>
              <span className={`recent-score-system recent-score-system-${entry.system}`}>{entry.system_name}</span>
              <time dateTime={entry.created_at}>{formatPlayedAgo(entry.created_at)}</time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="recent-arcade-empty">No Arcade scores yet. Be the first to put your name on a cabinet.</p>
      )}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
