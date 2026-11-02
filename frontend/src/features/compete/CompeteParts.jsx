import React, { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { boxArtFor, useHomeLibrary } from '../home/homeLibrary';

export function splitCountdown(target) {
  let seconds = Math.max(0, Math.floor((new Date(target).getTime() - Date.now()) / 1000));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  const pad = (value) => String(value).padStart(2, '0');
  return [[days, 'days'], [pad(hours), 'hrs'], [pad(minutes), 'min'], [pad(seconds % 60), 'sec']];
}

/** Box art lookup by ROM name from the player's own library (empty string when unknown). */
export function useRomArt() {
  const library = useHomeLibrary();
  return useCallback((romName) => {
    const key = String(romName || '').toLowerCase();
    const match = library.games.find((game) => game.system === 'arcade' && (game.romKey || '').toLowerCase() === key && game.boxArtUrl);
    return boxArtFor(match);
  }, [library.games]);
}

export function Countdown({ target, label }) {
  return (
    <div className="osg-clock" role="timer" aria-label={label}>
      {splitCountdown(target).map(([value, unit]) => (
        <div key={unit}><b>{value}</b><span>{unit}</span></div>
      ))}
    </div>
  );
}

export function StatePill({ status }) {
  if (status === 'active') return <span className="osg-live"><i />LIVE</span>;
  if (status === 'upcoming') return <span className="osg-live soon"><i />STARTS SOON</span>;
  return <span className="osg-live done"><i />ENDED</span>;
}

export function entrantsLabel(count) {
  const n = Number(count) || 0;
  return `${n} entrant${n === 1 ? '' : 's'}`;
}

export function Section({ id, title, hint, children, action }) {
  return (
    <section className="cmp-sec" aria-labelledby={id}>
      <div className="cmp-sec-head">
        <h2 id={id}>{title}</h2>
        {hint ? <p>{hint}</p> : null}
        {action ? <div className="cmp-sec-action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children }) {
  return <div className="cmp-empty"><strong>{title}</strong><p>{children}</p></div>;
}

/** Live or upcoming tournament card. */
export function TournamentCard({ item, art, remaining }) {
  const isActive = item.status === 'active';
  const action = item.joined ? (isActive ? 'Play' : 'View') : (isActive ? 'Enter' : 'Open');
  return (
    <article className={`cmp-card${isActive ? ' is-live' : ''}`}>
      {art ? <img className="cmp-card-art" src={art} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
      <div className="cmp-card-main">
        <StatePill status={item.status} />
        <h3>{item.name}</h3>
        <p className="cmp-card-sub">{item.display_name} · {item.is_public ? 'Public' : 'Private'}</p>
        <p className="cmp-card-meta">
          <span>{entrantsLabel(item.entry_count)}</span>
          <span>{isActive ? 'Ends in' : 'Starts in'} <b>{remaining}</b></span>
          {item.joined ? <span className="cmp-joined">Entered</span> : null}
        </p>
      </div>
      <Link className="cmp-card-go button-like" to={`/tournaments/${item.code}`} aria-label={`${action} ${item.name}`}>{action}</Link>
    </article>
  );
}

/** Compact row for finished tournaments. No winner is shown: the list API does not return one. */
export function PastRow({ item }) {
  const ended = item.ends_at ? new Date(item.ends_at).toLocaleDateString() : '';
  return (
    <li>
      <Link to={`/tournaments/${item.code}`}>
        <span className="cmp-past-name">{item.name}</span>
        <span className="cmp-past-game">{item.display_name}</span>
        <span className="cmp-past-meta">{entrantsLabel(item.entry_count)}{ended ? ` · ${ended}` : ''}</span>
      </Link>
    </li>
  );
}

export function useBuckets(mine, publicList) {
  return useMemo(() => {
    const byCode = new Map();
    [...mine, ...publicList].forEach((item) => { if (!byCode.has(item.code)) byCode.set(item.code, item); });
    const all = [...byCode.values()];
    const time = (value) => new Date(value).getTime() || 0;
    return {
      live: all.filter((i) => i.status === 'active').sort((a, b) => Number(b.joined) - Number(a.joined) || time(a.ends_at) - time(b.ends_at)),
      upcoming: all.filter((i) => i.status === 'upcoming').sort((a, b) => time(a.starts_at) - time(b.starts_at)),
      past: all.filter((i) => i.status !== 'active' && i.status !== 'upcoming').sort((a, b) => time(b.ends_at) - time(a.ends_at)),
    };
  }, [mine, publicList]);
}
