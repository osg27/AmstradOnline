import React from 'react';
import Icon from './icons';

// Drop focus after a click so arrow keys / Space go back to the game instead of
// the dock control.
const blurAfter = (handler) => (event) => {
  event.currentTarget.blur();
  handler?.(event);
};

/** Small bottom dock: Pause/Resume, Volume, Record (when available), Fullscreen, More. */
export default function RoomDock({
  pause,
  volume,
  record,
  fullscreen,
  onMore,
  menuShortcut,
}) {
  return (
    <nav className="osg-dock" aria-label="Game controls">
      {pause ? (
        <button
          className="osg-dbtn"
          type="button"
          onClick={blurAfter(pause.onClick)}
          disabled={pause.disabled}
          aria-label={pause.paused ? 'Resume' : 'Pause'}
        >
          <Icon name={pause.paused ? 'play' : 'pause'} />
          <span className="osg-tip">{pause.paused ? 'Resume' : 'Pause'}</span>
        </button>
      ) : null}
      {volume ? (
        <label className="osg-vol">
          <Icon name={volume.value === 0 ? 'mute' : 'vol'} />
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={volume.value}
            onChange={volume.onChange}
            onPointerUp={(event) => event.currentTarget.blur()}
            aria-label={`Volume ${volume.value}%`}
          />
        </label>
      ) : null}
      {pause || volume ? <span className="osg-dsep" /> : null}
      {record ? (
        <button
          className={`osg-dbtn ${record.active ? 'recording' : ''}`}
          type="button"
          onClick={record.onClick}
          aria-label={record.active ? 'Recording — open recorder' : 'Record gameplay'}
        >
          <span className="osg-rec-dot" />
          <span className="osg-tip">{record.active ? 'Recording…' : 'Record gameplay'}</span>
        </button>
      ) : null}
      <button className="osg-dbtn" type="button" onClick={blurAfter(fullscreen.onClick)} aria-label={fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'}>
        <Icon name={fullscreen.active ? 'exitFull' : 'full'} />
        <span className="osg-tip">{fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'}</span>
      </button>
      <button className="osg-dbtn" type="button" onClick={onMore} aria-label="Menu">
        <Icon name="more" />
        <span className="osg-tip">Menu {menuShortcut}</span>
      </button>
    </nav>
  );
}
