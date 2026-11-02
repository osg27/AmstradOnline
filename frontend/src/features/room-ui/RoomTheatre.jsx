import React from 'react';

/**
 * Theatre: the game screen fills the available area at its aspect ratio, with
 * an ambient glow behind it. Emulator elements are passed as children unchanged.
 */
export default function RoomTheatre({ ambientImage, glowColor, crt, paused, showPausedTag, overlay, children, screenClassName = '' }) {
  return (
    <>
      <div
        className="osg-ambient"
        style={{
          '--osg-glow': glowColor,
          backgroundImage: ambientImage ? `url("${ambientImage}")` : undefined,
        }}
      />
      <div className="osg-screen-area">
        <div className={`osg-screen ${crt ? 'crt' : ''} ${screenClassName}`.trim()} style={{ '--osg-glow': glowColor }}>
          {children}
          {paused && showPausedTag ? <div className="osg-paused-tag">PAUSED</div> : null}
          {overlay ? <div className="osg-screen-overlay">{overlay}</div> : null}
        </div>
      </div>
    </>
  );
}
