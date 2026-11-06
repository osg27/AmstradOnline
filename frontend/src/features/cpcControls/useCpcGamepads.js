import { useEffect, useState } from 'react';
import { assignPadsToPlayers, cpcMatrixMessage, readCpcPadMask } from './cpcGamepadControls';

const SOURCES = ['pad-p1', 'pad-p2'];

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
 * While `menuOpenRef` is set, and afterwards until every button is released
 * (`neutralGuardRef`), pads send nothing, so closing the game menu with a
 * button doesn't leak that press into the game.
 */
export default function useCpcGamepads({ enabled, plan, forward, getMapping, menuOpenRef = null, neutralGuardRef = null }) {
  const [connectedPads, setConnectedPads] = useState([]);

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

    function send(slot, message) {
      const signature = JSON.stringify(message.cells);
      if (signature === lastSent[slot]) return;
      lastSent[slot] = signature;
      forward(message);
    }

    function releaseAll() {
      SOURCES.forEach((source, slot) => send(slot, { type: 'amstrad_matrix_state', source, cells: [] }));
    }

    function poll() {
      const slots = assignPadsToPlayers(listPads(), plan.swap);
      // A missing/disconnected pad reads as 0, which releases its keys.
      const masks = slots.map((pad) => (pad ? readCpcPadMask(pad, getMapping?.(pad) || null) : 0));
      const menuOpen = Boolean(menuOpenRef?.current);
      if (neutralGuardRef?.current && !menuOpen && masks.every((mask) => mask === 0)) {
        neutralGuardRef.current = false;
      }
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
  }, [enabled, forward, getMapping, menuOpenRef, neutralGuardRef, plan]);

  return connectedPads;
}
