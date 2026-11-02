import React, { useCallback, useEffect, useRef } from 'react';
import Icon from './icons';
import { dpadMaskFromOffset } from './roomUiConfig';

/**
 * On-screen touch controls for phones. Produces the same joystick mask bits as
 * a gamepad and hands them to `onMaskChange` (RoomPage → sendLocalJoystickMask).
 * Hidden while a controller is connected; shows a fallback card for systems
 * where touch play is not safe.
 */
export default function TouchControls({ profile, onMaskChange, onFirstTouch, padConnected, padName, padKind, disabled, menuHint }) {
  const pointersRef = useRef(new Map()); // pointerId -> mask bits
  const lastMaskRef = useRef(0);
  const dpadRef = useRef(null);
  const onMaskChangeRef = useRef(onMaskChange);
  onMaskChangeRef.current = onMaskChange;

  const publish = useCallback(() => {
    let mask = 0;
    pointersRef.current.forEach((bits) => { mask |= bits; });
    if (mask !== lastMaskRef.current) {
      lastMaskRef.current = mask;
      onMaskChangeRef.current(mask);
    }
  }, []);

  const releaseAll = useCallback(() => {
    pointersRef.current.clear();
    if (lastMaskRef.current !== 0) {
      lastMaskRef.current = 0;
      onMaskChangeRef.current(0);
    }
  }, []);

  useEffect(() => {
    if (disabled || padConnected) releaseAll();
  }, [disabled, padConnected, releaseAll]);

  useEffect(() => () => releaseAll(), [releaseAll]);

  function dpadBits(event) {
    const rect = dpadRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return dpadMaskFromOffset(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
  }

  function start(event, bits) {
    event.preventDefault();
    onFirstTouch?.();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, bits);
    publish();
  }

  function end(event) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.delete(event.pointerId);
    publish();
  }

  if (!profile) {
    if (padConnected) return null;
    return (
      <div className="osg-pad-hint osg-touch-fallback">
        <Icon name="kb" />
        <b>Connect a controller or keyboard</b>
        <small>This system needs a keyboard, mouse or controller. On-screen controls aren’t available for it yet.</small>
      </div>
    );
  }

  if (padConnected) {
    return (
      <div className="osg-pad-hint">
        <Icon name={padKind === 'stick' ? 'stick' : 'pad'} />
        <b>{padName || 'Controller'} connected</b>
        <small>On-screen controls are hidden. {menuHint}</small>
      </div>
    );
  }

  const faceClass = profile.face.length === 1 ? 'one' : profile.face.length === 2 ? 'two' : profile.face.length === 4 ? 'four' : '';

  return (
    <div className="osg-touch" aria-hidden="true">
      <div
        ref={dpadRef}
        className="osg-dpad"
        onPointerDown={(event) => start(event, dpadBits(event))}
        onPointerMove={(event) => {
          if (!pointersRef.current.has(event.pointerId)) return;
          pointersRef.current.set(event.pointerId, dpadBits(event));
          publish();
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onContextMenu={(event) => event.preventDefault()}
      >
        <span className="u">▲</span><span className="l">◀</span><span className="c" /><span className="r">▶</span><span className="d">▼</span>
      </div>
      <div className={`osg-face ${faceClass}`}>
        {profile.face.map((button, index) => (
          <span
            key={button.label}
            className={`f${index + 1} ${button.tone}`}
            onPointerDown={(event) => start(event, button.mask)}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
            onContextMenu={(event) => event.preventDefault()}
          >
            {button.label}
          </span>
        ))}
      </div>
      {profile.keys.length ? (
        <div className="osg-sys-keys">
          {profile.keys.map((key) => (
            <span
              key={key.label}
              onPointerDown={(event) => start(event, key.mask)}
              onPointerUp={end}
              onPointerCancel={end}
              onLostPointerCapture={end}
              onContextMenu={(event) => event.preventDefault()}
            >
              {key.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
