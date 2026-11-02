import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileIcon, PlayIcon } from './icons';
import { systemStyle } from './systemCapabilities';
import { boxArtFor } from './homeLibrary';

const TABS = [
  { id: 'favourites', label: '★ Favourites' },
  { id: 'added', label: 'Recently added' },
  { id: 'arcade', label: 'Arcade' },
];

function CoverCard({ game, onOpen }) {
  const [broken, setBroken] = useState(false);
  const art = broken ? '' : boxArtFor(game);
  const style = systemStyle(game.system);
  return (
    <button type="button" className="osg-cover-card" onClick={(event) => onOpen(game, event)}>
      <span className="osg-cover">
        {art ? (
          <img src={art} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        ) : (
          <span className="osg-cover-fallback" style={{ '--sys': style.color }}>{style.label}</span>
        )}
        <span className="osg-play" aria-hidden="true"><PlayIcon /></span>
      </span>
      <span>
        <span className="t">{game.title}</span>
        <span className="s" style={{ '--sys': style.color }}><i />{style.label}{game.variantCount > 1 ? ` · ${game.variantCount} versions` : ''}</span>
      </span>
    </button>
  );
}

/** "From your library": one row of up to seven covers, never the whole library. */
export default function LibraryPicks({ loading, picks, totalCount, stackArt, onOpen, onBrowse, onStartFile }) {
  const tabs = useMemo(() => TABS.filter((tab) => picks[tab.id]?.length), [picks]);
  const [current, setCurrent] = useState('');
  const active = tabs.find((tab) => tab.id === current) || tabs[0];
  const tabRefs = useRef({});

  useEffect(() => {
    if (current && !tabs.some((tab) => tab.id === current)) setCurrent('');
  }, [current, tabs]);

  function onTabKey(event) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !tabs.length) return;
    const index = tabs.findIndex((tab) => tab.id === active?.id);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setCurrent(next.id);
    tabRefs.current[next.id]?.focus();
    event.preventDefault();
  }

  const subtitle = totalCount
    ? `A few picks from ${totalCount.toLocaleString()} game${totalCount === 1 ? '' : 's'}`
    : 'A few picks from your games';

  return (
    <section className="osg-sec" aria-labelledby="osg-lib-title">
      <div className="osg-sec-head">
        <div><h2 id="osg-lib-title">From your library</h2>{tabs.length ? <p>{subtitle}</p> : null}</div>
        <div className="osg-sec-links">
          <button type="button" className="osg-more" onClick={onStartFile}>Play a game file</button>
          <button type="button" className="osg-more" onClick={onBrowse}>Browse all games ›</button>
        </div>
      </div>

      {loading ? <div className="osg-picks is-loading" aria-busy="true" /> : null}

      {!loading && !tabs.length ? (
        <div className="osg-empty">
          <strong>Your library is empty on this browser</strong>
          <p>Link a ROM folder for each system and your games appear here with their box art. You can still load a single game file straight into a room.</p>
          <div className="osg-empty-actions">
            <button type="button" onClick={onBrowse}>Set up your library</button>
            <button type="button" className="secondary" onClick={onStartFile}><FileIcon />Play a game file</button>
          </div>
        </div>
      ) : null}

      {!loading && tabs.length ? (
        <>
          <div className="osg-filters" role="tablist" aria-label="Library picks" onKeyDown={onTabKey}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                ref={(node) => { tabRefs.current[tab.id] = node; }}
                type="button"
                role="tab"
                id={`osg-pick-tab-${tab.id}`}
                aria-selected={active?.id === tab.id}
                aria-controls="osg-picks-panel"
                tabIndex={active?.id === tab.id ? 0 : -1}
                className="osg-filter"
                onClick={() => setCurrent(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="osg-picks" id="osg-picks-panel" role="tabpanel" aria-labelledby={`osg-pick-tab-${active?.id}`}>
            {(picks[active?.id] || []).map((game) => <CoverCard key={game.id} game={game} onOpen={onOpen} />)}
            <button type="button" className="osg-browse-tile" onClick={onBrowse}>
              {stackArt.length ? (
                <span className="stack" aria-hidden="true">{stackArt.map((src) => <img key={src} src={src} alt="" referrerPolicy="no-referrer" />)}</span>
              ) : null}
              Browse all games
              {totalCount ? <small>{totalCount.toLocaleString()} in your library</small> : null}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
