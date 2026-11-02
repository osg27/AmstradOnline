import { useEffect } from 'react';
import { ESC_HOLD_MS, PAD_COMBO_HOLD_MS, detectPadKind, padDisplayName } from './roomUiConfig';

// Events we dispatch ourselves to replay an Esc tap through the room's normal
// keyboard routing. The shortcut listener must ignore them.
const syntheticEvents = new WeakSet();

function consume(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function dispatchSyntheticKey(type) {
  const event = new KeyboardEvent(type, {
    key: 'Escape',
    code: 'Escape',
    keyCode: 27,
    which: 27,
    bubbles: true,
    cancelable: true,
  });
  syntheticEvents.add(event);
  window.dispatchEvent(event);
}

/** Replays a short Esc press into whatever keyboard routing the room uses. */
export function sendEscapeTap() {
  dispatchSyntheticKey('keydown');
  window.setTimeout(() => dispatchSyntheticKey('keyup'), 90);
}

/**
 * Global menu shortcuts for the game room.
 *
 * - Keyboard: Esc opens the menu on pad-style systems. On keyboard systems Esc is
 *   a real key, so a tap is replayed to the emulator and only a hold opens it.
 * - Gamepad: Guide (button 16), or Start + Select held together for ~1 s.
 * - While the menu is open: D-pad/stick move focus, A selects, B goes back.
 *
 * The listener is registered once, in the capture phase on window, before the
 * room's own keyboard listeners, so it can consume Esc before the emulator sees it.
 * All state is read from `optionsRef.current` at event time.
 */
export default function useGameMenuShortcuts(optionsRef) {
  useEffect(() => {
    let escTimer = 0;
    let escPending = false;
    let swallowEscUp = false;
    let lastInputType = '';

    const options = () => optionsRef.current || {};

    function reportInput(type, pad = null) {
      if (type === lastInputType && !pad) return;
      lastInputType = type;
      options().onInputType?.(type, pad);
    }

    function handleKeyDown(event) {
      if (syntheticEvents.has(event)) return;
      const opts = options();
      if (!opts.enabled) return;
      reportInput('keyboard');
      if (event.key !== 'Escape' || opts.blocked) return;

      if (opts.menuOpen) {
        consume(event);
        if (!event.repeat) {
          swallowEscUp = true;
          opts.menuBack?.();
        }
        return;
      }

      if (!opts.keyboardSystem) {
        consume(event);
        if (!event.repeat) {
          swallowEscUp = true;
          opts.openMenu?.('keyboard');
        }
        return;
      }

      consume(event);
      if (event.repeat || escPending) return;
      escPending = true;
      escTimer = window.setTimeout(() => {
        escTimer = 0;
        options().openMenu?.('keyboard');
      }, ESC_HOLD_MS);
    }

    function handleKeyUp(event) {
      if (syntheticEvents.has(event) || event.key !== 'Escape') return;
      if (swallowEscUp) {
        swallowEscUp = false;
        consume(event);
        return;
      }
      if (!escPending) return;
      consume(event);
      escPending = false;
      if (escTimer) {
        window.clearTimeout(escTimer);
        escTimer = 0;
        sendEscapeTap();
        options().onEscTap?.();
      }
    }

    function handleBlur() {
      if (escTimer) window.clearTimeout(escTimer);
      escTimer = 0;
      escPending = false;
    }

    function handlePointerDown(event) {
      if (event.pointerType === 'touch') reportInput('touch');
    }

    // ---------- gamepad ----------
    let frame = 0;
    let previous = {};
    let comboSince = 0;
    let comboFired = false;
    const heldSince = {};
    const lastRepeat = {};
    let lastPadKey = '';
    let lastPadCheck = 0;

    function choosePad(pads) {
      const preferred = options().preferredPadIndex;
      if (preferred !== null && preferred !== undefined && pads[preferred]) return pads[preferred];
      return pads.find(Boolean) || null;
    }

    function poll(time) {
      frame = window.requestAnimationFrame(poll);
      const opts = options();
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      const pad = choosePad(pads);

      if (time - lastPadCheck > 500) {
        lastPadCheck = time;
        const key = pad ? `${pad.index}:${pad.id}` : '';
        if (key !== lastPadKey) {
          lastPadKey = key;
          opts.onPadChange?.(pad ? { connected: true, name: padDisplayName(pad), kind: detectPadKind(pad) } : { connected: false, name: '', kind: null });
        }
      }

      if (!pad || !opts.enabled) {
        previous = {};
        return;
      }

      const pressed = (index) => Boolean(pad.buttons[index]?.pressed);
      const axisX = Number(pad.axes[0]) || 0;
      const axisY = Number(pad.axes[1]) || 0;
      const now = {
        a: pressed(0),
        b: pressed(1),
        up: pressed(12) || axisY < -0.6,
        down: pressed(13) || axisY > 0.6,
        left: pressed(14) || axisX < -0.6,
        right: pressed(15) || axisX > 0.6,
        guide: pressed(16),
        combo: pressed(8) && pressed(9),
      };
      const edge = (name) => now[name] && !previous[name];

      if (pad.buttons.some((button) => button?.pressed)) {
        reportInput(detectPadKind(pad) === 'stick' ? 'stick' : 'pad', { name: padDisplayName(pad) });
      }

      if (opts.blocked) {
        previous = now;
        return;
      }

      if (edge('guide')) {
        if (opts.menuOpen) opts.closeMenu?.('pad');
        else opts.openMenu?.('pad');
      }

      if (now.combo) {
        if (!comboSince) comboSince = time;
        if (!comboFired && time - comboSince >= PAD_COMBO_HOLD_MS) {
          comboFired = true;
          if (opts.menuOpen) opts.closeMenu?.('pad');
          else opts.openMenu?.('pad');
        }
      } else {
        comboSince = 0;
        comboFired = false;
      }

      if (opts.menuOpen && !now.combo) {
        ['up', 'down', 'left', 'right'].forEach((direction) => {
          if (!now[direction]) {
            heldSince[direction] = 0;
            return;
          }
          if (edge(direction)) {
            heldSince[direction] = time;
            lastRepeat[direction] = time;
            opts.menuNavigate?.(direction);
          } else if (time - heldSince[direction] > 380 && time - lastRepeat[direction] > 140) {
            lastRepeat[direction] = time;
            opts.menuNavigate?.(direction);
          }
        });
        if (edge('a')) opts.menuActivate?.();
        if (edge('b')) opts.menuBack?.();
      }

      previous = now;
    }

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('pointerdown', handlePointerDown, true);
    frame = window.requestAnimationFrame(poll);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.cancelAnimationFrame(frame);
      if (escTimer) window.clearTimeout(escTimer);
    };
  }, [optionsRef]);
}
