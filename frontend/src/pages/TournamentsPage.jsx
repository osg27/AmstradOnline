import { SUPPORTER_UI_ENABLED } from '../config/supporterUi';
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import RecentArcadeScores from '../features/home/RecentArcadeScores';
import SupporterLockModal from '../components/SupporterLockModal';
import useEntitlement from '../hooks/useEntitlement';
import { apiFetch } from '../api/client';
import { getLocalLibraryGames, readLocalLibraryFile } from '../localLibraryDb';
import { prepareTournamentMameFile } from '../vipMameCache';
import '../features/home/home.css';
import '../features/compete/compete.css';
import {
  Countdown, Empty, PastRow, Section, StatePill, TournamentCard, useBuckets, useRomArt,
} from '../features/compete/CompeteParts';

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

function tournamentRomKey(value) {
  return String(value || '').split(/[\\/]/).pop().replace(/\.(?:zip|7z)$/i, '').toLowerCase();
}

async function readTournamentLibraryFile(game) {
  if (game?.handle?.queryPermission && game.handle.requestPermission) {
    let permission = await game.handle.queryPermission({ mode: 'read' });
    if (permission !== 'granted') permission = await game.handle.requestPermission({ mode: 'read' });
    if (permission !== 'granted') throw new Error('Allow access to the connected MAME folder to create this tournament.');
  }
  return readLocalLibraryFile(game);
}

