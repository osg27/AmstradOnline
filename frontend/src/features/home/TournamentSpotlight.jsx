import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';

function pickTournament(list) {
  const now = Date.now();
  const time = (value) => new Date(value).getTime() || 0;
  const active = list.filter((item) => item.status === 'active' && time(item.ends_at) > now);
  if (active.length) {
    // Ones you already entered first, then whichever closes soonest.
    return [...active].sort((a, b) => Number(b.joined) - Number(a.joined) || time(a.ends_at) - time(b.ends_at))[0];
  }
  const upcoming = list.filter((item) => item.status === 'upcoming');
  return upcoming.sort((a, b) => time(a.starts_at) - time(b.starts_at))[0] || null;
}

function splitCountdown(target) {
  let seconds = Math.max(0, Math.floor((new Date(target).getTime() - Date.now()) / 1000));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  const pad = (value) => String(value).padStart(2, '0');
  return [[days, 'days'], [pad(hours), 'hrs'], [pad(minutes), 'min'], [pad(seconds % 60), 'sec']];
}

/** The tournament card beside "Last played". Real tournaments only, or an empty state. */
export default function TournamentSpotlight({ artFor }) {
  const navigate = useNavigate();
  const username = localStorage.getItem('username') || '';
  const [tournament, setTournament] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [leaders, setLeaders] = useState([]);
  const [mine, setMine] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, tick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [publicList, myList] = await Promise.all([
          apiFetch('/auth/tournaments/public').catch(() => []),
          apiFetch('/auth/tournaments/mine').catch(() => []),
        ]);
        const byCode = new Map();
        [...(Array.isArray(myList) ? myList : []), ...(Array.isArray(publicList) ? publicList : [])]
          .forEach((item) => { if (!byCode.has(item.code)) byCode.set(item.code, item); });
        const next = pickTournament([...byCode.values()]);
        let board = [];
        if (next?.joined) {
          board = await apiFetch(`/auth/tournaments/${encodeURIComponent(next.code)}/leaderboard?limit=100`).catch(() => []);
        }
        if (cancelled) return;
        setTournament(next);
        setLeaders(Array.isArray(board) ? board.slice(0, 3) : []);
        setMine(Array.isArray(board) ? board.find((row) => row.username === username) || null : null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    const refresh = window.setInterval(load, 60000);
    return () => { cancelled = true; window.clearInterval(refresh); };
  }, [username]);

  useEffect(() => {
    if (!tournament) return undefined;
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [tournament]);

  async function enter() {
    if (!tournament || busy) return;
    if (tournament.joined) { navigate(`/tournaments/${tournament.code}`); return; }
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/auth/tournaments/${encodeURIComponent(tournament.code)}/join`, { method: 'POST' });
      navigate(`/tournaments/${tournament.code}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!loaded) return <aside className="osg-tourney is-loading" aria-label="Tournament" aria-busy="true" />;

  if (!tournament) {
    return (
      <aside className="osg-tourney is-empty" aria-labelledby="osg-tourney-title">
        <span className="osg-eyebrow">Compete</span>
        <h3 id="osg-tourney-title">No live tournament right now</h3>
        <p className="osg-tourney-sub">When a public tournament opens it shows up here with its countdown and leaderboard.</p>
        <button type="button" className="secondary" onClick={() => navigate('/tournaments')}>See tournaments</button>
      </aside>
    );
  }

  const isActive = tournament.status === 'active';
  const art = artFor?.(tournament.rom_name) || '';
  const players = Number(tournament.entry_count) || 0;
  const playerLabel = `${players} player${players === 1 ? '' : 's'}`;

  return (
    <aside className="osg-tourney" aria-labelledby="osg-tourney-title">
      {art ? <img className="osg-tourney-art" src={art} alt="" referrerPolicy="no-referrer" /> : null}
      <div className="osg-tourney-head">
        <span className={`osg-live${isActive ? '' : ' soon'}`}><i />{isActive ? 'LIVE TOURNAMENT' : 'STARTS SOON'}</span>
        <h3 id="osg-tourney-title">{tournament.name}</h3>
        <p className="osg-tourney-sub">{tournament.display_name} · Arcade · best score counts</p>
      </div>
      <div className="osg-clock" role="timer" aria-label={isActive ? 'Time left' : 'Starts in'}>
        {splitCountdown(isActive ? tournament.ends_at : tournament.starts_at).map(([value, label]) => (
          <div key={label}><b>{value}</b><span>{label}</span></div>
        ))}
      </div>
      {tournament.joined ? (
        <ol className="osg-board">
          {leaders.length ? leaders.map((row) => (
            <li key={row.username} className={row.username === username ? 'you' : ''}>
              <span className="rk">{row.rank}</span>
              <span className="nm">{row.username}</span>
              <span className="sc">{Number(row.score).toLocaleString()}</span>
            </li>
          )) : <li className="note"><span className="nm">No verified scores yet. Be the first.</span></li>}
          {mine && mine.rank > 3 ? (
            <li className="you"><span className="rk">{mine.rank}</span><span className="nm">You</span><span className="sc">{Number(mine.score).toLocaleString()}</span></li>
          ) : null}
          {!mine && leaders.length ? <li className="you"><span className="rk">–</span><span className="nm">No score from you yet</span><span className="sc" /></li> : null}
        </ol>
      ) : (
        <p className="osg-board-locked">{players ? `${playerLabel} entered. ` : ''}Enter to see the live standings and play.</p>
      )}
      {error ? <p className="osg-sheet-error" role="alert">{error}</p> : null}
      <button type="button" className="osg-tourney-go" onClick={enter} disabled={busy}>
        {busy ? 'Entering…' : tournament.joined ? (isActive ? 'Play in tournament' : 'View tournament') : `Enter tournament · ${playerLabel}`}
      </button>
    </aside>
  );
}
