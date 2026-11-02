import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Icon from './icons';

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function visibleFocusables(scope) {
  if (!scope) return [];
  return Array.from(scope.querySelectorAll(FOCUSABLE)).filter((element) => element.getClientRects().length > 0);
}

function nudgeValue(element, direction) {
  const step = direction === 'right' || direction === 'up' ? 1 : -1;
  if (element.tagName === 'INPUT' && element.type === 'range') {
    const min = Number(element.min || 0);
    const max = Number(element.max || 100);
    const size = Number(element.step || 1) * 5;
    const next = Math.min(max, Math.max(min, Number(element.value) + step * size));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, String(next));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  if (element.tagName === 'SELECT') {
    const next = Math.min(element.options.length - 1, Math.max(0, element.selectedIndex + step));
    if (next === element.selectedIndex) return true;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(element, element.options[next].value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

const HINTS = {
  keyboard: [[['↑', '↓'], 'Move'], [['Enter'], 'Select'], [['Esc'], 'Back']],
  pad: [[['D-PAD'], 'Move'], [['A'], 'Select'], [['B'], 'Back']],
  stick: [[['STICK'], 'Move'], [['1'], 'Select'], [['2'], 'Back']],
  touch: [],
};

function HintGlyph({ inputType, label }) {
  if (inputType === 'pad' && label === 'A') return <span className="osg-glyph g-a">A</span>;
  if (inputType === 'pad' && label === 'B') return <span className="osg-glyph g-b">B</span>;
  if (inputType === 'pad') return <span className="osg-glyph g-start">{label}</span>;
  if (inputType === 'stick') return <span className="osg-glyph g-stick">{label}</span>;
  return <span className="osg-key">{label}</span>;
}

/**
 * The single in-game menu. Overlay with categories on desktop; bottom sheet
 * with drill-in on phones. Every panel stays mounted (hidden when inactive) so
 * components with live state — recorder, RetroAchievements, chat — keep running.
 */
const GameMenu = forwardRef(function GameMenu({
  open,
  viewport,
  categories,
  activeId,
  onSelect,
  onClose,
  header,
  inputType,
  menuShortcut,
}, ref) {
  const [drilled, setDrilled] = useState(false);
  const rootRef = useRef(null);
  const catsRef = useRef(null);
  const mainRef = useRef(null);
  const compact = viewport !== 'desktop';

  const focusSelectedCategory = useCallback(() => {
    const target = catsRef.current?.querySelector('[aria-selected="true"]') || visibleFocusables(catsRef.current)[0];
    target?.focus({ preventScroll: true });
  }, []);

  const focusFirstInMain = useCallback(() => {
    const items = visibleFocusables(mainRef.current).filter((element) => !element.classList.contains('osg-m-back'));
    (items[0] || mainRef.current?.querySelector('.osg-m-back'))?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) {
      setDrilled(false);
      return undefined;
    }
    const timer = window.setTimeout(focusSelectedCategory, 40);
    return () => window.clearTimeout(timer);
  }, [focusSelectedCategory, open]);

  const selectCategory = useCallback((id, { drill = true } = {}) => {
    onSelect(id);
    if (compact && drill) {
      setDrilled(true);
      window.setTimeout(focusFirstInMain, 30);
    }
  }, [compact, focusFirstInMain, onSelect]);

  const back = useCallback(() => {
    if (compact && drilled) {
      setDrilled(false);
      window.setTimeout(focusSelectedCategory, 30);
      return;
    }
    onClose('back');
  }, [compact, drilled, focusSelectedCategory, onClose]);

  const navigate = useCallback((direction, { fromGamepad = false } = {}) => {
    const active = document.activeElement;
    const root = rootRef.current;
    if (!root || !root.contains(active)) {
      if (compact && drilled) focusFirstInMain();
      else focusSelectedCategory();
      return;
    }
    const inCats = catsRef.current?.contains(active);

    if (fromGamepad && !inCats && (direction === 'left' || direction === 'right') && nudgeValue(active, direction)) return;

    if (direction === 'right' && inCats && !compact) {
      focusFirstInMain();
      return;
    }
    if (direction === 'left' && !inCats) {
      if (compact) {
        if (drilled) back();
      } else {
        focusSelectedCategory();
      }
      return;
    }
    if (direction !== 'up' && direction !== 'down') return;

    const scope = inCats ? catsRef.current : mainRef.current;
    const items = visibleFocusables(scope);
    if (!items.length) return;
    const index = items.indexOf(active);
    const next = items[(index + (direction === 'down' ? 1 : -1) + items.length) % items.length];
    next.focus({ preventScroll: false });
    next.scrollIntoView?.({ block: 'nearest' });
    if (inCats && !compact && next.dataset.cat) onSelect(next.dataset.cat);
  }, [back, compact, drilled, focusFirstInMain, focusSelectedCategory, onSelect]);

  const activate = useCallback(() => {
    const active = document.activeElement;
    if (!active || !rootRef.current?.contains(active)) {
      focusSelectedCategory();
      return;
    }
    if (active.tagName === 'SELECT' || (active.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(active.type))) {
      active.focus();
      return;
    }
    active.click();
  }, [focusSelectedCategory]);

  useImperativeHandle(ref, () => ({
    navigate: (direction) => navigate(direction, { fromGamepad: true }),
    activate,
    back,
    showCategory: (id) => {
      onSelect(id);
      if (compact) setDrilled(true);
    },
  }), [activate, back, compact, navigate, onSelect]);

  function handleKeyDown(event) {
    const target = event.target;
    const tag = target.tagName;
    const typing = tag === 'TEXTAREA' || tag === 'SELECT'
      || (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(target.type));

    if (event.key === 'Tab') {
      const items = visibleFocusables(rootRef.current);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && target === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && target === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }

    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const direction = map[event.key];
    if (!direction || typing) return;
    event.preventDefault();
    navigate(direction);
  }

  const hints = HINTS[inputType] || HINTS.keyboard;

  return (
    <div className={`osg-menu-scrim ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="osg-menu-backdrop" onClick={() => onClose('scrim')} />
      <div
        ref={rootRef}
        className={`osg-menu ${drilled ? 'drill' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Game menu"
        onKeyDown={handleKeyDown}
      >
        <aside className="osg-m-side">
          <div className="osg-m-game">
            {header.cover ? <img src={header.cover} alt="" /> : <span className="osg-m-cover-fallback" style={{ '--osg-sys': header.color }}>{header.systemShort}</span>}
            <div>
              <b>{header.title}</b>
              <span>{header.subtitle}</span>
            </div>
          </div>
          <button className="osg-resume" type="button" onClick={() => onClose('resume')}>
            <Icon name="play" />
            {header.resumeLabel || 'Resume game'}
          </button>
          <div className="osg-cats" ref={catsRef} role="tablist" aria-orientation="vertical">
            {categories.map((category) => (
              <button
                key={category.id}
                className="osg-cat"
                type="button"
                role="tab"
                data-cat={category.id}
                aria-selected={category.id === activeId}
                aria-controls={`osg-panel-${category.id}`}
                onClick={() => selectCategory(category.id)}
              >
                <Icon name={category.icon} />
                <span>{category.label}</span>
                {category.badge ? <span className={`osg-n ${category.hot ? 'hot' : ''}`}>{category.badge}</span> : <span />}
              </button>
            ))}
          </div>
        </aside>
        <section className="osg-m-main" ref={mainRef}>
          <button className="osg-m-back" type="button" onClick={back}>
            <Icon name="back" />
            Menu
          </button>
          {categories.map((category) => (
            <div
              key={category.id}
              id={`osg-panel-${category.id}`}
              role="tabpanel"
              className="osg-panel"
              hidden={category.id !== activeId}
            >
              <h2>{category.title || category.label}{category.titleExtra || null}</h2>
              {category.lead ? <p className="osg-lead">{category.lead}</p> : null}
              {category.content}
            </div>
          ))}
        </section>
        <footer className="osg-m-foot">
          {hints.map(([keys, label]) => (
            <span key={label}>
              {keys.map((key) => <HintGlyph key={key} inputType={inputType} label={key} />)}
              {label}
            </span>
          ))}
          <span className="osg-end">Resume {menuShortcut}</span>
        </footer>
      </div>
    </div>
  );
});

export default GameMenu;
