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
  const [name, setName] = useState('');
  const [romName, setRomName] = useState('');
  const [durationHours, setDurationHours] = useState(24);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [, setClock] = useState(0);

  const selectedGame = useMemo(
    () => games.find((game) => game.rom_name === romName),
    [games, romName],
  );

  async function loadTournament(code) {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    const details = await apiFetch(`/tournaments/${encodeURIComponent(normalized)}`);
    setTournament(details);
    setJoinCode(normalized);
    if (details.joined) {
      const scores = await apiFetch(`/tournaments/${encodeURIComponent(normalized)}/leaderboard`);
      setLeaderboard(Array.isArray(scores) ? scores : []);
    } else {
      setLeaderboard([]);
    }
  }

  useEffect(() => {
    Promise.all([
      apiFetch('/tournaments/mine'),
      isVip ? apiFetch('/tournaments/games') : Promise.resolve([]),
    ]).then(([myTournaments, availableGames]) => {
      setMine(Array.isArray(myTournaments) ? myTournaments : []);
      setGames(Array.isArray(availableGames) ? availableGames : []);
      if (!romName && availableGames?.[0]?.rom_name) setRomName(availableGames[0].rom_name);
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
    if (!tournament?.joined) return undefined;
    const timer = window.setInterval(() => {
      Promise.all([
        apiFetch(`/tournaments/${encodeURIComponent(tournament.code)}`),
        apiFetch(`/tournaments/${encodeURIComponent(tournament.code)}/leaderboard`),
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
      await apiFetch(`/tournaments/${encodeURIComponent(normalized)}/join`, { method: 'POST' });
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
      const created = await apiFetch('/tournaments', {
        method: 'POST',
        body: JSON.stringify({ name, rom_name: romName, duration_hours: Number(durationHours) }),
      });
      navigate(`/tournaments/${created.code}`);
      setTournament(created);
      setMine((current) => [created, ...current]);
      setName('');
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
      const game = await apiFetch(`/tournaments/${encodeURIComponent(tournament.code)}/game`);
      await prepareTournamentMameFile(tournament.code, game.file_name, ({ loaded, total }) => {
        setProgress({ loaded, total, percent: total ? Math.round((loaded / total) * 100) : 0 });
      });
      sessionStorage.setItem('oldstylegaming:pendingLocalGame', JSON.stringify({
        id: game.id,
        title: game.title,
        fileName: game.file_name,
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

  async function copyInvite() {
    if (!tournament) return;
    const url = `${window.location.origin}/tournaments/${tournament.code}`;
    await navigator.clipboard.writeText(`${tournament.name}: ${url} (code ${tournament.code})`);
    setStatus('Tournament invite copied.');
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
          <p className="eyebrow">MAME COMPETITION</p>
          <h1>Tournaments</h1>
          <p>Play as often as you like before time expires. Only your best verified score counts.</p>
          <form className="tournament-join-form" onSubmit={join}>
            <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="Tournament code" maxLength={12} />
            <button type="submit" disabled={busy || !joinCode.trim()}>Join tournament</button>
          </form>
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
              <div className="tournament-code"><small>CODE</small><strong>{tournament.code}</strong><button type="button" className="secondary" onClick={copyInvite}>Copy invite</button></div>
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
                <h3>{tournament.status === 'completed' ? 'Final standings' : 'Live standings'}</h3>
                {leaderboard.length ? (
                  <ol>
                    {leaderboard.map((entry) => (
                      <li key={entry.username}>
                        <strong>#{entry.rank} {entry.username}</strong>
                        <span>{Number(entry.score).toLocaleString()}</span>
                        <small>{entry.attempts} attempt{entry.attempts === 1 ? '' : 's'}</small>
                      </li>
                    ))}
                  </ol>
                ) : <p>No verified scores yet. Be the first.</p>}
              </div>
            ) : null}
          </section>
        ) : null}

        {isVip ? (
          <section className="panel tournament-create">
            <h2>Create a tournament</h2>
            <p>Only VIPs can create tournaments. Any registered player can enter with the code.</p>
            <form onSubmit={create}>
              <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Friday night high score" minLength={3} maxLength={120} required /></label>
              <label>Game<select value={romName} onChange={(event) => setRomName(event.target.value)}>{gamesLoading ? <option value="">Loading tournament games…</option> : null}{games.map((game) => <option key={game.rom_name} value={game.rom_name}>{game.display_name} ({game.rom_name})</option>)}</select></label>
              <label>Duration<select value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))}><option value={1}>1 hour</option><option value={6}>6 hours</option><option value={12}>12 hours</option><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>1 week</option></select></label>
              <button type="submit" disabled={busy || !name.trim() || !selectedGame}>Create tournament</button>
            </form>
          </section>
        ) : null}

        <section className="panel tournament-list">
          <h2>My tournaments</h2>
          {mine.length ? mine.map((item) => (
            <Link key={item.code} to={`/tournaments/${item.code}`}>
              <strong>{item.name}</strong><span>{item.display_name}</span><small>{item.status} · {item.code}</small>
            </Link>
          )) : <p>You have not joined a tournament yet.</p>}
        </section>
      </main>
    </div>
  );
}