export default function TournamentsPage() {
  const { code: routeCode } = useParams();
  const navigate = useNavigate();
  const canCreateTournaments = useEntitlement('create_tournaments');
  const [joinCode, setJoinCode] = useState(routeCode || '');
  const [tournament, setTournament] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [mine, setMine] = useState([]);
  const [publicTournaments, setPublicTournaments] = useState([]);
  const [games, setGames] = useState([]);
  const [libraryGames, setLibraryGames] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(canCreateTournaments);
  const [codeCopied, setCodeCopied] = useState(false);
  const [name, setName] = useState('');
  const [romName, setRomName] = useState('');
  const [gameQuery, setGameQuery] = useState('');
  const [durationHours, setDurationHours] = useState(24);
  const [isPublic, setIsPublic] = useState(true);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [supporterLock, setSupporterLock] = useState('');
  const [, setClock] = useState(0);
  const artFor = useRomArt();
  const buckets = useBuckets(mine, publicTournaments);
  const myUsername = localStorage.getItem('username') || '';

  const selectedGame = useMemo(
    () => games.find((game) => game.rom_name === romName),
    [games, romName],
  );
  const selectedLibraryGame = useMemo(
    () => libraryGames.find((game) => tournamentRomKey(game.fileName || game.path) === romName),
    [libraryGames, romName],
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
      apiFetch('/auth/tournaments/public'),
      canCreateTournaments ? apiFetch('/auth/tournaments/games') : Promise.resolve([]),
      canCreateTournaments ? getLocalLibraryGames() : Promise.resolve([]),
    ]).then(([myTournaments, visibleTournaments, availableGames, localGames]) => {
      setMine(Array.isArray(myTournaments) ? myTournaments : []);
      setPublicTournaments(Array.isArray(visibleTournaments) ? visibleTournaments : []);
      const localMameGames = (Array.isArray(localGames) ? localGames : [])
        .filter((game) => game.system === 'arcade' && /\.zip$/i.test(game.fileName || game.path || ''));
      const localRomNames = new Set(localMameGames.map((game) => tournamentRomKey(game.fileName || game.path)));
      const tournamentGames = (Array.isArray(availableGames) ? availableGames : [])
        .filter((game) => localRomNames.has(game.rom_name));
      setLibraryGames(localMameGames);
      setGames(tournamentGames);
      if (canCreateTournaments && !tournamentGames.length) {
        setStatus('No tournament-ready games were found in your connected MAME library.');
      }
    }).catch((error) => setStatus(`Could not load tournament games: ${error.message}`))
      .finally(() => setGamesLoading(false));
  }, [canCreateTournaments]);

  useEffect(() => {
    if (!routeCode) return;
    loadTournament(routeCode).catch((error) => setStatus(error.message));
  }, [routeCode]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 1000);
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
    setStatus('Reading the tournament ROM from your MAME library…');
    try {
      if (!selectedLibraryGame) throw new Error(`Add ${selectedGame?.file_name || 'the selected ROM'} to your connected MAME library first.`);
      const tournamentRom = await readTournamentLibraryFile(selectedLibraryGame);
      setStatus('Creating tournament…');
      const form = new FormData();
      form.append('name', name);
      form.append('rom_name', romName);
      form.append('duration_hours', String(Number(durationHours)));
      form.append('is_public', String(isPublic));
      form.append('rom_file', tournamentRom, selectedGame.file_name);
      const created = await apiFetch('/auth/tournaments', {
        method: 'POST',
        body: form,
      });
      navigate(`/tournaments/${created.code}`);
      setTournament(created);
      setMine((current) => [created, ...current]);
      if (created.is_public) setPublicTournaments((current) => [created, ...current]);
      setName('');
      setRomName('');
      setGameQuery('');
      setIsPublic(true);
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
        tournamentName: tournament.name,
      }));
      const room = await apiFetch('/rooms/create', {
        method: 'POST',
        body: JSON.stringify({ system: 'arcade', hosting_mode: 'solo', party_max_players: 8 }),
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
    if (!tournament?.can_delete || !window.confirm('Clear every submitted score from this tournament?')) return;
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

  async function deleteTournament(item) {
    if (!item?.can_delete) return;
    if (!window.confirm(`Permanently delete "${item.name}"? Its entries, scores and profile medals will also be removed.`)) return;
    setBusy(true);
    setStatus(`Deleting ${item.name}â€¦`);
    try {
      await apiFetch(`/auth/tournaments/${encodeURIComponent(item.code)}`, { method: 'DELETE' });
      setMine((current) => current.filter((entry) => entry.code !== item.code));
      setPublicTournaments((current) => current.filter((entry) => entry.code !== item.code));
      if (tournament?.code === item.code) {
        setTournament(null);
        setLeaderboard([]);
        setJoinCode('');
        navigate('/tournaments', { replace: true });
      }
      setStatus(`Tournament "${item.name}" deleted. Its medals have been removed from player profiles.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell className="osg-legacy-page">
    <div className="page tournaments-page cmp-page">

      <header className="cmp-head">
        <div>
          <span className="osg-eyebrow">Compete</span>
          <h1>Tournaments</h1>
          <p>Play as often as you like. Your best verified score before the clock expires is the one that counts.</p>
        </div>
        <div className="cmp-head-actions">
          <form className="cmp-join" onSubmit={join}>
            <label htmlFor="cmp-join-code" className="cmp-visually-hidden">Tournament code</label>
            <input id="cmp-join-code" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="Join with a code" maxLength={12} autoComplete="off" />
            <button type="submit" className="secondary" disabled={busy || !joinCode.trim()}>Join</button>
          </form>
          {SUPPORTER_UI_ENABLED || canCreateTournaments ? (<button type="button" onClick={() => canCreateTournaments ? setCreateOpen(true) : setSupporterLock('Creating tournaments')}>
            {canCreateTournaments ? 'Create tournament' : '🔒 Create tournament'}
          </button>) : null}
        </div>
        {status ? <p className="status-message cmp-status" role="status">{status}</p> : null}
      </header>

      <main className="cmp-main">
        {tournament ? (
          <section className={`cmp-detail${tournament.status === 'active' ? ' is-live' : ''}`} aria-labelledby="cmp-detail-title">
            <div className="cmp-detail-top">
              <div className="cmp-detail-title">
                <StatePill status={tournament.status} />
                <h2 id="cmp-detail-title">{tournament.name}</h2>
                <p>{tournament.display_name} · {tournament.is_public ? 'Public' : 'Private'}</p>
              </div>
              <div className="tournament-code cmp-code"><small>CODE</small><strong>{tournament.code}</strong><button type="button" className="secondary" onClick={copyTournamentCode}>{codeCopied ? 'Copied' : 'Copy code'}</button></div>
            </div>
            {tournament.status !== 'completed' ? (
              <Countdown
                target={tournament.status === 'active' ? tournament.ends_at : tournament.starts_at}
                label={tournament.status === 'active' ? 'Time left' : 'Starts in'}
              />
            ) : null}
            <div className="cmp-facts">
              <span>Starts <b>{formatDate(tournament.starts_at)}</b></span>
              <span>Ends <b>{formatDate(tournament.ends_at)}</b></span>
              <span>{tournament.status === 'active' ? 'Time left' : tournament.status === 'upcoming' ? 'Countdown' : 'Status'} <b>{remainingText(tournament)}</b></span>
              <span><b>{tournament.entry_count}</b> entrant{tournament.entry_count === 1 ? '' : 's'}</span>
            </div>
            {!tournament.joined ? (
              <button type="button" className="cmp-main-action" onClick={join} disabled={busy}>Enter tournament</button>
            ) : tournament.status === 'active' ? (
              <button type="button" className="cmp-main-action" onClick={play} disabled={busy}>{busy ? `Preparing${progress ? ` ${progress.percent}%` : '…'}` : 'Play now'}</button>
            ) : null}

            {tournament.joined ? (
              <div className="cmp-board-wrap">
                <div className="cmp-board-head">
                  <h3>{tournament.status === 'completed' ? 'Final standings' : 'Live standings'}</h3>
                  <div className="tournament-manage-actions">
                    {tournament.can_delete ? <button className="secondary" type="button" disabled={busy || !leaderboard.length} onClick={resetStandings}>Reset standings</button> : null}
                    {tournament.can_delete ? <button className="danger" type="button" disabled={busy} onClick={() => deleteTournament(tournament)}>Delete tournament</button> : null}
                  </div>
                </div>
                {leaderboard.length ? (
                  <ol className="osg-board cmp-board">
                    {leaderboard.map((entry) => (
                      <li key={entry.username} className={`${entry.rank <= 3 ? `top top-${entry.rank}` : ''}${entry.username === myUsername ? ' you' : ''}`}>
                        <span className="rk" aria-label={`Rank ${entry.rank}${entry.rank === 1 ? ', gold' : entry.rank === 2 ? ', silver' : entry.rank === 3 ? ', bronze' : ''}`}>{entry.rank}</span>
                        <span className="nm">{entry.username}{entry.username === myUsername ? ' (you)' : ''}</span>
                        <span className="sc">{Number(entry.score).toLocaleString()}</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="cmp-note">No verified scores yet. Be the first.</p>}
              </div>
            ) : null}
          </section>
        ) : null}

        <Section id="cmp-live" title="Live now" hint="Open to enter, best score counts.">
          {buckets.live.length ? (
            <div className="cmp-grid">{buckets.live.map((item) => <TournamentCard key={item.code} item={item} art={artFor(item.rom_name)} remaining={remainingText(item)} />)}</div>
          ) : <Empty title="No live tournament right now">When a tournament opens it shows up here with its countdown.</Empty>}
        </Section>

        <Section id="cmp-upcoming" title="Upcoming">
          {buckets.upcoming.length ? (
            <div className="cmp-grid">{buckets.upcoming.map((item) => <TournamentCard key={item.code} item={item} art={artFor(item.rom_name)} remaining={remainingText(item)} />)}</div>
          ) : <Empty title="Nothing scheduled">Upcoming competitions will appear here automatically.</Empty>}
        </Section>

        <Section
          id="cmp-mine"
          title="My tournaments"
          action={SUPPORTER_UI_ENABLED || canCreateTournaments ? (<button type="button" className="secondary" onClick={() => canCreateTournaments ? setCreateOpen(true) : setSupporterLock('Creating tournaments')}>Create new</button>) : null}
        >
          {mine.length ? <ul className="cmp-mine-list">{mine.map((item) => (
            <li key={item.code}>
              <Link to={`/tournaments/${item.code}`}>
                <StatePill status={item.status} />
                <strong>{item.name}</strong>
                <span className="cmp-mine-game">{item.display_name}</span>
                <small>{item.code}</small>
              </Link>
              {item.can_delete ? <button type="button" className="danger tournament-list-delete" disabled={busy} onClick={() => deleteTournament(item)} aria-label={`Delete ${item.name}`} title="Delete tournament"><i className="bi bi-trash3" aria-hidden="true" /></button> : null}
            </li>
          ))}</ul> : <Empty title="No tournaments yet">Join with a code above{canCreateTournaments ? ', or create your own.' : '.'}</Empty>}
        </Section>

        <Section id="cmp-past" title="Past">
          {buckets.past.length ? <ul className="cmp-past">{buckets.past.map((item) => <PastRow key={item.code} item={item} />)}</ul>
            : <Empty title="No finished tournaments yet">Results will be listed here once a competition ends.</Empty>}
        </Section>

        <div className="cmp-scores osg-scores-slot">
          <RecentArcadeScores />
        </div>
      </main>

      <SupporterLockModal feature={supporterLock} onClose={() => setSupporterLock('')} />
      {canCreateTournaments && createOpen ? (
        <div className="tournament-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCreateOpen(false); }}>
          <section className="tournament-modal" role="dialog" aria-modal="true" aria-labelledby="create-tournament-title">
            <div className="tournament-modal-heading">
              <div><p className="eyebrow">NEW COMPETITION</p><h2 id="create-tournament-title">Create a tournament</h2></div>
              <button type="button" className="secondary tournament-modal-close" aria-label="Close" disabled={busy} onClick={() => setCreateOpen(false)}>×</button>
            </div>
            <p>Choose a game and time limit. Public tournaments are listed for everyone; private tournaments require the code.</p>
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
                <small>{selectedGame ? `Selected from your MAME library: ${selectedGame.file_name}` : 'Choose a tournament-ready game from your connected MAME library.'}</small>
              </label>
              <label>Duration<select value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))}><option value={1}>1 hour</option><option value={6}>6 hours</option><option value={12}>12 hours</option><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>1 week</option></select></label>
              <label className="tournament-visibility-option">
                <input type="checkbox" checked={!isPublic} onChange={(event) => setIsPublic(!event.target.checked)} />
                <span><strong>Private tournament</strong><small>Only people with its code can find and join it.</small></span>
              </label>
              <div className="tournament-modal-actions">
                <button type="button" className="secondary" disabled={busy} onClick={() => setCreateOpen(false)}>Cancel</button>
                <button type="submit" disabled={busy || !name.trim() || !selectedGame || !selectedLibraryGame}>{busy ? 'Creating…' : 'Create tournament'}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
    </AppShell>
  );
}
