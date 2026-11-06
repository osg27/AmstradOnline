import { useEffect, useRef, useState } from 'react';
import { assignPadsToPlayers, cpcMatrixMessage, readCpcPadMask } from './cpcGamepadControls';

const SOURCES = ['pad-p1', 'pad-p2'];
// After the game menu closes, input waits for all buttons to be released,
// but never longer than this (a resting analogue trigger can read as held).
const NEUTRAL_GUARD_MAX_MS = 1000;
function listPads() {
  try {
    return navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  } catch {
    return [];
  }
}

/**
 * Polls up to two local gamepads and sends each player's held CPC matrix
 * cells to CPCBox. Only runs while `enabled`, so it never doubles up with the
 * generic single-pad loop in RoomPage. Returns the connected pads for display.
 * Pad presses never update React state, so playing doesn't re-render the page.
 * While `menuOpenRef` is set, and afterwards until every button is released
 * (`neutralGuardRef`), pads send nothing, so closing the game menu with a
 * button doesn't leak that press into the game.
 */
export default function useCpcGamepads({ enabled, plan, forward, getMapping, menuOpenRef = null, neutralGuardRef = null, frameRef = null }) {
  const [connectedPads, setConnectedPads] = useState([]);
  // Callbacks and frame-reported pads live in refs so a re-render never
  // restarts the polling loop or drops the frame's latest pad report.
  const callbacksRef = useRef({ forward, getMapping });
  callbacksRef.current = { forward, getMapping };
  const framePadsRef = useRef({ pads: null, at: 0 });

  useEffect(() => {
    function handleFrameMessage(event) {
      if (event.origin !== window.location.origin || event.data?.type !== 'amstrad_gamepads') return;
      if (frameRef?.current && event.source !== frameRef.current.contentWindow) return;
      framePadsRef.current = { pads: Array.isArray(event.data.pads) ? event.data.pads : null, at: performance.now() };
    }
    window.addEventListener('message', handleFrameMessage);
    return () => window.removeEventListener('message', handleFrameMessage);
  }, [frameRef]);

  useEffect(() => {
    function refresh() {
      setConnectedPads(listPads().filter((pad) => pad?.connected).map((pad) => ({ index: pad.index, id: pad.id })));
    }
    refresh();
    window.addEventListener('gamepadconnected', refresh);
    window.addEventListener('gamepaddisconnected', refresh);
    return () => {
      window.removeEventListener('gamepadconnected', refresh);
      window.removeEventListener('gamepaddisconnected', refresh);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !plan) return undefined;

    let frame = 0;
    const lastSent = ['', ''];
    let guardSince = 0;
    // Pads reported by the CPCBox frame (see integration.js) while it has focus.
    function currentPads() {
      const frameFocused = frameRef?.current && document.activeElement === frameRef.current;
      const reported = framePadsRef.current;
      if (frameFocused && reported.pads && performance.now() - reported.at < 1000) {
        return reported.pads;
      }
      return listPads();
    }

    function send(slot, message) {
      const signature = JSON.stringify(message.cells);
      if (signature === lastSent[slot]) return;
      lastSent[slot] = signature;
      callbacksRef.current.forward(message);
    }

    function releaseAll() {
      SOURCES.forEach((source, slot) => send(slot, { type: 'amstrad_matrix_state', source, cells: [] }));
    }

    function poll() {
      const pads = currentPads();
      const slots = assignPadsToPlayers(pads, plan.swap);
      // A missing/disconnected pad reads as 0, which releases its keys.
      const masks = slots.map((pad) => (pad ? readCpcPadMask(pad, callbacksRef.current.getMapping?.(pad) || null) : 0));
      const menuOpen = Boolean(menuOpenRef?.current);
      if (neutralGuardRef?.current && !menuOpen) {
        guardSince ||= performance.now();
        if (masks.every((mask) => mask === 0) || performance.now() - guardSince > NEUTRAL_GUARD_MAX_MS) {
          neutralGuardRef.current = false;
        }
      }
      if (!neutralGuardRef?.current) guardSince = 0;
      const suspended = menuOpen || Boolean(neutralGuardRef?.current);
      masks.forEach((mask, slot) => {
        send(slot, cpcMatrixMessage(SOURCES[slot], suspended ? 0 : mask, plan.players[slot]));
      });
      frame = requestAnimationFrame(poll);
    }

    function handleVisibility() {
      // rAF stops in hidden tabs; release so nothing stays held meanwhile.
      if (document.visibilityState === 'hidden') releaseAll();
    }

    poll();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', handleVisibility);
      releaseAll();
    };
  }, [enabled, frameRef, menuOpenRef, neutralGuardRef, plan]);

  return connectedPads;
}
