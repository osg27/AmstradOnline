import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './icons';
import { summariseAchievements } from '../retroachievements/achievementsView';
import './side-panels.css';

// Keep keyboard focus where it is (the emulator) when a panel button or link is clicked.
const keepFocus = (event) => {
  if (event.target.closest('a, button')) event.preventDefault();
};

function PanelShell({ side, label, children }) {
  return (
    <aside className={`osg-side osg-side-${side}`} aria-label={label} onMouseDown={keepFocus}>
      {children}
    </aside>
  );
}

/** Left panel: top 10 high scores. The caller hides it when there is no leaderboard. */
export function ScorePanel({ kicker, title, subtitle, status, entries = [], username, saveLabel, saving, onSave }) {
  return (
    <PanelShell side="left" label="High scores">
      <header className="osg-side-head">
        <span className="osg-side-kicker"><Icon name="trophy" />{kicker || 'High scores'}</span>
        <strong className="osg-side-title">{title}</strong>
        {subtitle ? <small className="osg-side-sub">{subtitle}</small> : null}
      </header>
      {status ? <p className="osg-side-note">{status}</p> : null}
      {onSave ? (
        <button type="button" className="osg-side-save" onClick={(event) => { event.currentTarget.blur(); onSave(); }} disabled={saving}>
          {saving ? 'Saving…' : saveLabel || 'Save score now'}
        </button>
      ) : null}
      {entries.length ? (
        <ol className="osg-side-scores">
          {entries.slice(0, 10).map((entry) => (
            <li
              key={`${entry.rank}-${entry.username}-${entry.score}`}
              className={`${entry.rank <= 3 ? `r${entry.rank}` : ''} ${entry.username === username ? 'me' : ''}`.trim()}
            >
              <b className="osg-side-rank">{entry.rank}</b>
              <span className="osg-side-name">{entry.username}{entry.initials ? <small>{entry.initials}</small> : null}</span>
              <span className="osg-side-score">{Number(entry.score).toLocaleString()}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="osg-side-empty"><strong>No saved runs yet</strong><span>Finish a run and enter initials.</span></div>
      )}
    </PanelShell>
  );
}

const ONLINE_MESSAGE = 'Achievements are only earned in solo play. They start again when you play this game on your own.';
const UNSUPPORTED_MESSAGE = 'This game was not recognised by RetroAchievements. The ROM version must match a supported hash.';

/** Right panel: the game's full RetroAchievements list, ticked off live. */
export function AchievementsPanel({ view, items = [], status, onRetry }) {
  const { unlocked, total, points, totalPoints } = summariseAchievements(items);
  const listRef = useRef(null);
  const seen = useRef(null);
  const [freshIds, setFreshIds] = useState(() => new Set());

  // Highlight and scroll to newly unlocked rows (not for ones already unlocked when the list first appears).
  const unlockedIds = items.filter((item) => item.unlocked).map((item) => item.id);
  const unlockedKey = unlockedIds.join(',');
  useEffect(() => {
    if (!items.length) { seen.current = null; setFreshIds(new Set()); return; }
    if (seen.current === null) { seen.current = new Set(unlockedIds); return; }
    const added = unlockedIds.filter((id) => !seen.current.has(id));
    if (!added.length) return;
    added.forEach((id) => seen.current.add(id));
    setFreshIds(new Set(added));
    const row = listRef.current?.querySelector(`[data-ach="${added[added.length - 1]}"]`);
    if (row?.scrollIntoView) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      row.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlockedKey, items.length]);

  let body;
  if (items.length) {
    body = (
      <>
        <div className="osg-side-progress" role="group" aria-label="Achievement progress">
          <div className="osg-side-bar"><i style={{ width: `${total ? (unlocked / total) * 100 : 0}%` }} /></div>
          <small><b>{unlocked}</b> of {total} unlocked · {points}/{totalPoints} pts</small>
        </div>
        {view === 'online' ? <p className="osg-side-note">{ONLINE_MESSAGE}</p> : null}
        <ul className="osg-side-ach" ref={listRef}>
          {items.map((item) => {
            const state = item.unlocked ? 'on' : item.state === 3 ? 'off' : 'lock';
            return (
              <li key={item.id} data-ach={item.id} className={`${state} ${freshIds.has(item.id) ? 'fresh' : ''}`.trim()}>
                <span className="osg-side-badge" aria-hidden="true"><Icon name={item.unlocked ? 'gem' : 'lock'} /></span>
                <div className="osg-side-ach-text">
                  <a href={`https://retroachievements.org/achievement/${item.id}`} target="_blank" rel="noopener noreferrer">{item.title}</a>
                  <small>{item.description}</small>
                  {item.progress ? <small className="osg-side-prog">{item.progress}</small> : null}
                </div>
                <span className="osg-side-pts">
                  {item.unlocked ? <Icon name="check" className="osg-side-tick" /> : null}
                  {item.points}
                  <small>{item.unlocked ? 'Unlocked' : item.state === 3 ? 'N/A' : 'Locked'}</small>
                </span>
              </li>
            );
          })}
        </ul>
      </>
    );
  } else if (view === 'notConnected') {
    body = (
      <div className="osg-side-empty">
        <strong>Not signed in to RetroAchievements</strong>
        <span>Connect your account to earn achievements here.</span>
        <Link to="/profile">Open Profile</Link>
      </div>
    );
  } else if (view === 'error') {
    body = (
      <div className="osg-side-empty">
        <strong>Couldn’t load achievements</strong>
        <span>{status || 'Something went wrong talking to RetroAchievements.'}</span>
        {onRetry ? <button type="button" className="osg-side-save" onClick={(event) => { event.currentTarget.blur(); onRetry(); }}>Retry</button> : null}
        <Link to="/profile">Check Profile</Link>
      </div>
    );
  } else if (view === 'unsupported') {
    body = <div className="osg-side-empty"><strong>No achievements found</strong><span>{status || UNSUPPORTED_MESSAGE}</span></div>;
  } else if (view === 'online') {
    body = <div className="osg-side-empty"><strong>Solo play only</strong><span>{ONLINE_MESSAGE}</span></div>;
  } else {
    body = <div className="osg-side-empty"><span>Loading achievements…</span></div>;
  }

  return (
    <PanelShell side="right" label="Achievements">
      <header className="osg-side-head">
        <span className="osg-side-kicker ra"><Icon name="gem" />Achievements<em>Softcore</em></span>
      </header>
      {body}
    </PanelShell>
  );
}
