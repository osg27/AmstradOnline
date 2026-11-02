import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const COMPACT_QUERY = '(max-width: 720px)';

function useCompact() {
  const [compact, setCompact] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(COMPACT_QUERY).matches : false
  ));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const query = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return compact;
}

/**
 * Modal used by the game sheet and the "Play a game file" picker: a centred card on
 * desktop, a bottom sheet with its own scroll area and a drag handle on phones.
 * Esc closes, focus moves to the close button and returns to the opener.
 */
export default function HomeSheet({ labelledBy, onClose, backdropImage = '', children, className = '' }) {
  const compact = useCompact();
  const [open, setOpen] = useState(false);
  const closeRef = useRef(null);
  const sheetRef = useRef(null);
  const bodyRef = useRef(null);
  const dragRef = useRef(null);
  const openerRef = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = openerRef.current;
    const root = document.documentElement;
    root.classList.add('osg-locked');
    const frame = window.requestAnimationFrame(() => setOpen(true));
    closeRef.current?.focus({ preventScroll: true });

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      // Keep keyboard focus inside the dialog.
      const focusable = sheetRef.current.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey, true);
      root.classList.remove('osg-locked');
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  function onGrabDown(event) {
    dragRef.current = { startY: event.clientY, moved: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  }
  function onGrabMove(event) {
    if (!dragRef.current || !sheetRef.current) return;
    dragRef.current.moved = Math.max(0, event.clientY - dragRef.current.startY);
    sheetRef.current.style.transform = `translateY(${dragRef.current.moved}px)`;
  }
  function onGrabEnd() {
    if (!dragRef.current || !sheetRef.current) return;
    const { moved } = dragRef.current;
    dragRef.current = null;
    sheetRef.current.style.transition = '';
    sheetRef.current.style.transform = '';
    if (moved > 90) onClose();
  }

  return createPortal(
    <div
      className={`osg-scrim${open ? ' open' : ''}${compact ? ' compact' : ''}`}
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div ref={sheetRef} className={`osg-sheet ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {backdropImage ? <div className="osg-sheet-bg" style={{ backgroundImage: `url("${backdropImage}")` }} aria-hidden="true" /> : null}
        <span
          className="osg-grab"
          aria-hidden="true"
          onPointerDown={onGrabDown}
          onPointerMove={onGrabMove}
          onPointerUp={onGrabEnd}
          onPointerCancel={onGrabEnd}
        />
        <button ref={closeRef} type="button" className="osg-sheet-close" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <div ref={bodyRef} className="osg-sheet-in">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
