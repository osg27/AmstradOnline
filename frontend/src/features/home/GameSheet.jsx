import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HomeSheet from './HomeSheet';
import { LinkIcon, OnlineIcon, PartyIcon, PlayIcon } from './icons';
import { findCatalogSystem } from './systemCatalog';
import { getSystemCapabilities } from './systemCapabilities';
import { createSystemRoom } from './roomLaunch';
import { buildLaunchGame } from './homeLibrary';
import { formatDuration, formatPlayedAgo } from './homeFormat';
import { launchLibraryGame } from '../../pages/LocalLibraryPage';

/** Play modes for one game, built only from what its system supports. */
export function buildModes(caps, inLibrary) {
  if (!caps) return [];
  const modes = [];
  if (caps.cabinet) {
    modes.push({
      id: 'solo',
      icon: PlayIcon,
      title: 'Open MAME cabinet',
      desc: caps.highScores === 'all' ? 'Your best scores are saved to the leaderboard' : 'Starts straight away',
    });
  } else if (caps.solo) {
    modes.push({
      id: 'solo',
      icon: PlayIcon,
      title: 'Play solo',
      desc: caps.retroAchievements
        ? 'Earns RetroAchievements when your account is connected'
        : caps.highScores === 'some' ? 'High scores saved on supported games' : 'Starts straight away',
    });
  }
  if (caps.online) {
    modes.push({ id: 'hosted', icon: OnlineIcon, title: 'Play online with a friend', desc: 'Two players. Share the room code' });
  }
  if (caps.party) {
    modes.push({
      id: 'party',
      icon: PartyIcon,
      title: 'Party Mode',
      desc: inLibrary ? 'Take turns with a group, up to 4 players. Pick the game in the room' : 'Take turns with a group, up to 4 players',
      emptyRoom: true,
    });
  }
  if (caps.link) {
    modes.push({
      id: 'link',
      icon: LinkIcon,
      title: 'Link Play',
      desc: inLibrary ? 'Connect two machines. Pick the game in the room' : 'Connect two machines',
      testing: caps.link.testing,
      emptyRoom: true,
    });
  }
  return modes;
}

/**
 * Game sheet: what the game is, what its system supports, and how to start it.
 * `item` comes from the recent-games rail or the library picks.
 */
export default function GameSheet({ item, games, onClose }) {
  const navigate = useNavigate();
  const [busyMode, setBusyMode] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [coverBroken, setCoverBroken] = useState(false);
  const caps = getSystemCapabilities(item.system);
  const catalogSystem = findCatalogSystem(caps?.id);
  const inLibrary = Boolean(item.libraryGame);
  const modes = buildModes(caps, inLibrary);
  const titleId = 'osg-game-sheet-title';

  async function start(mode) {
    if (busyMode) return;
    setBusyMode(mode.id);
    setError('');
    setStatus('');
    try {
      if (inLibrary && !mode.emptyRoom) {
        await launchLibraryGame(buildLaunchGame(games, item.libraryGame), {
          navigate,
          hostingMode: mode.id === 'hosted' ? 'multiplayer' : 'solo',
          onStatus: setStatus,
        });
        return;
      }
      const path = await createSystemRoom({ system: catalogSystem, mode: mode.id });
      navigate(path);
    } catch (err) {
      setError(err.message || 'Could not start that room.');
      setBusyMode('');
    }
  }

  const tags = [];
  if (caps?.retroAchievements) tags.push({ key: 'ra', mark: '◆', text: 'RetroAchievements in solo' });
  if (caps?.highScores === 'all') tags.push({ key: 'hs', mark: '▲', text: 'High scores in solo' });
  if (caps?.highScores === 'some') tags.push({ key: 'hs', mark: '▲', text: 'Leaderboard on supported games' });
  if (caps?.input) tags.push({ key: 'input', text: caps.input });
  if (caps?.testing) tags.push({ key: 'testing', text: 'Testing' });

  const variants = item.libraryGame ? (item.variantCount || 1) : 0;
  const facts = [];
  if (variants > 1) facts.push(`${variants} versions`);
  facts.push(inLibrary ? 'In your library' : 'Not in this browser’s library');

  const stats = [];
  if (item.lastPlayedAt) stats.push({ label: 'Last played', value: formatPlayedAgo(item.lastPlayedAt) });
  if (item.totalSeconds) stats.push({ label: 'Time in rooms', value: formatDuration(item.totalSeconds) });

  return (
    <HomeSheet labelledBy={titleId} onClose={onClose} backdropImage={item.boxArt || item.screenshot}>
      <div className="osg-sheet-cover">
        {item.boxArt && !coverBroken ? <img src={item.boxArt} alt="" referrerPolicy="no-referrer" onError={() => setCoverBroken(true)} /> : (
          <span className="osg-cover-fallback" style={{ '--sys': caps?.color }}>{caps?.shortName || item.system}</span>
        )}
      </div>
      <div className="osg-sheet-main">
        <span className="osg-chip-sys" style={{ '--sys': caps?.color }}><i />{caps?.label || item.system}</span>
        <h2 id={titleId}>{item.title}</h2>
        <div className="osg-sheet-facts">{facts.map((fact) => <span key={fact}>{fact}</span>)}</div>
        {tags.length ? (
          <div className="osg-sheet-tags">
            {tags.map((tag) => <span key={tag.key}>{tag.mark ? <i aria-hidden="true">{tag.mark}</i> : null}{tag.text}</span>)}
          </div>
        ) : null}
        <div className="osg-modes">
          {modes.map((mode, index) => {
            const Icon = mode.icon;
            return (
              <button
                key={mode.id}
                type="button"
                className={`osg-mode${index === 0 ? ' primary' : ''}`}
                onClick={() => start(mode)}
                disabled={Boolean(busyMode)}
              >
                <span className="osg-mode-ic"><Icon /></span>
                <span>
                  <b>{busyMode === mode.id ? 'Starting…' : mode.title}{mode.testing ? <span className="osg-tag-test">TESTING</span> : null}</b>
                  <span>{mode.desc}</span>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            );
          })}
          {caps?.cabinet ? (
            <p className="osg-mode-note">Friends join from inside the room: open the cabinet to multiplayer and the first friend in is P2, everyone else queues with 10p or watches.</p>
          ) : null}
          {!inLibrary ? (
            <p className="osg-mode-note">This game isn’t in your library on this browser, so the room opens empty and you load the file there.</p>
          ) : null}
        </div>
        {status && !error ? <p className="osg-sheet-status" role="status">{status}</p> : null}
        {error ? <p className="osg-sheet-error" role="alert">{error}</p> : null}
        {stats.length ? (
          <div className="osg-sheet-best">
            {stats.map((stat) => <span key={stat.label}>{stat.label}<b>{stat.value}</b></span>)}
          </div>
        ) : null}
      </div>
    </HomeSheet>
  );
}
