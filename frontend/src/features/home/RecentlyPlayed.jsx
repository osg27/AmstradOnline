import React, { useState } from 'react';
import { FileIcon, MoreIcon, PlayIcon } from './icons';
import { systemStyle } from './systemCapabilities';
import { formatDuration, formatPlayedAgo } from './homeFormat';

/**
 * A game screenshot that falls back to box art, then to a system label, when the
 * libretro snap is missing. Snaps are pixel art, so they keep hard edges.
 */
export function GameShot({ item, className = '' }) {
  const [failed, setFailed] = useState(() => new Set());
  const candidates = [
    item.screenshot ? { src: item.screenshot, kind: 'snap' } : null,
    item.boxArt ? { src: item.boxArt, kind: 'box' } : null,
  ].filter((candidate) => candidate && !failed.has(candidate.src));
  const current = candidates[0];
  const style = systemStyle(item.system);

  if (!current) {
    return (
      <span className={`osg-shot-fallback ${className}`} style={{ '--sys': style.color }} aria-hidden="true">
        <b>{style.label}</b>
      </span>
    );
  }
  return (
    <>
      {current.kind === 'box' ? <span className="osg-shot-blur" style={{ backgroundImage: `url("${current.src}")` }} aria-hidden="true" /> : null}
      <img
        className={`${className} ${current.kind === 'box' ? 'is-box' : 'is-snap'}`}
        src={current.src}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setFailed((set) => new Set(set).add(current.src))}
      />
    </>
  );
}

export function LastPlayedHero({ item, onPlay, onMore, onStartFile, onOpenLibrary, starting }) {
  if (!item) {
    return (
      <article className="osg-feature is-empty" aria-labelledby="osg-feature-title">
        <div className="osg-feature-copy">
          <span className="osg-eyebrow">Ready, player one</span>
          <h1 id="osg-feature-title">Start a game</h1>
          <p className="osg-feature-lede">Games you play show up here so you can jump straight back in. Load a game file into a room, or open your library.</p>
          <div className="osg-feature-actions">
            <button type="button" className="osg-btn coin lg" onClick={onStartFile}><FileIcon />Play a game file</button>
            <button type="button" className="osg-btn glass lg" onClick={onOpenLibrary}>Open your library</button>
          </div>
        </div>
      </article>
    );
  }

  const style = systemStyle(item.system);
  return (
    <article className="osg-feature" aria-labelledby="osg-feature-title">
      {item.boxArt || item.screenshot ? <div className="osg-feature-bg" style={{ backgroundImage: `url("${item.boxArt || item.screenshot}")` }} aria-hidden="true" /> : null}
      <div className="osg-feature-copy">
        <span className="osg-eyebrow">Last played</span>
        <span className="osg-chip-sys" style={{ '--sys': style.color }}><i />{style.label}</span>
        <h1 id="osg-feature-title">{item.title}</h1>
        <div className="osg-feature-meta">
          <span>Played <b>{formatPlayedAgo(item.lastPlayedAt)}</b></span>
          {item.totalSeconds >= 60 ? <span><b>{formatDuration(item.totalSeconds)}</b> in total</span> : null}
        </div>
        <div className="osg-feature-actions">
          <button type="button" className="osg-btn coin lg" onClick={onPlay} disabled={starting}><PlayIcon />{starting ? 'Starting…' : 'Play again'}</button>
          <button type="button" className="osg-btn glass lg" onClick={onMore} aria-label="More ways to play"><MoreIcon /><span className="hide-sm">More ways to play</span></button>
        </div>
      </div>
      <div className="osg-feature-screen">
        <div className="osg-crt"><GameShot item={item} /></div>
        {item.boxArt && item.screenshot ? <img className="osg-box-peek" src={item.boxArt} alt="" referrerPolicy="no-referrer" /> : null}
      </div>
    </article>
  );
}

export default function RecentlyPlayed({ items, onOpen }) {
  if (!items.length) return null;
  return (
    <section className="osg-sec" aria-labelledby="osg-recent-title">
      <div className="osg-sec-head">
        <div><h2 id="osg-recent-title">Recently played</h2><p>Your most recent games before that one</p></div>
      </div>
      <div className="osg-rail">
        {items.map((item) => {
          const style = systemStyle(item.system);
          return (
            <button key={item.key} type="button" className="osg-snap-card" onClick={(event) => onOpen(item, event)}>
              <span className="osg-shot">
                <GameShot item={item} />
                <span className="osg-sys-tag">{style.label.toUpperCase()}</span>
                <span className="osg-play" aria-hidden="true"><PlayIcon /></span>
              </span>
              <span>
                <span className="t">{item.title}</span>
                <span className="s">{formatPlayedAgo(item.lastPlayedAt)}{item.totalSeconds >= 60 ? ` · ${formatDuration(item.totalSeconds)}` : ''}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
