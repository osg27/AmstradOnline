import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import { apiFetch } from '../api/client';
import { prepareTournamentMameFile } from '../vipMameCache';

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '';
}

function remainingText(tournament) {
  if (!tournament) return '';
  const target = tournament.status === 'upcoming' ? tournament.starts_at : tournament.ends_at;
  const milliseconds = new Date(target).getTime() - Date.now();
  if (milliseconds <= 0) return tournament.status === 'completed' ? 'Finished' : 'Updating…';
  const minutes = Math.ceil(milliseconds / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function gameOptionLabel(game) {
  return `${game.display_name} — MAME Arcade [${game.rom_name}]`;
}

function tournamentMedal(rank) {
  return ({ 1: '🥇', 2: '🥈', 3: '🥉' })[rank] || '';
}

export default function TournamentsPage() {
  const { code: routeCode } = useParams();
  const navigate = useNavigate();
  const isVip = localStorage.getItem('isVip') === 'true'
    || localStorage.getItem('isAdmin') === 'true'
    || localStorage.getItem('isSuperAdmin') === 'true';
  const [joinCode, setJoinCode] = useState(routeCode || '');
  const [tournament, setTournament] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [mine, setMine] = useState([]);
  const [games, setGames] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(isVip);
  const [codeCopied, setCodeCopied] = useState(false);
  const [name, setName] = useState('');
  const [romName, setRomName] = useState('');
  const [gameQuery, setGameQuery] = useState('');
  const [durationHours, setDurationHours] = useState(24);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [, setClock] = useState(0);

  const selectedGame = useMemo(
    () => games.find((game) => game.rom_name === romName),
    [games, romName],
  );

  async function loadTournament(code) {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    const details = await apiFetch(`/auth/tournaments/${encodeURIComponent(normalized)}`);
    setTournament(details);
    setJoinCode(normalized);
    if (details.joined) {
      const scores = await apiFetch(`/auth/tournaments/${encodeURIComponent(normalized)}/leaderboard`);
      setLeaderboard(Array.isArray(scores) ? scores : []);
    } else {
      setLeaderboard([]);
    }
  }

  useEffect(() => {
    Promise.all([
      apiFetch('/auth/tournaments/mine'),
      isVip ? apiFetch('/auth/tournaments/games') : Promise.resolve([]),
    ]).then(([myTournaments, availableGames]) => {
      setMine(Array.isArray(myTournaments) ? myTournaments : []);
      setGames(Array.isArray(availableGames) ? availableGames : []);
      if (isVip && !availableGames?.length) setStatus('No score-supported Archive MAME games were found.');
    }).catch((error) => setStatus(`Could not load tournament games: ${error.message}`))
      .finally(() => setGamesLoading(false));
  }, [isVip]);

  useEffect(() => {
    if (!routeCode) return;
    loadTournament(routeCode).catch((error) => setStatus(error.message));
  }, [routeCode]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!createOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !busy) setCreateOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [createOpen, busy]);

  useEffect(() => {
    if (!tournament?.joined) return undefined;
    const timer = window.setInterval(() => {
      Promise.all([
        apiFetch(`/auth/tournaments/${encodeURIComponent(tournament.code)}`),
        apiFetch(`/auth/tournaments/${encodeURIComponent(tournament.code)}/leaderboard`),
      ]).then(([details, scores]) => {
        setTournament(details);
        setLeaderboard(Array.isArray(scores) ? scores : []);
      }).catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, [tournament?.code, tournament?.joined]);

  async function join(event) {
    event.preventDefault();
    const normalized = joinCode.trim().toUpperCase();
    if (!normalized) return;
    setBusy(true);
    setStatus('Joining tournament…');
    try {
      await apiFetch(`/auth/tournaments/${encodeURIComponent(normalized)}/join`, { method: 'POST' });
      navigate(`/tournaments/${normalized}`);
      await loadTournament(normalized);
      setStatus('Tournament joined.');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setStatus('Creating tournament…');
    try {
      const created = await apiFetch('/auth/tournaments', {
        method: 'POST',
        body: JSON.stringify({ name, rom_name: romName, duration_hours: Number(durationHours) }),
      });
      navigate(`/tournaments/${created.code}`);
      setTournament(created);
      setMine((current) => [created, ...current]);
      setName('');
      setRomName('');
      setGameQuery('');
      setCreateOpen(false);
      setStatus(`Tournament created. Share code ${created.code}.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function play() {
    if (!tournament) return;
    setBusy(true);
    setStatus('Preparing tournament game…');
    try {
      const game = await apiFetch(`/auth/tournaments/${encodeURIComponent(tournament.code)}/game`);
      await prepareTournamentMameFile(tournament.code, game.file_name, ({ loaded, total }) => {
        setProgress({ loaded, total, percent: total ? Math.round((loaded / total) * 100) : 0 });
      });
      sessionStorage.setItem('oldstylegaming:pendingLocalGame', JSON.stringify({
        id: game.id,
        title: game.title,
        fileName: game.file_name,
        tournamentHiTemplate: game.hi_template,
        tournamentSaveNamespace: game.save_namespace,
        system: 'arcade',
        roomSystem: 'arcade',
        source: 'tournament-mame',
        tournamentCode: tournament.code,
      }));
      const room = await apiFetch('/rooms/create', {
        method: 'POST',
        body: JSON.stringify({ system: 'arcade', party_max_players: 2 }),
      });
      const params = new URLSearchParams({
        localGame: game.id,
        tournament: tournament.code,
        returnTo: `/tournaments/${tournament.code}`,
        mode: 'solo',
      });
      navigate(`/room/${room.room_code}?${params.toString()}`);
    } catch (error) {
      setStatus(error.message);
      setBusy(false);
      setProgress(null);
    }
  }

  async function copyTournamentCode() {
    if (!tournament) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tournament.code);
      } else {
        const copyField = document.createElement('textarea');
        copyField.value = tournament.code;
        copyField.setAttribute('readonly', '');
        copyField.style.position = 'fixed';
        copyField.style.opacity = '0';
        document.body.appendChild(copyField);
        copyField.select();
        const copied = document.execCommand('copy');
        copyField.remove();
        if (!copied) throw new Error('Clipboard copy was rejected');
      }
      setCodeCopied(true);
      setStatus(`Tournament code ${tournament.code} copied.`);
      window.setTimeout(() => setCodeCopied(false), 1800);
    } catch {
      setCodeCopied(false);
      setStatus(`Could not copy automatically. Tournament code: ${tournament.code}`);
    }
  }

  async function resetStandings() {
    if (!tournament?.is_creator || !window.confirm('Clear every submitted score from this tournament?')) return;
    setBusy(true);
    setStatus('Resetting tournament standings…');
    try {
      await apiFetch(`/auth/tournaments/${encodeURIComponent(tournament.code)}/leaderboard`, { method: 'DELETE' });
      setLeaderboard([]);
      setStatus('Tournament standings reset. Normal game scores were not changed.');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page tournaments-page">
      <header className="lobby-header">
        <BrandMark />
        <div className="header-actions">
          <Link className="button-like secondary" to="/lobby">Lobby</Link>
          <Link className="button-like secondary" to="/library">Library</Link>
        </div>
      </header>

      <main className="tournament-layout">
        <section className="panel tournament-hero">
          <div className="tournament-hero-copy">
            <p className="eyebrow">MAME COMPETITION</p>
            <h1>Tournaments</h1>
            <p>Play as often as you like. Your best verified score before the clock expires is the one that counts.</p>
          </div>
          <div className="tournament-hero-actions">
            <form className="tournament-join-form" onSubmit={join}>
              <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="Enter tournament code" maxLength={12} />
              <button type="submit" disabled={busy || !joinCode.trim()}>Join</button>
            </form>
            {isVip ? <button type="button" onClick={() => setCreateOpen(true)}>Create tournament</button> : null}
          </div>
          {status ? <p className="status-message">{status}</p> : null}
        </section>

        {tournament ? (
          <section className="panel tournament-card tournament-current">
            <div className="tournament-title-row">
              <div>
                <span className={`tournament-state ${tournament.status}`}>{tournament.status}</span>
                <h2>{tournament.name}</h2>
                <p>{tournament.display_name}</p>
              </div>
              <div className="tournament-code"><small>CODE</small><strong>{tournament.code}</strong><button type="button" className="secondary" onClick={copyTournamentCode}>{codeCopied ? 'Copied' : 'Copy code'}</button></div>
            </div>
            <div className="tournament-facts">
              <span>Starts: {formatDate(tournament.starts_at)}</span>
              <span>Ends: {formatDate(tournament.ends_at)}</span>
              <span>{tournament.status === 'active' ? 'Time left' : 'Countdown'}: {remainingText(tournament)}</span>
              <span>{tournament.entry_count} entrant{tournament.entry_count === 1 ? '' : 's'}</span>
            </div>
            {!tournament.joined ? (
              <button type="button" onClick={join} disabled={busy}>Enter tournament</button>
            ) : tournament.status === 'active' ? (
              <button type="button" onClick={play} disabled={busy}>{busy ? `Preparing${progress ? ` ${progress.percent}%` : '…'}` : 'Play now'}</button>
            ) : null}

            {tournament.joined ? (
              <div className="tournament-scoreboard">
                <div className="tournament-scoreboard-heading">
                  <h3>{tournament.status === 'completed' ? 'Final standings' : 'Live standings'}</h3>
                  {tournament.is_creator ? <button className="secondary" type="button" disabled={busy || !leaderboard.length} onClick={resetStandings}>Reset standings</button> : null}
                </div>
                {leaderboard.length ? (
                  <ol>
                    {leaderboard.map((entry) => (
                      <li key={entry.username}>
                        <strong>
                          {tournamentMedal(entry.rank) ? (
                            <span className="tournament-medal" role="img" aria-label={`${entry.rank === 1 ? 'Gold' : entry.rank === 2 ? 'Silver' : 'Bronze'} medal`}>
                              {tournamentMedal(entry.rank)}
                            </span>
                          ) : `#${entry.rank}`}
                          {' '}{entry.username}
                        </strong>
                        <span>{Number(entry.score).toLocaleString()}</span>
                      </li>
                    ))}
                  </ol>
                ) : <p>No verified scores yet. Be the first.</p>}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className={`panel tournament-list${tournament ? '' : ' tournament-list-wide'}`}>
          <div className="tournament-list-heading">
            <div><p className="eyebrow">YOUR COMPETITIONS</p><h2>My tournaments</h2></div>
            {isVip ? <button type="button" className="secondary" onClick={() => setCreateOpen(true)}>Create new</button> : null}
          </div>
          {mine.length ? <div className="tournament-list-grid">{mine.map((item) => (
            <Link key={item.code} to={`/tournaments/${item.code}`}>
              <span className={`tournament-state ${item.status}`}>{item.status}</span>
              <strong>{item.name}</strong>
              <span className="tournament-list-game">{item.display_name}</span>
              <small>{item.code}</small>
            </Link>
          ))}</div> : <div className="tournament-empty"><strong>No tournaments yet</strong><p>Enter a code above to join one{isVip ? ', or create your own.' : '.'}</p></div>}
        </section>
      </main>

      {isVip && createOpen ? (
        <div className="tournament-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCreateOpen(false); }}>
          <section className="tournament-modal" role="dialog" aria-modal="true" aria-labelledby="create-tournament-title">
            <div className="tournament-modal-heading">
              <div><p className="eyebrow">NEW COMPETITION</p><h2 id="create-tournament-title">Create a tournament</h2></div>
              <button type="button" className="secondary tournament-modal-close" aria-label="Close" disabled={busy} onClick={() => setCreateOpen(false)}>×</button>
            </div>
            <p>Choose a game and time limit. Any registered player can enter using the tournament code.</p>
            <form className="tournament-create-form" onSubmit={create}>
              <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Friday night high score" minLength={3} maxLength={120} required /></label>
              <label>
                Game
                <input
                  type="search"
                  list="tournament-mame-games"
                  value={gameQuery}
                  onChange={(event) => {
                    const value = event.target.value;
                    const normalized = value.trim().toLowerCase();
                    const match = games.find((game) => gameOptionLabel(game).toLowerCase() === normalized || game.rom_name.toLowerCase() === normalized);
                    setGameQuery(value);
                    setRomName(match?.rom_name || '');
                  }}
                  placeholder={gamesLoading ? 'Loading MAME Arcade games…' : 'Type a game name or ROM name'}
                  autoComplete="off"
                  required
                />
                <datalist id="tournament-mame-games">
                  {games.map((game) => <option key={game.rom_name} value={gameOptionLabel(game)} />)}
                </datalist>
                <small>{selectedGame ? `Selected system: MAME Arcade · ROM: ${selectedGame.rom_name}` : 'Choose a MAME Arcade game from the search results.'}</small>
              </label>
              <label>Duration<select value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))}><option value={1}>1 hour</option><option value={6}>6 hours</option><option value={12}>12 hours</option><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>1 week</option></select></label>
              <div className="tournament-modal-actions">
                <button type="button" className="secondary" disabled={busy} onClick={() => setCreateOpen(false)}>Cancel</button>
                <button type="submit" disabled={busy || !name.trim() || !selectedGame}>{busy ? 'Creating…' : 'Create tournament'}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
