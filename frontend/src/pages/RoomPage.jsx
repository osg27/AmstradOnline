import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';
import useSignaling from '../hooks/useSignaling';
import { buildRtcConfig, waitForIceGatheringComplete } from '../utils/webrtc';

const KICKSTART_DB_NAME = 'oldstylegaming-kickstarts';
const KICKSTART_STORE_NAME = 'roms';
const AMIGA_AGA_KICKSTART_KEY = 'amiga-aga-a1200-kickstart';

function openKickstartDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = window.indexedDB.open(KICKSTART_DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(KICKSTART_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open Kickstart storage'));
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Kickstart storage request failed'));
  });
}

async function saveStoredKickstart(key, fileName, bytes) {
  const db = await openKickstartDb();

  try {
    const transaction = db.transaction(KICKSTART_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(KICKSTART_STORE_NAME);
    await requestToPromise(store.put({ fileName, bytes }, key));
  } finally {
    db.close();
  }
}

async function loadStoredKickstart(key) {
  const db = await openKickstartDb();

  try {
    const transaction = db.transaction(KICKSTART_STORE_NAME, 'readonly');
    const store = transaction.objectStore(KICKSTART_STORE_NAME);
    const stored = await requestToPromise(store.get(key));

    if (!stored?.fileName || !stored?.bytes) return null;

    return {
      fileName: stored.fileName,
      bytes: new Uint8Array(stored.bytes),
    };
  } finally {
    db.close();
  }
}

export default function RoomPage() {
  const navigate = useNavigate();
  const { roomCode } = useParams();
  const [searchParams] = useSearchParams();
  const username = localStorage.getItem('username');
  const isSoloMode = searchParams.get('mode') === 'solo';

  const [room, setRoom] = useState(null);
  const [status, setStatus] = useState('Loading room...');
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [hostStarted, setHostStarted] = useState(false);
  const [guestPrepared, setGuestPrepared] = useState(false);
  const [loadedDiskName, setLoadedDiskName] = useState('');
  const [loadedAgaDiskCount, setLoadedAgaDiskCount] = useState(0);
  const [kickstartRomName, setKickstartRomName] = useState('');
  const [inputCaptured, setInputCaptured] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isScreenFullscreen, setIsScreenFullscreen] = useState(false);
  const [emulatorFrameLoadCount, setEmulatorFrameLoadCount] = useState(0);
  const [inputDebug, setInputDebug] = useState({
    mask: 0,
    source: 'none',
    events: [],
  });
  const [hostDisplayName, setHostDisplayName] = useState('');
  const [guestDisplayName, setGuestDisplayName] = useState('');
  const [activePartyPlayer, setActivePartyPlayer] = useState(1);
  const [partyPlayerNumber, setPartyPlayerNumber] = useState(null);
  const [partyRoster, setPartyRoster] = useState([]);

  const remoteMediaStreamRef = useRef(null);
  const remoteVoiceStreamRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteVoiceAudioRef = useRef(null);
  const emulatorFrameRef = useRef(null);
  const mirrorCanvasRef = useRef(null);
  const mirrorLoopRef = useRef(null);
  const fileInputRef = useRef(null);
  const swapDiskInputRef = useRef(null);
  const kickstartInputRef = useRef(null);
  const pcRef = useRef(null);
  const dataChannelRef = useRef(null);
  const handleGuestPayloadOnHostRef = useRef(null);
  const localOfferRef = useRef(null);
  const hostVideoStreamRef = useRef(null);
  const hostAudioStreamRef = useRef(null);
  const partyHostPeersRef = useRef(new Map());
  const pendingPartyGuestsRef = useRef(new Map());
  const hostStartingRef = useRef(false);
  const hostStartedRef = useRef(false);
  const guestPreparedRef = useRef(false);
  const gamepadIndexRef = useRef(null);
  const inputSessionIdRef = useRef(`${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const inputSequenceRef = useRef(0);
  const localJoystickMaskRef = useRef(0);
  const localMicStreamRef = useRef(null);
  const localMicSenderRef = useRef(null);
  const micRenegotiationNeededRef = useRef(false);
  const lastRemoteInputSessionRef = useRef('');
  const lastRemoteInputSeqRef = useRef(0);
  const lastRemoteInputAtRef = useRef(0);
  const remoteJoystickMaskRef = useRef(0);
  const pendingIceCandidatesRef = useRef([]);
  const isHostRef = useRef(false);
  const signalingClientIdRef = useRef(window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const activeGuestSignalIdRef = useRef('');
  const activePeerSignalIdRef = useRef('');
  const sentStoredKickstartFrameRef = useRef(0);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [micStatus, setMicStatus] = useState('Mic off');
  const [micDevices, setMicDevices] = useState([]);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState('');
  const [arcadeDriver, setArcadeDriver] = useState('');
  const [arcadeRuntime, setArcadeRuntime] = useState('mamepacmantest.js');
  const [arcadeArgs, setArcadeArgs] = useState('');

  const userId = useMemo(() => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return Number(payload.sub);
    } catch {
      return null;
    }
  }, []);

  const isHost = room ? room.owner_user_id === userId : null;
  const roomSystem = room?.system || 'cpc';
  const isCpcParty = roomSystem === 'cpc_party';
  const isSpectrum = roomSystem === 'spectrum';
  const isAmiga = roomSystem === 'amiga';
  const isAmigaAga = roomSystem === 'amiga_aga';
  const isAmigaFamily = isAmiga || isAmigaAga;
  const isMegaDrive = roomSystem === 'megadrive';
  const isSnes = roomSystem === 'snes';
  const isArcade = roomSystem === 'arcade';
  const kickstartStorageKey = isAmigaAga ? AMIGA_AGA_KICKSTART_KEY : '';
  const partyMaxPlayers = Math.min(8, Math.max(2, Number(room?.party_max_players) || 2));
  const currentPartyPlayerNumber = isHost ? 1 : partyPlayerNumber || 2;
  const systemLabel = isCpcParty ? 'Amstrad CPC Party' : isAmigaAga ? 'Amiga AGA' : isAmiga ? 'Amiga' : isMegaDrive ? 'Mega Drive' : isSnes ? 'SNES' : isArcade ? 'MAME Arcade' : isSpectrum ? 'ZX Spectrum' : 'Amstrad CPC';
  const emulatorSrc = isAmigaAga
    ? '/amiga-aga/launcher.html?v=2026-06-06-7'
    : isAmiga
    ? '/amiga/launcher.html?v=2026-06-01-1'
    : isMegaDrive ? '/megadrive/launcher.html?v=2026-06-01-1' : isSnes ? '/snes/launcher.html?v=2026-06-01-2' : isArcade ? '/arcade/launcher.html?v=2026-06-04-8' : isSpectrum ? '/spectrum/index.html?v=2026-06-01-2' : '/emulator/index.html?v=2026-06-01-1';
  const emulatorTitle = `${systemLabel} Emulator`;
  const acceptedMedia = isAmigaFamily
    ? '.uae,.adf,.adz,.dms,.hdf,.hdz,.lha,.zip'
    : isMegaDrive ? '.bin,.gen,.md,.smd' : isSnes ? '.sfc,.smc,.fig,.swc,.bsx,.gd3,.gd7,.dx2' : isArcade ? '.zip' : isSpectrum ? '.tap,.tzx,.z80,.sna,.szx,.zip' : '.dsk';
  const mediaLabel = isAmigaAga ? 'Load Amiga AGA file' : isAmiga ? 'Load Amiga file' : isMegaDrive ? 'Load Mega Drive ROM' : isSnes ? 'Load SNES ROM' : isArcade ? 'Load MAME ROM' : isSpectrum ? 'Load Spectrum file' : 'Load .dsk';
  const controlLabel = !room
    ? 'Loading controls'
    : isSoloMode
      ? isAmigaFamily
        ? 'P1 Amiga controls + keyboard/mouse'
        : isMegaDrive ? 'P1 controller 1 / A B C / Start' : isSnes ? 'P1 controller 1 / B Y A / Start' : isArcade ? 'P1 arcade controls' : isSpectrum ? 'P1 Sinclair controls' : isCpcParty ? `P${currentPartyPlayerNumber} / turn: P${activePartyPlayer}` : 'Cursor keys + X / Z'
      : isAmigaFamily
      ? 'P1 port 2 / P2 port 1 + keyboard/mouse'
      : isMegaDrive ? (isHost ? 'P1 controller 1 / A B C / Start' : 'P2 controller 2 / A B C / Start') : isSnes ? (isHost ? 'P1 controller 1 / B Y A / Start' : 'P2 controller 2 / B Y A / Start') : isArcade ? (isHost ? 'P1 arcade controls' : 'P2 arcade controls') : isSpectrum ? 'P1 Sinclair 1 / P2 Sinclair 2' : isCpcParty ? `You: P${currentPartyPlayerNumber} / turn: P${activePartyPlayer}` : isHost ? 'Cursor keys + X / Z' : 'Q A O P / F / G';
  const roleLabel = !room
    ? 'Loading...'
    : isSoloMode ? 'Solo' : isHost ? 'Host' : 'Guest';
  const playerOneName = hostDisplayName || (isHost ? username : 'Host');
  const playerTwoName = guestDisplayName || (!isHost ? username : 'Guest');
  const normalPlayerSummary = `P1: ${playerOneName} / P2: ${playerTwoName}`;
  const assignedControlLabel = isSoloMode
    ? `P1: ${username || playerOneName}`
    : isCpcParty
    ? `You: P${currentPartyPlayerNumber} / turn: P${activePartyPlayer}`
    : isMegaDrive || isSnes || isArcade
      ? `${isHost ? `P1: ${playerOneName}` : `P2: ${playerTwoName}`} / controller ${isHost ? '1' : '2'}`
      : isHost
        ? `P1: ${playerOneName}`
        : `P2: ${playerTwoName}`;
  const partyPlayerNameByNumber = useMemo(() => {
    const names = new Map();
    partyRoster.forEach((player) => {
      names.set(player.playerNumber, player.username);
    });
    return names;
  }, [partyRoster]);
  const activePartyPlayerName = partyPlayerNameByNumber.get(activePartyPlayer);

  useEffect(() => {
    isHostRef.current = isHost === true;
  }, [isHost]);

  useEffect(() => {
    setEmulatorFrameLoadCount(0);
    sentStoredKickstartFrameRef.current = 0;
  }, [emulatorSrc]);

  useEffect(() => {
    if (isCpcParty || !navigator.mediaDevices?.addEventListener) {
      return undefined;
    }

    const handleDeviceChange = () => {
      refreshMicrophoneDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    refreshMicrophoneDevices();

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [isCpcParty]);

  useEffect(() => {
    if (!room || !username) return;

    if (isHost) {
      setHostDisplayName(username);
    } else {
      setGuestDisplayName(username);
    }
  }, [isHost, room, username]);

  useEffect(() => {
    if (!isCpcParty || !isHost) {
      setPartyRoster([]);
      return;
    }

    refreshPartyRoster();
  }, [isCpcParty, isHost, username]);

  const addLog = useCallback((message) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()} - ${message}`, ...prev].slice(0, 80));
  }, []);

  const sendSignalRef = useRef(() => false);

  const addInputDebug = useCallback((message, mask = null, source = null) => {
    setInputDebug((prev) => ({
      mask: mask ?? prev.mask,
      source: source ?? prev.source,
      events: [`${new Date().toLocaleTimeString()} - ${message}`, ...prev.events].slice(0, 14),
    }));
  }, []);

  function shouldHandleKey(event) {
    const tag = event.target?.tagName?.toLowerCase();

    return (
      tag !== 'input'
      && tag !== 'textarea'
      && tag !== 'button'
      && tag !== 'a'
      && !event.metaKey
      && (!event.altKey || event.key === 'Alt')
    );
  }

  function shouldHandleHostKey(event) {
    const tag = event.target?.tagName?.toLowerCase();

    return (
      tag !== 'input'
      && tag !== 'textarea'
      && tag !== 'select'
      && !event.target?.isContentEditable
      && !event.metaKey
      && !event.altKey
    );
  }

  function getKeyboardKey(event) {
    if (event.code === 'Space' || event.key === 'Spacebar' || event.keyCode === 32) {
      return ' ';
    }

    return event.key;
  }

  function keyToJoystickBit(key) {
    switch (key) {
      case 'q':
      case 'Q':
        return 1;
      case 'a':
      case 'A':
        return 2;
      case 'o':
      case 'O':
        return 4;
      case 'p':
      case 'P':
        return 8;
      case 'f':
      case 'F':
        return 16;
      case 'g':
      case 'G':
        return 32;
      default:
        return 0;
    }
  }

  function gamepadToJoystickMask(pad, system = roomSystem) {
    let mask = 0;
    const deadzone = 0.45;

    const left = pad.buttons[14]?.pressed || (pad.axes[0] ?? 0) < -deadzone;
    const right = pad.buttons[15]?.pressed || (pad.axes[0] ?? 0) > deadzone;
    const up = pad.buttons[12]?.pressed || (pad.axes[1] ?? 0) < -deadzone;
    const down = pad.buttons[13]?.pressed || (pad.axes[1] ?? 0) > deadzone;
    const isMultiButtonSystem = system === 'megadrive' || system === 'snes' || system === 'arcade';
    const fire = isMultiButtonSystem
      ? pad.buttons[0]?.pressed
      : [0, 1].some((index) => pad.buttons[index]?.pressed);
    const extra = isMultiButtonSystem
      ? pad.buttons[1]?.pressed
      : [2, 3].some((index) => pad.buttons[index]?.pressed);
    const third = isMultiButtonSystem && pad.buttons[2]?.pressed;
    const start = [7, 9].some((index) => pad.buttons[index]?.pressed);

    if (up) mask |= 1;
    if (down) mask |= 2;
    if (left) mask |= 4;
    if (right) mask |= 8;
    if (fire) mask |= 16;
    if (extra) mask |= 32;
    if (start) mask |= 64;
    if (third) mask |= 128;

    return mask;
  }

  function joystickMaskToLabels(mask) {
    return [
      ['Up', Boolean(mask & 1)],
      ['Down', Boolean(mask & 2)],
      ['Left', Boolean(mask & 4)],
      ['Right', Boolean(mask & 8)],
      ['Fire', Boolean(mask & 16)],
      ['Extra', Boolean(mask & 32)],
      ['Start', Boolean(mask & 64)],
      ['Third', Boolean(mask & 128)],
    ];
  }

  function formatInputPayload(payload) {
    if (!payload) return 'empty payload';

    if (payload.type === 'control') {
      return `P${payload.player} ${payload.key} ${payload.action}`;
    }

    if (payload.type === 'key') {
      return `P${payload.player} key ${payload.key} ${payload.action}`;
    }

    if (payload.type === 'joystick') {
      return `P${payload.player} mask ${payload.mask}`;
    }

    if (payload.type === 'input_state') {
      return `P${payload.player} state ${payload.mask} #${payload.seq}`;
    }

    if (payload.type === 'amiga_mouse_button') {
      return `Amiga mouse button ${payload.button} ${payload.action}`;
    }

    if (payload.type === 'amiga_mouse_move') {
      return `Amiga mouse move ${payload.movementX},${payload.movementY}`;
    }

    return `${payload.type || 'unknown'} input`;
  }

  function joystickMaskToKeys(mask, player) {
    const keys = player === 1
      ? { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', fire: 'x', extra: 'z' }
      : { up: 'q', down: 'a', left: 'o', right: 'p', fire: 'f', extra: 'g' };

    return [
      [keys.up, 1, Boolean(mask & 1)],
      [keys.down, 2, Boolean(mask & 2)],
      [keys.left, 4, Boolean(mask & 4)],
      [keys.right, 8, Boolean(mask & 8)],
      [keys.fire, 16, Boolean(mask & 16)],
      [keys.extra, 32, Boolean(mask & 32)],
    ];
  }

  function hostKeyToCpcKeyboardKey(key) {
    switch (key) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
      case ' ':
        return key;
      case 'q':
      case 'Q':
        return 'q';
      case 'a':
      case 'A':
        return 'a';
      case 'o':
      case 'O':
        return 'o';
      case 'p':
      case 'P':
        return 'p';
      case 'f':
      case 'F':
        return 'f';
      case 'Enter':
        return 'Enter';
      case 'Tab':
        return 'Tab';
      case 'CapsLock':
        return 'CapsLock';
      case 'Control':
      case 'ControlLeft':
      case 'ControlRight':
        return 'Control';
      case 'Alt':
      case 'AltLeft':
      case 'AltRight':
        return 'Alt';
      case 'Shift':
      case 'ShiftLeft':
      case 'ShiftRight':
        return 'Shift';
      case 'Backspace':
        return 'Backspace';
      case 'Delete':
        return 'Delete';
      case 'Escape':
        return 'Escape';
      case 'Home':
        return 'Home';
      case 'End':
        return 'End';
      case 'PageUp':
        return 'PageUp';
      case 'PageDown':
        return 'PageDown';
      case 'F1':
      case 'F2':
      case 'F3':
      case 'F4':
      case 'F5':
      case 'F6':
      case 'F7':
      case 'F8':
      case 'F9':
      case 'F10':
      case 'F11':
      case 'F12':
        return key;
      default:
        return key.length === 1 ? key : null;
    }
  }

  function isMenuKey(key) {
    return [
      'Enter',
      'Tab',
      'CapsLock',
      'Shift',
      'ShiftLeft',
      'ShiftRight',
      'Control',
      'ControlLeft',
      'ControlRight',
      'Alt',
      'AltLeft',
      'AltRight',
      'Backspace',
      'Delete',
      'Escape',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'F1',
      'F2',
      'F3',
      'F4',
      'F5',
      'F6',
      'F7',
      'F8',
      'F9',
      'F10',
      'F11',
      'F12',
      ' ',
    ].includes(key);
  }

  function isGuestKeyboardKey(key) {
    return isMenuKey(key) || key.length === 1;
  }

  const forwardInputToEmulator = useCallback((payload) => {
    const frame = emulatorFrameRef.current;
    const targetWindow = frame?.contentWindow;

    if (!targetWindow) return;

    targetWindow.postMessage(payload, window.location.origin);
  }, []);

  useEffect(() => {
    function handleArcadeMessage(event) {
      if (event.origin !== window.location.origin) return;

      const message = event.data || {};
      if (message.type !== 'arcade_log') return;

      const prefix = message.level === 'error' ? 'Arcade error' : 'Arcade';
      addLog(`${prefix}: ${message.message}`);
    }

    window.addEventListener('message', handleArcadeMessage);

    return () => {
      window.removeEventListener('message', handleArcadeMessage);
    };
  }, [addLog]);

  useEffect(() => {
    if (!isHost || !emulatorFrameLoadCount || !kickstartStorageKey) return undefined;
    if (sentStoredKickstartFrameRef.current === emulatorFrameLoadCount) return undefined;

    let cancelled = false;
    sentStoredKickstartFrameRef.current = emulatorFrameLoadCount;
    const timer = window.setTimeout(async () => {
      try {
        const storedKickstart = await loadStoredKickstart(kickstartStorageKey);

        if (cancelled || !storedKickstart) return;

        forwardInputToEmulator({
          type: 'amiga_kickstart',
          fileName: storedKickstart.fileName,
          bytes: storedKickstart.bytes,
        });
        setKickstartRomName(`${storedKickstart.fileName} (saved)`);
        addLog(`Loaded saved Kickstart ROM: ${storedKickstart.fileName}`);
      } catch (err) {
        if (!cancelled) {
          addLog(`Saved Kickstart unavailable: ${err.message}`);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [addLog, emulatorFrameLoadCount, forwardInputToEmulator, isHost, kickstartStorageKey]);

  const forwardExtraButtonAsKey = useCallback((mask, player, previousMask) => {
    const extraBit = 32;
    const active = Boolean(mask & extraBit);
    const wasActive = Boolean(previousMask & extraBit);

    if (active === wasActive) return;

    const key = player === 1 ? 'z' : 'g';
    const action = active ? 'down' : 'up';

    addInputDebug(`forward P${player} extra key ${key} ${action}`, mask, player === 1 ? 'host local' : 'guest remote');
    if (active) {
      forwardInputToEmulator({
        type: 'amstrad_remote_input',
        player,
        key,
        action,
      });
    }

    forwardInputToEmulator({
      type: 'amstrad_remote_control',
      player,
      key,
      action,
    });
  }, [addInputDebug, forwardInputToEmulator]);

  const forwardJoystickMaskAsKeys = useCallback((mask, player, previousMask) => {
    joystickMaskToKeys(mask, player).forEach(([key, bit, active]) => {
      const wasActive = Boolean(previousMask & bit);

      if (active === wasActive) return;

      const action = active ? 'down' : 'up';

      addInputDebug(`forward held P${player} key ${key} ${action}`, mask, 'shared joystick');
      if (active && key.length === 1) {
        forwardInputToEmulator({
          type: 'amstrad_remote_input',
          player,
          key,
          action,
        });
      }

      forwardInputToEmulator({
        type: 'amstrad_remote_control',
        player,
        key,
        action,
      });
    });
  }, [addInputDebug, forwardInputToEmulator]);

  const releaseCpcPartySharedInput = useCallback((previousMask = 63) => {
    if (!isCpcParty) return;

    forwardJoystickMaskAsKeys(0, 1, previousMask);
    forwardInputToEmulator({
      type: 'amstrad_remote_joystick',
      player: 1,
      mask: 0,
    });
    forwardInputToEmulator({
      type: 'amstrad_remote_joystick',
      player: 2,
      mask: 0,
    });
  }, [forwardInputToEmulator, forwardJoystickMaskAsKeys, isCpcParty]);

  const sendLocalJoystickMask = useCallback((mask) => {
    const player = isHost ? 1 : 2;
    const joystickMask = isAmigaFamily || isMegaDrive || isSnes || isArcade ? mask : mask & 31;
    const previousMask = localJoystickMaskRef.current;
    const payload = {
      type: 'joystick',
      player,
      mask,
    };

    addInputDebug(`local P${player} joystick mask ${mask}`, mask, isHost ? 'host local' : 'guest local');

    if (isHost) {
      if (isCpcParty && activePartyPlayer !== 1) {
        if (previousMask) {
          releaseCpcPartySharedInput(previousMask);
        }
        localJoystickMaskRef.current = 0;
        addInputDebug(`ignored host input, party turn is P${activePartyPlayer}`, 0, 'party turn');
        return;
      }

      if (isCpcParty) {
        forwardInputToEmulator({
          type: 'amstrad_remote_joystick',
          player: 1,
          mask: joystickMask,
        });
        forwardExtraButtonAsKey(mask, 1, previousMask);
        localJoystickMaskRef.current = mask;
        return;
      }

      forwardInputToEmulator({
        type: 'amstrad_remote_joystick',
        player,
        mask: joystickMask,
      });
      if (!isAmigaFamily && !isMegaDrive && !isSnes && !isArcade) {
        forwardExtraButtonAsKey(mask, player, previousMask);
      }
      localJoystickMaskRef.current = mask;
      return;
    }

    const channel = dataChannelRef.current;
    if (channel?.readyState === 'open') {
      localJoystickMaskRef.current = mask;
      const statePayload = {
        type: 'input_state',
        player,
        sessionId: inputSessionIdRef.current,
        seq: inputSequenceRef.current + 1,
        mask,
        ts: performance.now(),
      };

      inputSequenceRef.current = statePayload.seq;
      addInputDebug(`send to host ${formatInputPayload(statePayload)}`);
      channel.send(JSON.stringify(statePayload));
    } else {
      addInputDebug(`not sent, channel closed ${formatInputPayload(payload)}`);
    }
  }, [activePartyPlayer, addInputDebug, forwardExtraButtonAsKey, forwardInputToEmulator, isAmigaFamily, isArcade, isCpcParty, isHost, isMegaDrive, isSnes, releaseCpcPartySharedInput]);

  const releaseInputCapture = useCallback(() => {
    sendLocalJoystickMask(0);
    setInputCaptured(false);
    if (document.pointerLockElement && document.exitPointerLock) {
      document.exitPointerLock();
    }
  }, [sendLocalJoystickMask]);

  const captureInput = useCallback((event = null) => {
    setInputCaptured(true);
    forwardInputToEmulator({
      type: 'amstrad_audio_unlock',
    });

    const captureTarget = event?.currentTarget;
    if (
      isAmigaFamily
      && captureTarget
      && ['CANVAS', 'VIDEO'].includes(captureTarget.tagName)
      && document.pointerLockElement !== captureTarget
    ) {
      captureTarget.requestPointerLock?.();
    }

    const channel = dataChannelRef.current;
    if (!isHost && channel?.readyState === 'open') {
      channel.send(JSON.stringify({ type: 'audio_unlock' }));
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = false;
      remoteVideoRef.current.volume = 1;
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [forwardInputToEmulator, isAmigaFamily, isHost]);

  const forwardAmigaMouse = useCallback((payload) => {
    if (!isAmigaFamily) return;

    if (isHost) {
      forwardInputToEmulator(payload);
      return;
    }

    const channel = dataChannelRef.current;
    if (channel?.readyState === 'open') {
      channel.send(JSON.stringify(payload));
    }
  }, [forwardInputToEmulator, isAmigaFamily, isHost]);

  const handleAmigaPointerDown = useCallback((event) => {
    if (!isAmigaFamily) return;

    captureInput();
    const button = event.button === 2 ? 3 : 1;
    const payload = {
      type: 'amiga_mouse_button',
      button,
      action: 'down',
    };

    addInputDebug(`Amiga mouse button ${button} down`, null, isHost ? 'host mouse' : 'guest mouse');
    forwardAmigaMouse(payload);
    event.preventDefault();
  }, [addInputDebug, captureInput, forwardAmigaMouse, isAmigaFamily, isHost]);

  const handleAmigaPointerUp = useCallback((event) => {
    if (!isAmigaFamily) return;

    const button = event.button === 2 ? 3 : 1;
    const payload = {
      type: 'amiga_mouse_button',
      button,
      action: 'up',
    };

    addInputDebug(`Amiga mouse button ${button} up`, null, isHost ? 'host mouse' : 'guest mouse');
    forwardAmigaMouse(payload);
    event.preventDefault();
  }, [addInputDebug, forwardAmigaMouse, isAmigaFamily, isHost]);

  const handleAmigaPointerMove = useCallback((event) => {
    if (!isAmigaFamily || !inputCaptured) return;
    if (!event.movementX && !event.movementY) return;

    forwardAmigaMouse({
      type: 'amiga_mouse_move',
      movementX: event.movementX,
      movementY: event.movementY,
    });
  }, [forwardAmigaMouse, inputCaptured, isAmigaFamily]);

  useEffect(() => {
    if (!isAmigaFamily || !inputCaptured) return undefined;

    function handleLockedMouseMove(event) {
      if (!document.pointerLockElement) return;
      if (!event.movementX && !event.movementY) return;

      forwardAmigaMouse({
        type: 'amiga_mouse_move',
        movementX: event.movementX,
        movementY: event.movementY,
      });
    }

    window.addEventListener('mousemove', handleLockedMouseMove);

    return () => {
      window.removeEventListener('mousemove', handleLockedMouseMove);
    };
  }, [forwardAmigaMouse, inputCaptured, isAmigaFamily]);

  const sendAmigaMouseClick = useCallback((button) => {
    if (!isAmigaFamily) return;

    captureInput();
    addInputDebug(`Amiga mouse button ${button} pulse`, null, isHost ? 'host mouse' : 'guest mouse');
    forwardAmigaMouse({
      type: 'amiga_mouse_button',
      button,
      action: 'down',
    });
    window.setTimeout(() => {
      forwardAmigaMouse({
        type: 'amiga_mouse_button',
        button,
        action: 'up',
      });
    }, 140);
  }, [addInputDebug, captureInput, forwardAmigaMouse, isAmigaFamily, isHost]);

  const setPartyTurn = useCallback((playerNumber) => {
    if (!isCpcParty || !isHost) return;

    const nextPlayer = Math.min(partyMaxPlayers, Math.max(1, playerNumber));

    if (localJoystickMaskRef.current) {
      releaseCpcPartySharedInput(localJoystickMaskRef.current);
      localJoystickMaskRef.current = 0;
    }

    if (remoteJoystickMaskRef.current) {
      releaseCpcPartySharedInput(remoteJoystickMaskRef.current);
      remoteJoystickMaskRef.current = 0;
    }

    for (const peer of partyHostPeersRef.current.values()) {
      if (!peer.joystickMask) continue;
      releaseCpcPartySharedInput(peer.joystickMask);
      peer.joystickMask = 0;
    }

    releaseCpcPartySharedInput();
    setActivePartyPlayer(nextPlayer);
    sendSignalRef.current({
      type: 'party-turn',
      playerNumber: nextPlayer,
    });
    addInputDebug(`party turn switched to P${nextPlayer}`, 0, 'party turn');
    addLog(`Party turn switched to player ${nextPlayer}`);
  }, [addInputDebug, addLog, isCpcParty, isHost, partyMaxPlayers, releaseCpcPartySharedInput]);

  const nextPartyTurn = useCallback(() => {
    setPartyTurn(activePartyPlayer >= partyMaxPlayers ? 1 : activePartyPlayer + 1);
  }, [activePartyPlayer, partyMaxPlayers, setPartyTurn]);

  useEffect(() => {
    if (!inputCaptured) {
      return undefined;
    }

    let animationFrame = 0;
    let lastMask = -1;

    function findGamepad(pads) {
      if (gamepadIndexRef.current !== null && pads[gamepadIndexRef.current]) {
        return pads[gamepadIndexRef.current];
      }

      const pad = pads.find(Boolean);
      if (pad) {
        gamepadIndexRef.current = pad.index;
      }

      return pad;
    }

    function pollGamepad() {
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      const pad = findGamepad(pads);

      if (pad) {
        const mask = gamepadToJoystickMask(pad);

        if (mask !== lastMask) {
          lastMask = mask;
          sendLocalJoystickMask(mask);
        }
      }

      animationFrame = requestAnimationFrame(pollGamepad);
    }

    pollGamepad();

    return () => {
      cancelAnimationFrame(animationFrame);
      sendLocalJoystickMask(0);
    };
  }, [inputCaptured, sendLocalJoystickMask]);

  useEffect(() => {
    function handleGamepadConnected(event) {
      gamepadIndexRef.current = event.gamepad.index;
      addLog(`Gamepad connected: ${event.gamepad.id}`);
    }

    function handleGamepadDisconnected(event) {
      if (gamepadIndexRef.current === event.gamepad.index) {
        gamepadIndexRef.current = null;
        sendLocalJoystickMask(0);
      }

      addLog('Gamepad disconnected');
    }

    window.addEventListener('gamepadconnected', handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnected);

    return () => {
      window.removeEventListener('gamepadconnected', handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnected);
    };
  }, [addLog, sendLocalJoystickMask]);

  useEffect(() => {
    if (isHost !== false || !inputCaptured) {
      return undefined;
    }

    const sendSnapshot = () => {
      const mask = localJoystickMaskRef.current;
      const channel = dataChannelRef.current;

      if (channel?.readyState !== 'open') return;

      inputSequenceRef.current += 1;
      channel.send(JSON.stringify({
        type: 'input_state',
        player: 2,
        sessionId: inputSessionIdRef.current,
        seq: inputSequenceRef.current,
        mask,
        ts: performance.now(),
      }));
    };

    const snapshotTimer = window.setInterval(sendSnapshot, 33);
    sendSnapshot();

    return () => {
      window.clearInterval(snapshotTimer);
    };
  }, [inputCaptured, isHost]);

  useEffect(() => {
    if (isHost !== true) {
      return undefined;
    }

    const staleRemoteInputTimer = window.setInterval(() => {
      if (isCpcParty) {
        for (const peer of partyHostPeersRef.current.values()) {
          if (!peer.joystickMask) continue;
          if (!peer.lastInputAt) continue;
          if (performance.now() - peer.lastInputAt < 180) continue;

          addInputDebug(`P${peer.playerNumber} input timed out, releasing held input`, 0, 'guest remote');
          releaseCpcPartySharedInput(peer.joystickMask);
          peer.joystickMask = 0;
        }
        return;
      }

      if (remoteJoystickMaskRef.current === 0) return;
      if (!lastRemoteInputAtRef.current) return;
      if (performance.now() - lastRemoteInputAtRef.current < 180) return;

      const previousMask = remoteJoystickMaskRef.current;

      addInputDebug('guest input timed out, releasing held input', 0, 'guest remote');
      if (isAmigaFamily || isMegaDrive || isSnes || isArcade) {
        forwardInputToEmulator({
          type: 'amstrad_remote_joystick',
          player: 2,
          mask: 0,
        });
      } else {
        forwardJoystickMaskAsKeys(0, isCpcParty ? 1 : 2, previousMask);
      }
      remoteJoystickMaskRef.current = 0;
    }, 90);

    return () => {
      window.clearInterval(staleRemoteInputTimer);
    };
  }, [addInputDebug, forwardInputToEmulator, forwardJoystickMaskAsKeys, isAmigaFamily, isArcade, isCpcParty, isHost, isMegaDrive, isSnes, releaseCpcPartySharedInput]);

  useEffect(() => {
    if (isHost !== true || isAmigaFamily || isMegaDrive || isSnes || isArcade) {
      return undefined;
    }

    const pumpRemoteHeldKeys = window.setInterval(() => {
      if (isCpcParty) {
        const activePeer = Array.from(partyHostPeersRef.current.values()).find((peer) => peer.playerNumber === activePartyPlayer);
        const mask = activePeer?.joystickMask || 0;

        if (!mask) return;

        forwardInputToEmulator({
          type: 'amstrad_remote_joystick',
          player: 1,
          mask: mask & 31,
        });
        return;
      }

      const mask = remoteJoystickMaskRef.current;

      if (!mask) return;

      joystickMaskToKeys(mask, 2).forEach(([key, , active]) => {
        if (!active) return;

        forwardInputToEmulator({
          type: 'amstrad_remote_input',
          player: 2,
          key,
          action: 'down',
        });
        forwardInputToEmulator({
          type: 'amstrad_remote_control',
          player: 2,
          key,
          action: 'down',
        });
      });
    }, 50);

    return () => {
      window.clearInterval(pumpRemoteHeldKeys);
    };
  }, [activePartyPlayer, forwardInputToEmulator, isAmigaFamily, isArcade, isCpcParty, isHost, isMegaDrive, isSnes]);

  useEffect(() => {
    if (isHost !== false) {
      return undefined;
    }

    function releaseGuestInput() {
      sendLocalJoystickMask(0);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        releaseGuestInput();
      }
    }

    window.addEventListener('blur', releaseGuestInput);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('blur', releaseGuestInput);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isHost, sendLocalJoystickMask]);

  const handleGuestPayloadOnHost = useCallback((rawMessage, partyPlayerOverride = null, partyPeerState = null) => {
    try {
      const parsed = JSON.parse(rawMessage);
      addInputDebug(`host received ${formatInputPayload(parsed)}`, parsed.mask ?? null, 'guest remote');

      const getRemoteMask = () => (partyPeerState ? partyPeerState.joystickMask || 0 : remoteJoystickMaskRef.current);
      const setRemoteMask = (mask) => {
        if (partyPeerState) {
          partyPeerState.joystickMask = mask;
        } else {
          remoteJoystickMaskRef.current = mask;
        }
      };
      const getLastSession = () => (partyPeerState ? partyPeerState.lastSession || '' : lastRemoteInputSessionRef.current);
      const setLastSession = (sessionId) => {
        if (partyPeerState) {
          partyPeerState.lastSession = sessionId;
        } else {
          lastRemoteInputSessionRef.current = sessionId;
        }
      };
      const getLastSeq = () => (partyPeerState ? partyPeerState.lastSeq || 0 : lastRemoteInputSeqRef.current);
      const setLastSeq = (seq) => {
        if (partyPeerState) {
          partyPeerState.lastSeq = seq;
        } else {
          lastRemoteInputSeqRef.current = seq;
        }
      };
      const markInputAt = () => {
        if (partyPeerState) {
          partyPeerState.lastInputAt = performance.now();
        } else {
          lastRemoteInputAtRef.current = performance.now();
        }
      };

      if (parsed.type === 'key') {
        const player = isCpcParty ? partyPlayerOverride || 2 : parsed.player;

        if (isCpcParty && activePartyPlayer !== player) {
          addInputDebug(`ignored guest key, party turn is P${activePartyPlayer}`, null, 'party turn');
          return;
        }

        addInputDebug(`forward to emulator ${formatInputPayload(parsed)}`);
        forwardInputToEmulator({
          type: 'amstrad_remote_input',
          key: parsed.key,
          action: parsed.action,
          player: isCpcParty ? 1 : player,
        });
      }

      if (parsed.type === 'control') {
        const player = isCpcParty ? partyPlayerOverride || 2 : parsed.player;

        if (isCpcParty && activePartyPlayer !== player) {
          addInputDebug(`ignored guest control, party turn is P${activePartyPlayer}`, null, 'party turn');
          return;
        }

        addInputDebug(`forward to emulator ${formatInputPayload(parsed)}`);
        forwardInputToEmulator({
          type: 'amstrad_remote_control',
          key: parsed.key,
          action: parsed.action,
          player: isCpcParty ? 1 : player,
        });
      }

      if (parsed.type === 'audio_unlock') {
        addInputDebug('guest requested host audio unlock', null, 'guest remote');
        forwardInputToEmulator({
          type: 'amstrad_audio_unlock',
        });
      }

      if (parsed.type === 'amiga_mouse_button' || parsed.type === 'amiga_mouse_move') {
        addInputDebug(`forward to emulator ${formatInputPayload(parsed)}`, null, 'guest mouse');
        forwardInputToEmulator(parsed);
      }

      if (parsed.type === 'input_state') {
        const player = isCpcParty ? partyPlayerOverride || 2 : parsed.player === 2 ? 2 : 1;
        const mask = parsed.mask | 0;
        const seq = Number(parsed.seq) || 0;
        const sessionId = String(parsed.sessionId || 'legacy');

        if (sessionId !== getLastSession()) {
          const previousMask = getRemoteMask();

          if (previousMask) {
            if (isCpcParty) {
              releaseCpcPartySharedInput(previousMask);
            } else if (isAmigaFamily || isMegaDrive || isSnes || isArcade) {
              forwardInputToEmulator({
                type: 'amstrad_remote_joystick',
                player,
                mask: 0,
              });
            } else {
              forwardJoystickMaskAsKeys(0, player, previousMask);
            }
          }

          setLastSession(sessionId);
          setLastSeq(0);
          setRemoteMask(0);
          addInputDebug(`guest input session ${sessionId}`, 0, 'guest remote');
        }

        if (seq && seq <= getLastSeq()) {
          addInputDebug(`ignored old P${player} state #${seq}`, getRemoteMask(), 'guest remote');
          return;
        }

        const previousMask = getRemoteMask();

        setLastSeq(seq || getLastSeq());
        markInputAt();
        if (mask !== previousMask) {
          addInputDebug(`host received P${player} state ${mask} #${seq}`, mask, 'guest remote');
        }
        if (isCpcParty && activePartyPlayer !== player) {
          if (previousMask) {
            releaseCpcPartySharedInput(previousMask);
          }
          setRemoteMask(0);
          addInputDebug(`ignored guest state, party turn is P${activePartyPlayer}`, 0, 'party turn');
          return;
        }

        if (isCpcParty) {
          forwardInputToEmulator({
            type: 'amstrad_remote_joystick',
            player: 1,
            mask: mask & 31,
          });
          forwardExtraButtonAsKey(mask, 1, previousMask);
        } else if (isAmigaFamily || isMegaDrive || isSnes || isArcade) {
          forwardInputToEmulator({
            type: 'amstrad_remote_joystick',
            player,
            mask,
          });
        } else {
          forwardJoystickMaskAsKeys(mask, isCpcParty ? 1 : player, previousMask);
        }
        setRemoteMask(mask);
      }

      if (parsed.type === 'joystick') {
        const player = isCpcParty ? partyPlayerOverride || 2 : parsed.player === 2 ? 2 : 1;
        const mask = parsed.mask | 0;
        const previousMask = getRemoteMask();

        markInputAt();
        addInputDebug(`host received P${player} held mask ${mask}`, mask, 'guest remote');
        if (isCpcParty && activePartyPlayer !== player) {
          if (previousMask) {
            releaseCpcPartySharedInput(previousMask);
          }
          setRemoteMask(0);
          addInputDebug(`ignored guest held mask, party turn is P${activePartyPlayer}`, 0, 'party turn');
          return;
        }

        if (isCpcParty) {
          forwardInputToEmulator({
            type: 'amstrad_remote_joystick',
            player: 1,
            mask: mask & 31,
          });
          forwardExtraButtonAsKey(mask, 1, previousMask);
        } else if (isAmigaFamily || isMegaDrive || isSnes || isArcade) {
          forwardInputToEmulator({
            type: 'amstrad_remote_joystick',
            player,
            mask,
          });
        } else {
          forwardJoystickMaskAsKeys(mask, isCpcParty ? 1 : player, previousMask);
        }
        setRemoteMask(mask);
      }
    } catch (err) {
      addLog(`Input parse error: ${err.message}`);
      addInputDebug(`parse error ${err.message}`);
    }
  }, [activePartyPlayer, addInputDebug, addLog, forwardExtraButtonAsKey, forwardInputToEmulator, forwardJoystickMaskAsKeys, isAmigaFamily, isArcade, isCpcParty, isMegaDrive, isSnes, releaseCpcPartySharedInput]);

  useEffect(() => {
    handleGuestPayloadOnHostRef.current = handleGuestPayloadOnHost;
  }, [handleGuestPayloadOnHost]);

  const onSignalMessage = useCallback(async (message) => {
    if (message.to && message.to !== signalingClientIdRef.current) {
      return;
    }

    if (message.type === 'system') {
      addLog(message.message);
      return;
    }

    if (message.type === 'party-room-full') {
      setStatus('Party room full');
      setError('This party room has no free live player slots.');
      addLog('Party room full');
      return;
    }

    if (message.type === 'party-assigned') {
      setPartyPlayerNumber(message.playerNumber || null);
      addLog(`Assigned party player P${message.playerNumber}`);
      return;
    }

    if (message.type === 'party-turn') {
      setActivePartyPlayer(message.playerNumber || 1);
      addInputDebug(`party turn is P${message.playerNumber || 1}`, 0, 'party turn');
      return;
    }

    if (isHost && isCpcParty) {
      if (message.type === 'peer-ready' && message.role === 'guest') {
        await createPartyPeerForGuest(message);
        return;
      }

      if (message.type === 'answer') {
        const peer = partyHostPeersRef.current.get(message.from);
        if (!peer) {
          addLog('Ignored party answer from unknown guest');
          return;
        }

        await peer.pc.setRemoteDescription(message.answer);

        const candidates = peer.pendingIceCandidates;
        peer.pendingIceCandidates = [];
        for (const candidate of candidates) {
          try {
            await peer.pc.addIceCandidate(candidate);
            addLog(`Added queued ICE candidate for P${peer.playerNumber}`);
          } catch (err) {
            addLog(`Party ICE error: ${err.message}`);
          }
        }

        addLog(`Received answer from P${peer.playerNumber}`);
        return;
      }

      if (message.type === 'ice-candidate' && message.candidate) {
        const peer = partyHostPeersRef.current.get(message.from);
        if (!peer) {
          addLog('Ignored party ICE from unknown guest');
          return;
        }

        if (!peer.pc.remoteDescription) {
          peer.pendingIceCandidates.push(message.candidate);
          addLog(`Queued ICE candidate for P${peer.playerNumber}`);
          return;
        }

        try {
          await peer.pc.addIceCandidate(message.candidate);
          addLog(`Added ICE candidate for P${peer.playerNumber}`);
        } catch (err) {
          addLog(`Party ICE error: ${err.message}`);
        }
        return;
      }

      return;
    }

    if (message.type === 'peer-ready') {
      if (message.role === 'host') {
        setHostDisplayName(message.username || 'Host');
      }

      if (message.role === 'guest') {
        setGuestDisplayName(message.username || 'Guest');
      }
    }

    const pc = pcRef.current;

    if (!pc) {
      addLog('Signal received before peer connection existed');
      return;
    }

    async function flushPendingIceCandidates() {
      if (!pc.remoteDescription) return;
      if (pendingIceCandidatesRef.current.length === 0) return;

      const candidates = pendingIceCandidatesRef.current;
      pendingIceCandidatesRef.current = [];

      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(candidate);
          addLog('Added queued ICE candidate');
        } catch (err) {
          addLog(`ICE error: ${err.message}`);
        }
      }
    }

    if (message.type === 'peer-ready') {
      if (isHost && message.role === 'guest') {
        if (!activeGuestSignalIdRef.current && message.from) {
          activeGuestSignalIdRef.current = message.from;
          activePeerSignalIdRef.current = message.from;
          addLog(`Live guest slot assigned to ${message.username || 'guest'}`);
        }

        if (activeGuestSignalIdRef.current && message.from && message.from !== activeGuestSignalIdRef.current) {
          sendSignalRef.current({
            type: 'live-slot-taken',
            to: message.from,
          });
          addLog(`Ignored extra guest ${message.username || message.from}`);
          return;
        }
      }

      if (isHost && localOfferRef.current && (!activeGuestSignalIdRef.current || message.from === activeGuestSignalIdRef.current)) {
        const sent = sendSignalRef.current({
          type: 'offer',
          to: activeGuestSignalIdRef.current || undefined,
          offer: localOfferRef.current,
        });

        addLog(sent ? 'Re-sent offer to ready guest' : 'Queued offer for ready guest');
      }

      return;
    }

    if (message.type === 'offer') {
      addLog('Received offer');
      if (message.from) {
        activePeerSignalIdRef.current = message.from;
      }

      await pc.setRemoteDescription(message.offer);
      await flushPendingIceCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGatheringComplete(pc);

      sendSignalRef.current({
        type: 'answer',
        to: message.from || undefined,
        answer: pc.localDescription,
      });

      addLog('Sent answer');
      setStatus('Answer sent');

      if (micRenegotiationNeededRef.current && pc.signalingState === 'stable') {
        micRenegotiationNeededRef.current = false;
        await renegotiatePeerConnection('Microphone');
      }
      return;
    }

    if (message.type === 'answer') {
      if (isHost && activeGuestSignalIdRef.current && message.from && message.from !== activeGuestSignalIdRef.current) {
        addLog('Ignored answer from extra guest');
        return;
      }

      addLog('Received answer');
      if (message.from) {
        activePeerSignalIdRef.current = message.from;
      }

      await pc.setRemoteDescription(message.answer);
      await flushPendingIceCandidates();
      setStatus('Peer connected');

      if (micRenegotiationNeededRef.current && pc.signalingState === 'stable') {
        micRenegotiationNeededRef.current = false;
        await renegotiatePeerConnection('microphone');
      }
      return;
    }

    if (message.type === 'ice-candidate' && message.candidate) {
      if (isHost && activeGuestSignalIdRef.current && message.from && message.from !== activeGuestSignalIdRef.current) {
        addLog('Ignored ICE candidate from extra guest');
        return;
      }

      if (!pc.remoteDescription) {
        pendingIceCandidatesRef.current.push(message.candidate);
        addLog('Queued ICE candidate until remote description');
        return;
      }

      try {
        await pc.addIceCandidate(message.candidate);
        addLog('Added ICE candidate');
      } catch (err) {
        addLog(`ICE error: ${err.message}`);
      }
    }
  }, [addLog, isCpcParty, isHost, partyMaxPlayers]);

  const { send: sendSignal, isOpen: signalingOpen } = useSignaling(isSoloMode ? null : roomCode, onSignalMessage, signalingClientIdRef.current);
  const displayedPlayers = isSoloMode
    ? [
      {
        playerNumber: 1,
        username: username || playerOneName,
        role: 'Solo',
        connected: true,
      },
    ]
    : isCpcParty
    ? partyRoster
    : [
      {
        playerNumber: 1,
        username: playerOneName,
        role: 'Host',
        connected: Boolean(hostDisplayName),
      },
      {
        playerNumber: 2,
        username: playerTwoName,
        role: 'Guest',
        connected: Boolean(guestDisplayName),
      },
    ];
  const healthItems = isSoloMode
    ? [
      {
        label: 'Local mode',
        ok: true,
      },
      {
        label: 'Emulator',
        ok: hostStarted,
      },
    ]
    : [
      {
        label: 'Signaling',
        ok: signalingOpen,
      },
      {
        label: isCpcParty ? 'Players' : 'Peer',
        ok: remoteConnected,
      },
      {
        label: isHost ? 'Host stream' : 'Guest link',
        ok: isHost ? hostStarted : guestPrepared,
      },
    ];

  useEffect(() => {
    sendSignalRef.current = sendSignal;
  }, [sendSignal]);

  useEffect(() => {
    async function loadRoom() {
      try {
        const data = await apiFetch(`/rooms/${roomCode}`);
        setRoom(data);
        setStatus('Room ready');
      } catch (err) {
        setError(err.message);
      }
    }

    loadRoom();
  }, [roomCode]);

  useEffect(() => {
    if (!isSoloMode && signalingOpen) {
      addLog('Signaling socket open');
    }
  }, [isSoloMode, signalingOpen, addLog]);

  useEffect(() => {
    if (isSoloMode || !signalingOpen || !room) {
      return;
    }

    sendSignal({
      type: 'peer-ready',
      role: isHost ? 'host' : 'guest',
      username,
    });
  }, [isHost, isSoloMode, room, sendSignal, signalingOpen, username]);

  useEffect(() => {
    if (isSoloMode) {
      pcRef.current = null;
      return () => {
        if (mirrorLoopRef.current) {
          cancelAnimationFrame(mirrorLoopRef.current);
        }

        localMicStreamRef.current?.getTracks().forEach((track) => track.stop());
        localMicStreamRef.current = null;
        localMicSenderRef.current = null;
        hostVideoStreamRef.current = null;
        hostAudioStreamRef.current = null;
        dataChannelRef.current?.close();
      };
    }

    const pc = new RTCPeerConnection(buildRtcConfig());
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const sent = sendSignalRef.current({
          type: 'ice-candidate',
          to: isHostRef.current ? activeGuestSignalIdRef.current || undefined : activePeerSignalIdRef.current || undefined,
          candidate: event.candidate,
        });

        addLog(sent ? 'Sent ICE candidate' : 'Queued ICE candidate');
      }
    };

    pc.onconnectionstatechange = () => {
      setStatus(`Connection state: ${pc.connectionState}`);
      addLog(`PC state: ${pc.connectionState}`);

      if (pc.connectionState === 'connected') {
        setRemoteConnected(true);
      }

      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        setRemoteConnected(false);
      }
    };

    pc.ontrack = (event) => {
      if (event.track.kind === 'audio' && isHostRef.current) {
        if (!remoteVoiceStreamRef.current) {
          remoteVoiceStreamRef.current = new MediaStream();
        }

        const voiceStream = remoteVoiceStreamRef.current;
        const hasVoiceTrack = voiceStream.getTracks().some((track) => track.id === event.track.id);

        if (!hasVoiceTrack) {
          voiceStream.addTrack(event.track);
        }

        if (remoteVoiceAudioRef.current && remoteVoiceAudioRef.current.srcObject !== voiceStream) {
          remoteVoiceAudioRef.current.srcObject = voiceStream;
          remoteVoiceAudioRef.current.volume = 1;
          remoteVoiceAudioRef.current.play().catch(() => {
            addLog('Guest mic is connected; press Capture if audio is blocked');
          });
        }

        addLog('Remote microphone track attached');
        return;
      }

      if (!remoteMediaStreamRef.current) {
        remoteMediaStreamRef.current = new MediaStream();
      }

      const remoteStream = remoteMediaStreamRef.current;
      const hasTrack = remoteStream.getTracks().some((track) => track.id === event.track.id);

      if (!hasTrack) {
        remoteStream.addTrack(event.track);
      }

      if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
      }

      addLog(`Remote ${event.track.kind} track attached`);
    };

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      dataChannelRef.current = channel;

      channel.onopen = () => {
        lastRemoteInputSessionRef.current = '';
        lastRemoteInputSeqRef.current = 0;
        lastRemoteInputAtRef.current = 0;
        remoteJoystickMaskRef.current = 0;
        addLog('Input data channel open');
      };
      channel.onmessage = (msg) => handleGuestPayloadOnHostRef.current?.(msg.data);
    };

    return () => {
      if (mirrorLoopRef.current) {
        cancelAnimationFrame(mirrorLoopRef.current);
      }

      localMicStreamRef.current?.getTracks().forEach((track) => track.stop());
      localMicStreamRef.current = null;
      localMicSenderRef.current = null;
      remoteVoiceAudioRef.current?.pause();
      remoteVoiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteVoiceStreamRef.current = null;
      for (const [guestId] of partyHostPeersRef.current) {
        closePartyPeer(guestId);
      }
      partyHostPeersRef.current.clear();
      pendingPartyGuestsRef.current.clear();
      hostVideoStreamRef.current = null;
      hostAudioStreamRef.current = null;
      dataChannelRef.current?.close();
      pc.close();
    };
  }, [addLog, isSoloMode]);

  useEffect(() => {
    if (isHost !== true) return undefined;

    function handleHostKeyDown(event) {
      if (!shouldHandleHostKey(event)) return;

      const key = getKeyboardKey(event);
      if (isAmigaFamily) {
        if (event.repeat) {
          event.preventDefault();
          return;
        }

        addInputDebug(`host Amiga key ${event.code} down`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'amiga_keyboard',
          player: 1,
          code: event.code,
          key: event.key,
          action: 'down',
        });

        event.preventDefault();
        return;
      }

      const mappedKey = hostKeyToCpcKeyboardKey(key);

      if (mappedKey || isMenuKey(key)) {
        if (isCpcParty && activePartyPlayer !== 1) {
          addInputDebug(`ignored host key, party turn is P${activePartyPlayer}`, null, 'party turn');
          event.preventDefault();
          return;
        }

        addInputDebug(`host key ${key} down -> ${mappedKey || key}`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'amstrad_remote_input',
          player: 1,
          key: mappedKey || key,
          action: 'down',
        });

        event.preventDefault();
      }
    }

    function handleHostKeyUp(event) {
      if (!shouldHandleHostKey(event)) return;

      const key = getKeyboardKey(event);
      if (isAmigaFamily) {
        addInputDebug(`host Amiga key ${event.code} up`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'amiga_keyboard',
          player: 1,
          code: event.code,
          key: event.key,
          action: 'up',
        });

        event.preventDefault();
        return;
      }

      const mappedKey = hostKeyToCpcKeyboardKey(key);

      if (mappedKey || isMenuKey(key)) {
        if (isCpcParty && activePartyPlayer !== 1) {
          event.preventDefault();
          return;
        }

        addInputDebug(`host key ${key} up -> ${mappedKey || key}`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'amstrad_remote_input',
          player: 1,
          key: mappedKey || key,
          action: 'up',
        });

        event.preventDefault();
      }
    }

    window.addEventListener('keydown', handleHostKeyDown, true);
    window.addEventListener('keyup', handleHostKeyUp, true);

    return () => {
      window.removeEventListener('keydown', handleHostKeyDown, true);
      window.removeEventListener('keyup', handleHostKeyUp, true);
    };
  }, [activePartyPlayer, addInputDebug, forwardInputToEmulator, isAmigaFamily, isCpcParty, isHost]);

  useEffect(() => {
    if (isHost !== false) return undefined;

    let guestJoystickMask = 0;

    function sendToHost(payload) {
      const channel = dataChannelRef.current;

      if (!channel || channel.readyState !== 'open') {
        return false;
      }

      channel.send(JSON.stringify(payload));
      return true;
    }

    function handleGuestKeyDown(event) {
      if (!shouldHandleKey(event)) return;
      if (!inputCaptured) return;

      const key = getKeyboardKey(event);
      const joyBit = keyToJoystickBit(key);

      if (joyBit) {
        if (event.repeat) {
          addInputDebug(`ignored repeat ${key}`, guestJoystickMask, 'guest keyboard');
          event.preventDefault();
          return;
        }

        guestJoystickMask |= joyBit;
        addInputDebug(`guest key ${key} down`, guestJoystickMask, 'guest keyboard');

        sendLocalJoystickMask(guestJoystickMask);

        event.preventDefault();
        return;
      }

      if (isGuestKeyboardKey(key)) {
        const payload = {
          type: 'key',
          player: 2,
          key,
          action: 'down',
        };

        addInputDebug(`guest send ${formatInputPayload(payload)}`);
        sendToHost(payload);

        event.preventDefault();
      }
    }

    function handleGuestKeyUp(event) {
      if (!shouldHandleKey(event)) return;
      if (!inputCaptured) return;

      const key = getKeyboardKey(event);
      const joyBit = keyToJoystickBit(key);

      if (joyBit) {
        guestJoystickMask &= ~joyBit;
        addInputDebug(`guest key ${key} up`, guestJoystickMask, 'guest keyboard');

        sendLocalJoystickMask(guestJoystickMask);

        event.preventDefault();
        return;
      }

      if (isGuestKeyboardKey(key)) {
        const payload = {
          type: 'key',
          player: 2,
          key,
          action: 'up',
        };

        addInputDebug(`guest send ${formatInputPayload(payload)}`);
        sendToHost(payload);

        event.preventDefault();
      }
    }

    window.addEventListener('keydown', handleGuestKeyDown);
    window.addEventListener('keyup', handleGuestKeyUp);

    return () => {
      window.removeEventListener('keydown', handleGuestKeyDown);
      window.removeEventListener('keyup', handleGuestKeyUp);
    };
  }, [addInputDebug, isHost, inputCaptured, sendLocalJoystickMask]);

  function startMirrorLoop(sourceCanvas) {
    const mirrorCanvas = mirrorCanvasRef.current;

    if (!mirrorCanvas) {
      throw new Error('Mirror canvas not found');
    }

    mirrorCanvas.width = sourceCanvas.width || 768;
    mirrorCanvas.height = sourceCanvas.height || 544;

    const ctx = mirrorCanvas.getContext('2d');

    if (!ctx) {
      throw new Error('Could not get mirror canvas context');
    }

    ctx.imageSmoothingEnabled = false;

    let arcadeCrop = null;
    let cropFrame = 0;

    function detectArcadeCrop(sourceWidth, sourceHeight) {
      if (!isArcade) return null;

      const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (!sourceContext) return null;

      const sampleStep = 4;
      const image = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight).data;
      let minX = sourceWidth;
      let minY = sourceHeight;
      let maxX = -1;
      let maxY = -1;

      for (let y = 0; y < sourceHeight; y += sampleStep) {
        for (let x = 0; x < sourceWidth; x += sampleStep) {
          const index = (y * sourceWidth + x) * 4;
          const red = image[index];
          const green = image[index + 1];
          const blue = image[index + 2];

          if (red > 18 || green > 18 || blue > 18) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }

      const width = maxX - minX + sampleStep;
      const height = maxY - minY + sampleStep;
      if (width < 48 || height < 48) return arcadeCrop;

      const pad = 10;
      return {
        x: Math.max(0, minX - pad),
        y: Math.max(0, minY - pad),
        width: Math.min(sourceWidth - Math.max(0, minX - pad), width + pad * 2),
        height: Math.min(sourceHeight - Math.max(0, minY - pad), height + pad * 2),
      };
    }

    function drawContained(sourceX, sourceY, sourceWidth, sourceHeight) {
      const scale = Math.min(mirrorCanvas.width / sourceWidth, mirrorCanvas.height / sourceHeight);
      const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
      const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
      const targetX = Math.round((mirrorCanvas.width - targetWidth) / 2);
      const targetY = Math.round((mirrorCanvas.height - targetHeight) / 2);

      ctx.clearRect(0, 0, mirrorCanvas.width, mirrorCanvas.height);
      ctx.drawImage(
        sourceCanvas,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        targetX,
        targetY,
        targetWidth,
        targetHeight,
      );
    }

    const draw = () => {
      try {
        const sourceWidth = sourceCanvas.width || sourceCanvas.clientWidth;
        const sourceHeight = sourceCanvas.height || sourceCanvas.clientHeight;
        if (!sourceWidth || !sourceHeight) {
          mirrorLoopRef.current = requestAnimationFrame(draw);
          return;
        }

        if (isArcade && cropFrame % 12 === 0) {
          arcadeCrop = detectArcadeCrop(sourceWidth, sourceHeight);
        }
        cropFrame += 1;

        if (isArcade && arcadeCrop) {
          drawContained(arcadeCrop.x, arcadeCrop.y, arcadeCrop.width, arcadeCrop.height);
        } else if (isArcade) {
          drawContained(0, 0, sourceWidth, sourceHeight);
        } else {
          ctx.drawImage(sourceCanvas, 0, 0, mirrorCanvas.width, mirrorCanvas.height);
        }
      } catch {
        // ignore transient draw issues
      }

      mirrorLoopRef.current = requestAnimationFrame(draw);
    };

    draw();
    addLog('Mirror canvas loop started');
  }

  function findCanvasInDocument(doc, depth = 0) {
    if (!doc || depth > 3) return null;

    const frames = Array.from(doc.querySelectorAll('iframe'));
    for (const frame of frames) {
      try {
        const nestedDoc = frame.contentDocument || frame.contentWindow?.document;
        const nestedCanvas = findCanvasInDocument(nestedDoc, depth + 1);
        if (nestedCanvas) return nestedCanvas;
      } catch {
        // Cross-origin frames cannot be captured into our mirror canvas.
      }
    }

    const canvases = Array.from(doc.querySelectorAll('canvas'));
    const canvas = canvases.find((candidate) => (
      candidate.id !== 'placeholder-canvas'
      && candidate.dataset.ignoreCapture !== 'true'
      && candidate.width > 0
      && candidate.height > 0
    ));

    if (canvas) return canvas;

    return null;
  }

  async function waitForEmulatorCanvas(iframe) {
    const startedAt = Date.now();
    const canvasTimeout = isAmigaAga ? 30000 : 8000;

    while (Date.now() - startedAt < canvasTimeout) {
      const iframeDocument = iframe.contentDocument || iframe.contentWindow?.document;
      const emulatorCanvas = findCanvasInDocument(iframeDocument);

      if (emulatorCanvas) {
        return emulatorCanvas;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }

    throw new Error('Could not find emulator canvas in iframe');
  }

  function getHostAudioStream(iframe) {
    if (isAmigaAga) return iframe.contentWindow?.getAmigaAgaAudioStream?.() || null;
    if (isAmiga) return iframe.contentWindow?.getAmigaAudioStream?.() || null;
    if (isMegaDrive) return iframe.contentWindow?.getMegaDriveAudioStream?.() || null;
    if (isSnes) return iframe.contentWindow?.getSnesAudioStream?.() || null;
    if (isArcade) return iframe.contentWindow?.getArcadeAudioStream?.() || null;
    if (isSpectrum) return iframe.contentWindow?.getSpectrumAudioStream?.() || null;
    return iframe.contentWindow?.getAmstradAudioStream?.() || null;
  }

  async function waitForHostAudioStream(iframe) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 3000) {
      const audioStream = getHostAudioStream(iframe);

      if (audioStream?.getAudioTracks?.().length > 0) {
        return audioStream;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }

    return getHostAudioStream(iframe);
  }

  function getNextPartyPlayerNumber() {
    const usedPlayers = new Set(
      Array.from(partyHostPeersRef.current.values()).map((peer) => peer.playerNumber),
    );

    for (let playerNumber = 2; playerNumber <= partyMaxPlayers; playerNumber += 1) {
      if (!usedPlayers.has(playerNumber)) return playerNumber;
    }

    return null;
  }

  function refreshPartyRoster() {
    const players = [
      {
        playerNumber: 1,
        username: username || 'Host',
        connected: true,
        role: 'Host',
      },
      ...Array.from(partyHostPeersRef.current.values())
        .map((peer) => ({
          playerNumber: peer.playerNumber,
          username: peer.username || `Player ${peer.playerNumber}`,
          connected: ['connected', 'completed'].includes(peer.pc?.iceConnectionState) || peer.pc?.connectionState === 'connected',
          role: 'Guest',
        }))
        .sort((a, b) => a.playerNumber - b.playerNumber),
    ];

    setPartyRoster(players);
  }

  function closePartyPeer(guestId) {
    const peer = partyHostPeersRef.current.get(guestId);
    if (!peer) return;

    if (peer.joystickMask) {
      releaseCpcPartySharedInput(peer.joystickMask);
    }

    peer.channel?.close();
    peer.pc?.close();
    partyHostPeersRef.current.delete(guestId);
    refreshPartyRoster();
    setRemoteConnected(Array.from(partyHostPeersRef.current.values()).some((item) => item.pc?.connectionState === 'connected'));
  }

  async function createPartyPeerForGuest(guestMessage) {
    const guestId = guestMessage.from;
    if (!guestId || !isCpcParty || !isHost) return;

    const existingPeer = partyHostPeersRef.current.get(guestId);
    if (existingPeer?.offer) {
      sendSignalRef.current({
        type: 'offer',
        to: guestId,
        offer: existingPeer.offer,
      });
      addLog(`Re-sent party offer to P${existingPeer.playerNumber}`);
      return;
    }

    if (!hostVideoStreamRef.current) {
      pendingPartyGuestsRef.current.set(guestId, guestMessage);
      addLog(`Queued party guest ${guestMessage.username || guestId} until stream starts`);
      return;
    }

    const playerNumber = getNextPartyPlayerNumber();
    if (!playerNumber) {
      sendSignalRef.current({
        type: 'party-room-full',
        to: guestId,
      });
      addLog(`Party room full; rejected ${guestMessage.username || guestId}`);
      return;
    }

    const pc = new RTCPeerConnection(buildRtcConfig());
    const peerState = {
      pc,
      channel: null,
      playerNumber,
      joystickMask: 0,
      lastInputAt: 0,
      lastSeq: 0,
      lastSession: '',
      pendingIceCandidates: [],
      offer: null,
      username: guestMessage.username || `Player ${playerNumber}`,
    };

    partyHostPeersRef.current.set(guestId, peerState);
    refreshPartyRoster();

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      sendSignalRef.current({
        type: 'ice-candidate',
        to: guestId,
        candidate: event.candidate,
      });
    };

    pc.onconnectionstatechange = () => {
      addLog(`P${playerNumber} connection: ${pc.connectionState}`);
      refreshPartyRoster();
      setRemoteConnected(Array.from(partyHostPeersRef.current.values()).some((item) => item.pc?.connectionState === 'connected'));

      if (['failed', 'closed'].includes(pc.connectionState)) {
        closePartyPeer(guestId);
      }
    };

    hostVideoStreamRef.current.getTracks().forEach((track) => {
      pc.addTrack(track, hostVideoStreamRef.current);
    });

    hostAudioStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, hostAudioStreamRef.current);
    });

    const channel = pc.createDataChannel('inputs');
    peerState.channel = channel;

    channel.onopen = () => {
      peerState.joystickMask = 0;
      peerState.lastInputAt = 0;
      peerState.lastSeq = 0;
      peerState.lastSession = '';
      addLog(`P${playerNumber} input data channel open`);
    };
    channel.onmessage = (msg) => handleGuestPayloadOnHostRef.current?.(msg.data, playerNumber, peerState);
    channel.onclose = () => {
      if (peerState.joystickMask) {
        releaseCpcPartySharedInput(peerState.joystickMask);
      }
      peerState.joystickMask = 0;
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);
    peerState.offer = pc.localDescription;

    sendSignalRef.current({
      type: 'party-assigned',
      to: guestId,
      playerNumber,
    });

    sendSignalRef.current({
      type: 'offer',
      to: guestId,
      offer: peerState.offer,
    });

    addLog(`Party guest ${peerState.username} assigned P${playerNumber}`);
    refreshPartyRoster();
    setStatus(`Party host ready: ${partyHostPeersRef.current.size} guest(s) connected`);
  }

  async function connectPendingPartyGuests() {
    if (!isCpcParty || !isHost || !hostVideoStreamRef.current) return;

    const pendingGuests = Array.from(pendingPartyGuestsRef.current.values());
    pendingPartyGuestsRef.current.clear();

    for (const guestMessage of pendingGuests) {
      await createPartyPeerForGuest(guestMessage);
    }
  }

  async function renegotiatePeerConnection(reason = 'voice') {
    const pc = pcRef.current;

    if (!pc || !pc.remoteDescription || pc.signalingState !== 'stable') {
      micRenegotiationNeededRef.current = true;
      addLog(`${reason} will connect when the peer connection is ready`);
      return;
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    if (isHostRef.current) {
      localOfferRef.current = pc.localDescription;
    }

    const sent = sendSignalRef.current({
      type: 'offer',
      to: isHostRef.current ? activeGuestSignalIdRef.current || undefined : activePeerSignalIdRef.current || undefined,
      offer: pc.localDescription,
    });

    addLog(sent ? `${reason} offer sent` : `${reason} offer queued`);
  }

  async function refreshMicrophoneDevices() {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        }));

      setMicDevices(audioInputs);
    } catch (err) {
      addLog(`Microphone device list error: ${err.message}`);
    }
  }

  async function openMicrophone(deviceId = '') {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus('Mic unavailable');
      setError('This browser cannot use the microphone here.');
      addLog('Microphone is not available in this browser');
      return;
    }

    let nextStream = null;

    try {
      setMicStatus(deviceId ? 'Switching mic...' : 'Opening mic...');
      nextStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const [track] = nextStream.getAudioTracks();

      if (!track) {
        throw new Error('No microphone track was provided by the browser');
      }

      const pc = pcRef.current;

      if (!pc) {
        throw new Error('Peer connection is not ready yet');
      }

      const previousStream = localMicStreamRef.current;
      const existingSender = localMicSenderRef.current;

      if (existingSender) {
        await existingSender.replaceTrack(track);
      } else {
        localMicSenderRef.current = pc.addTrack(track, nextStream);
      }

      previousStream?.getTracks().forEach((previousTrack) => previousTrack.stop());
      localMicStreamRef.current = nextStream;
      setMicEnabled(true);
      setMicMuted(false);
      setMicStatus('Mic on');
      setSelectedMicDeviceId(track.getSettings?.().deviceId || deviceId || '');
      addLog(existingSender ? 'Microphone switched' : 'Microphone enabled');
      await refreshMicrophoneDevices();

      if (!existingSender && pc.remoteDescription && pc.signalingState === 'stable') {
        await renegotiatePeerConnection('Microphone');
      } else if (!existingSender) {
        micRenegotiationNeededRef.current = true;
        addLog('Microphone will connect when the room stream is ready');
      }
    } catch (err) {
      nextStream?.getTracks().forEach((track) => track.stop());
      if (!localMicStreamRef.current) {
        localMicSenderRef.current = null;
        setMicEnabled(false);
        setMicMuted(false);
        setMicStatus('Mic blocked');
      } else {
        setMicStatus(micMuted ? 'Mic muted' : 'Mic on');
      }
      setError(err.message);
      addLog(`Microphone error: ${err.message}`);
    }
  }

  async function toggleMicrophone() {
    if (isCpcParty) return;

    const existingStream = localMicStreamRef.current;

    if (existingStream) {
      const nextMuted = !micMuted;
      existingStream.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
      setMicMuted(nextMuted);
      setMicStatus(nextMuted ? 'Mic muted' : 'Mic on');
      addLog(nextMuted ? 'Microphone muted' : 'Microphone unmuted');
      return;
    }

    await openMicrophone(selectedMicDeviceId);
  }

  async function startHostSession() {
    if (hostStartingRef.current || hostStartedRef.current) {
      return;
    }

    hostStartingRef.current = true;

    try {
      setError('');
      const pc = pcRef.current;
      const iframe = emulatorFrameRef.current;

      if (!iframe) {
        throw new Error('Emulator frame not found');
      }

      setHostStarted(true);
      addLog('Waiting for emulator iframe');

      if (isAmiga) {
        iframe.contentWindow?.postMessage({ type: 'amiga_start' }, window.location.origin);
      }
      if (isAmigaAga) {
        iframe.contentWindow?.postMessage({ type: 'amiga_aga_start' }, window.location.origin);
      }
      if (isMegaDrive) {
        iframe.contentWindow?.postMessage({ type: 'megadrive_start' }, window.location.origin);
      }
      if (isSnes) {
        iframe.contentWindow?.postMessage({ type: 'snes_start' }, window.location.origin);
      }
      if (isArcade) {
        iframe.contentWindow?.postMessage({ type: 'arcade_start' }, window.location.origin);
      }

      const emulatorCanvas = await waitForEmulatorCanvas(iframe);

      startMirrorLoop(emulatorCanvas);

      const mirrorCanvas = mirrorCanvasRef.current;

      if (!mirrorCanvas) {
        throw new Error('Mirror canvas missing');
      }

      const stream = mirrorCanvas.captureStream(60);
      hostVideoStreamRef.current = stream;

      const audioStream = await waitForHostAudioStream(iframe);
      hostAudioStreamRef.current = audioStream || null;

      if (isSoloMode) {
        addLog('Local emulator ready');
        setStatus('Local emulator ready');
        hostStartedRef.current = true;
        return;
      }

      if (!pc) {
        throw new Error('Peer connection is not ready');
      }

      if (isCpcParty) {
        addLog(`Party stream ready with ${stream.getVideoTracks().length} video track(s) and ${audioStream?.getAudioTracks().length || 0} audio track(s)`);
        setStatus('Party host ready, waiting for guests');
        hostStartedRef.current = true;
        await connectPendingPartyGuests();
        return;
      }

      stream.getVideoTracks().forEach((track) => pc.addTrack(track, stream));
      if (audioStream) {
        audioStream.getAudioTracks().forEach((track) => pc.addTrack(track, audioStream));
      }
      addLog(`Added ${stream.getVideoTracks().length} video track(s) and ${audioStream?.getAudioTracks().length || 0} audio track(s)`);

      const channel = pc.createDataChannel('inputs');
      dataChannelRef.current = channel;

      channel.onopen = () => {
        lastRemoteInputSessionRef.current = '';
        lastRemoteInputSeqRef.current = 0;
        lastRemoteInputAtRef.current = 0;
        remoteJoystickMaskRef.current = 0;
        addLog('Host input data channel open');
      };
      channel.onmessage = (msg) => handleGuestPayloadOnHostRef.current?.(msg.data);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);
      localOfferRef.current = pc.localDescription;

      const sent = sendSignal({
        type: 'offer',
        to: activeGuestSignalIdRef.current || undefined,
        offer: localOfferRef.current,
      });

      addLog(sent ? 'Offer sent' : 'Offer queued until signaling opens');
      setStatus('Offer created, waiting for guest');
      hostStartedRef.current = true;
    } catch (err) {
      setError(err.message);
      addLog(`Host session error: ${err.message}`);
      setHostStarted(false);
      hostStartedRef.current = false;
    } finally {
      hostStartingRef.current = false;
    }
  }

  async function connectGuest() {
    if (guestPreparedRef.current) {
      return;
    }

    try {
      const pc = pcRef.current;

      if (!pc.remoteDescription && pc.getTransceivers().length === 0) {
        pc.addTransceiver('video', {
          direction: 'recvonly',
        });
        pc.addTransceiver('audio', {
          direction: 'recvonly',
        });
      }

      guestPreparedRef.current = true;
      setGuestPrepared(true);
      addLog('Guest prepared to receive stream');
      setStatus('Waiting for host offer');
    } catch (err) {
      setError(err.message);
      addLog(`Guest setup error: ${err.message}`);
    }
  }

  useEffect(() => {
    if (!isSoloMode && isHost && signalingOpen && !isAmigaFamily && !isArcade) {
      startHostSession();
    }
  }, [isAmigaFamily, isArcade, isHost, isSoloMode, room, signalingOpen]);

  useEffect(() => {
    if (!isSoloMode && room && !isHost) {
      connectGuest();
    }
  }, [isHost, isSoloMode, room]);

  function openDiskPicker() {
    if (!isHost) return;

    fileInputRef.current?.click();
  }

  function openKickstartPicker() {
    if (!isHost || !isAmigaFamily) return;

    kickstartInputRef.current?.click();
  }

  function openSwapDiskPicker() {
    if (!isHost || !isAmigaFamily || !hostStarted) return;

    if (isAmigaAga) {
      addLog('AGA disks are mounted as DF0-DF3');
      setStatus(loadedAgaDiskCount > 1 ? 'AGA disks are mounted as DF0-DF3' : 'Load all AGA disks together before starting');
      return;
    }

    swapDiskInputRef.current?.click();
  }

  function resetHostEmulator() {
    if (!isHost || !hostStarted) return;

    const type = isAmiga
      ? 'amiga_reset'
      : isAmigaAga
        ? 'amiga_aga_reset'
      : isMegaDrive ? 'megadrive_reset' : isSnes ? 'snes_reset' : isArcade ? 'arcade_reset' : isSpectrum ? 'spectrum_reset' : 'amstrad_reset';

    forwardInputToEmulator({ type });
    addLog('Reset emulator');
    setStatus('Emulator reset');
  }

  async function handleDiskSelected(event) {
    try {
      const selectedFiles = Array.from(event.target.files || []);
      const file = selectedFiles[0];

      if (!file) return;

      const isSwapDisk = isAmigaFamily && event.target.dataset.mode === 'swap';
      const arcadeDriverName = arcadeDriver.trim() || file.name.replace(/\.(zip|7z|rar|chd)$/i, '').toLowerCase();
      const allowedExtensions = isAmigaFamily
        ? ['.uae', '.adf', '.adz', '.dms', '.hdf', '.hdz', '.lha', '.zip']
        : isMegaDrive ? ['.bin', '.gen', '.md', '.smd'] : isSnes ? ['.sfc', '.smc', '.fig', '.swc', '.bsx', '.gd3', '.gd7', '.dx2'] : isArcade ? ['.zip'] : isSpectrum ? ['.tap', '.tzx', '.z80', '.sna', '.szx', '.zip'] : ['.dsk'];

      const invalidFile = selectedFiles.find((selectedFile) => {
        const selectedLowerName = selectedFile.name.toLowerCase();
        return !allowedExtensions.some((extension) => selectedLowerName.endsWith(extension));
      });

      if (invalidFile) {
        if (isArcade) {
          setError('Arcade rooms support MAME .zip ROM files');
          addLog(`Rejected file: ${invalidFile.name}`);
          event.target.value = '';
          return;
        }
        setError(isAmigaFamily ? 'Amiga rooms support .uae, .adf, .adz, .dms, .hdf, .hdz, .lha, and .zip files' : isMegaDrive ? 'Mega Drive rooms support .bin, .gen, .md, and .smd ROM files' : isSnes ? 'SNES rooms support .sfc, .smc, .fig, .swc, .bsx, .gd3, .gd7, and .dx2 ROM files' : isSpectrum ? 'Spectrum rooms support .tap, .tzx, .z80, .sna, .szx, and .zip files' : 'Only .dsk files are supported right now');
        addLog(`Rejected file: ${invalidFile.name}`);
        event.target.value = '';
        return;
      }

      if (isArcade && !arcadeDriverName) {
        setError('Enter the MAME driver name first');
        event.target.value = '';
        return;
      }

      const filesToLoad = isAmigaAga && !isSwapDisk && selectedFiles.length > 1
        ? selectedFiles.slice().sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }))
        : [file];
      const loadedFiles = await Promise.all(filesToLoad.map(async (selectedFile) => ({
        fileName: selectedFile.name,
        bytes: new Uint8Array(await selectedFile.arrayBuffer()),
      })));
      const bytes = loadedFiles[0].bytes;

      forwardInputToEmulator({
        type: isSwapDisk ? 'amiga_swap_disk' : isAmigaAga ? 'amiga_aga_autoload' : isAmiga ? 'amiga_autoload' : isMegaDrive ? 'megadrive_autoload' : isSnes ? 'snes_autoload' : isArcade ? 'arcade_autoload' : isSpectrum ? 'spectrum_autoload' : 'amstrad_autoload',
        fileName: loadedFiles[0].fileName,
        bytes,
        disks: isAmigaAga && !isSwapDisk ? loadedFiles : undefined,
        driver: arcadeDriverName,
        runtime: arcadeRuntime.trim() || 'mamepacmantest.js',
        args: arcadeArgs.trim(),
      });

      if (isArcade || isAmigaAga) {
        if (isArcade) {
          setArcadeDriver(arcadeDriverName);
        }
        if (!hostStartedRef.current && !hostStartingRef.current) {
          await startHostSession();
        }
      }
      if (isAmigaAga && !isSwapDisk) {
        setLoadedAgaDiskCount(loadedFiles.length);
      }

      const loadedLabel = loadedFiles.length > 1
        ? `${loadedFiles[0].fileName} + ${loadedFiles.length - 1} disk${loadedFiles.length === 2 ? '' : 's'}`
        : file.name;
      setLoadedDiskName(loadedLabel);
      addLog(`${isSwapDisk ? 'Swapped disk' : 'Loaded file'}: ${loadedLabel}`);
      setStatus(`${isSwapDisk ? 'Disk swapped' : 'File loaded'}: ${loadedLabel}`);
      event.target.value = '';
    } catch (err) {
      setError(err.message);
      addLog(`File load error: ${err.message}`);
    }
  }

  async function handleKickstartSelected(event) {
    try {
      const file = event.target.files?.[0];

      if (!file) return;

      const lowerName = file.name.toLowerCase();
      const allowedExtensions = ['.rom', '.bin', '.kick', '.kickstart'];

      if (!allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
        setError('Kickstart must be a .rom or .bin file');
        addLog(`Rejected Kickstart ROM: ${file.name}`);
        event.target.value = '';
        return;
      }

      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      if (kickstartStorageKey) {
        try {
          await saveStoredKickstart(kickstartStorageKey, file.name, bytes);
          addLog(`Saved Kickstart ROM for next time: ${file.name}`);
        } catch (err) {
          addLog(`Could not save Kickstart ROM: ${err.message}`);
        }
      }

      forwardInputToEmulator({
        type: 'amiga_kickstart',
        fileName: file.name,
        bytes,
      });

      setKickstartRomName(file.name);
      addLog(`Loaded Kickstart ROM for this session: ${file.name}`);
      setStatus(`Kickstart loaded: ${file.name}`);
      event.target.value = '';
    } catch (err) {
      setError(err.message);
      addLog(`Kickstart load error: ${err.message}`);
    }
  }

  return (
    <div className="page room-page">
      <div className="card room-card">
        <div className="room-topbar">
          <div className="room-title">
            <BrandMark compact />
            <h1>{isSoloMode ? '1 Player' : `Room ${roomCode}`}</h1>
            <div className="room-identity">
              <span>You are</span>
              <strong>{username}</strong>
              <small>{roleLabel} · {systemLabel}</small>
            </div>
          </div>

          <div className="room-actions">
            <Link className="button-like secondary" to="/lobby">
              Lobby
            </Link>
            <button className="secondary" onClick={() => navigate('/lobby')}>
              Leave
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setShowDiagnostics((value) => !value)}
            >
              {showDiagnostics ? 'Hide diagnostics' : 'Diagnostics'}
            </button>
          </div>
        </div>

        <div className="room-summary">
          <div className="player-strip" aria-label="Players">
            {displayedPlayers.map((player) => (
              <div
                key={player.playerNumber}
                className={`player-card ${player.connected ? 'connected' : ''} ${player.playerNumber === currentPartyPlayerNumber ? 'you' : ''}`}
              >
                <span>P{player.playerNumber}</span>
                <strong>{player.username}</strong>
                <small>{player.role}</small>
              </div>
            ))}
          </div>

          <div className="health-strip" aria-label="Connection status">
            {healthItems.map((item) => (
              <span key={item.label} className={`health-item ${item.ok ? 'ok' : 'waiting'}`}>
                <span className="health-dot" aria-hidden="true" />
                {item.label}
              </span>
            ))}
          </div>
        </div>

        {(loadedDiskName || isAmigaFamily) ? (
          <div className="session-strip">
            {loadedDiskName ? <span>{loadedDiskName}</span> : null}
            {isAmigaFamily ? <span>{kickstartRomName ? `Kickstart: ${kickstartRomName}` : isAmigaAga ? 'ROM: A1200 Kickstart recommended' : 'ROM: AROS'}</span> : null}
          </div>
        ) : null}

        {showDiagnostics ? (
          <div className="session-strip diagnostics-summary">
            <span>{status}</span>
            {!isCpcParty && !isSoloMode ? <span>{micStatus}</span> : null}
            <span>{controlLabel}</span>
          </div>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        <audio ref={remoteVoiceAudioRef} autoPlay playsInline />

        <div className="room-layout">
          <div className={`panel video-panel ${isScreenFullscreen ? 'fullscreen-screen' : ''} ${isScreenFullscreen && isCpcParty ? 'party-fullscreen' : ''}`}>
            <div className="play-header">
              <h2>{isSoloMode ? 'Local screen' : isHost ? 'Host screen' : 'Remote screen'}</h2>

              <div className="input-toolbar">
                <div className="assigned-control" aria-label="Assigned control">
                  {assignedControlLabel}
                </div>

                {!isCpcParty && !isSoloMode ? (
                  <div className="mic-controls">
                    <button
                      type="button"
                      className={micEnabled && !micMuted ? 'active' : 'secondary'}
                      onClick={toggleMicrophone}
                    >
                      {micEnabled ? (micMuted ? 'Mic muted' : 'Mic on') : 'Mic off'}
                    </button>

                    <select
                      aria-label="Microphone"
                      value={selectedMicDeviceId}
                      onFocus={refreshMicrophoneDevices}
                      onChange={(event) => {
                        const nextDeviceId = event.target.value;
                        setSelectedMicDeviceId(nextDeviceId);
                        if (micEnabled) {
                          openMicrophone(nextDeviceId);
                        }
                      }}
                    >
                      <option value="">Default mic</option>
                      {micDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <button
                  type="button"
                  className={inputCaptured ? 'danger' : 'secondary'}
                  onClick={inputCaptured ? releaseInputCapture : captureInput}
                >
                  {inputCaptured ? 'Release' : 'Capture'}
                </button>

                <button
                  type="button"
                  className="secondary"
                  onClick={() => setIsScreenFullscreen((value) => !value)}
                >
                  {isScreenFullscreen ? 'Back to room' : 'Fullscreen'}
                </button>
              </div>
            </div>

            <div className={`capture-state ${inputCaptured ? 'captured' : ''}`}>
              {inputCaptured ? `${controlLabel} active` : 'Click the screen or press Capture to play'}
            </div>

            {isHost ? (
              <>
                <iframe
                  ref={emulatorFrameRef}
                  title={emulatorTitle}
                  src={emulatorSrc}
                  onLoad={() => setEmulatorFrameLoadCount((count) => count + 1)}
                  style={{
                    position: 'absolute',
                    left: '0',
                    top: '0',
                    width: '768px',
                    height: '544px',
                    border: '0',
                    opacity: 0,
                    pointerEvents: 'none',
                  }}
                />

                <canvas
                  ref={mirrorCanvasRef}
                  className="video"
                  onClick={captureInput}
                  onPointerDown={handleAmigaPointerDown}
                  onPointerUp={handleAmigaPointerUp}
                  onPointerMove={handleAmigaPointerMove}
                  onContextMenu={(event) => {
                    if (isAmigaFamily) event.preventDefault();
                  }}
                  style={{
                    width: '100%',
                    aspectRatio: '4 / 3',
                    border: '1px solid #1f2f4a',
                    borderRadius: '8px',
                    background: '#000',
                  }}
                  width={768}
                  height={544}
                />

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={acceptedMedia}
                  multiple={isAmigaAga}
                  data-mode="load"
                  onChange={handleDiskSelected}
                  style={{ display: 'none' }}
                />

                {isAmigaFamily ? (
                  <input
                    ref={swapDiskInputRef}
                    type="file"
                    accept={acceptedMedia}
                    data-mode="swap"
                    onChange={handleDiskSelected}
                    style={{ display: 'none' }}
                  />
                ) : null}

                {isAmigaFamily ? (
                  <input
                    ref={kickstartInputRef}
                    type="file"
                    accept=".rom,.bin,.kick,.kickstart"
                    onChange={handleKickstartSelected}
                    style={{ display: 'none' }}
                  />
                ) : null}

                {isArcade ? (
                  <div className="arcade-config">
                    <label>
                      <span>Runtime</span>
                      <input
                        value={arcadeRuntime}
                        onChange={(event) => setArcadeRuntime(event.target.value)}
                        placeholder="mamepacmantest.js"
                      />
                    </label>
                    <label>
                      <span>Driver</span>
                      <input
                        value={arcadeDriver}
                        onChange={(event) => setArcadeDriver(event.target.value.toLowerCase().trim())}
                        placeholder="pacman"
                      />
                    </label>
                    <label>
                      <span>Args</span>
                      <input
                        value={arcadeArgs}
                        onChange={(event) => setArcadeArgs(event.target.value)}
                        placeholder="Optional MAME args"
                      />
                    </label>
                  </div>
                ) : null}

                <div
                  className="host-control-bar"
                  style={{
                    display: 'flex',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  <button type="button" onClick={startHostSession} disabled={hostStarted || (isAmigaAga && !loadedDiskName)}>
                    {isAmigaAga && !loadedDiskName
                      ? 'Load AGA file to start'
                      : isSoloMode
                        ? hostStarted ? 'Emulator running' : 'Start emulator'
                        : hostStarted ? 'Host session running' : 'Start host session'}
                  </button>

                  <button onClick={openDiskPicker} disabled={!hostStarted && !isArcade && !isAmigaAga}>
                    {mediaLabel}
                  </button>

                  {isAmigaFamily ? (
                    <button type="button" className="secondary" onClick={openSwapDiskPicker} disabled={!hostStarted}>
                      {isAmigaAga ? 'Disks mounted' : 'Swap disk'}
                    </button>
                  ) : null}

                  {isAmigaFamily ? (
                    <button type="button" className="secondary" onClick={() => sendAmigaMouseClick(1)} disabled={!hostStarted}>
                      Left click
                    </button>
                  ) : null}

                  {isAmigaFamily ? (
                    <button type="button" className="secondary" onClick={() => sendAmigaMouseClick(3)} disabled={!hostStarted}>
                      Right click
                    </button>
                  ) : null}

                  <button type="button" className="secondary" onClick={resetHostEmulator} disabled={!hostStarted}>
                    Reset emulator
                  </button>

                  {isAmigaFamily ? (
                    <button type="button" className="secondary" onClick={openKickstartPicker} disabled={hostStarted && !isAmigaAga}>
                      {kickstartRomName ? 'Change Kickstart ROM' : 'Load Kickstart ROM'}
                    </button>
                  ) : null}
                </div>

                {isCpcParty ? (
                  <div className="party-turn-panel">
                    <div className="party-turn-header">
                      <strong>Party turn</strong>
                      <span>
                        {activePartyPlayerName
                          ? `P${activePartyPlayer}: ${activePartyPlayerName} controls the shared joystick`
                          : `P${activePartyPlayer}: waiting for assigned player`}
                      </span>
                    </div>
                    <div className="party-turn-controls">
                      <button type="button" className="secondary" onClick={nextPartyTurn}>
                        Next player
                      </button>
                      {Array.from({ length: partyMaxPlayers }, (_, index) => index + 1).map((playerNumber) => (
                        <button
                          key={playerNumber}
                          type="button"
                          className={activePartyPlayer === playerNumber ? 'active' : 'secondary'}
                          onClick={() => setPartyTurn(playerNumber)}
                        >
                          <span>P{playerNumber}</span>
                          {partyPlayerNameByNumber.get(playerNumber) ? <small>{partyPlayerNameByNumber.get(playerNumber)}</small> : null}
                        </button>
                      ))}
                    </div>
                    <div className="party-roster" aria-label="Party players">
                      {partyRoster.map((player) => (
                        <div key={player.playerNumber} className={player.connected ? 'connected' : ''}>
                          <strong>P{player.playerNumber}</strong>
                          <span>{player.username}</span>
                          <small>{player.role}{player.connected ? ' connected' : ' joining'}</small>
                        </div>
                      ))}
                    </div>
                    <p className="muted">Guests appear here as they join, so the host can pick the right player turn before the game starts.</p>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  muted={false}
                  className="video"
                  onClick={captureInput}
                  onPointerDown={handleAmigaPointerDown}
                  onPointerUp={handleAmigaPointerUp}
                  onPointerMove={handleAmigaPointerMove}
                  onContextMenu={(event) => {
                    if (isAmigaFamily) event.preventDefault();
                  }}
                />

                <button onClick={connectGuest} disabled={guestPrepared}>
                  {guestPrepared ? 'Guest connection ready' : 'Prepare guest connection'}
                </button>
              </>
            )}

          </div>
        </div>

        {showDiagnostics ? (
          <>
            <div className="panel input-debug-panel">
              <div className="play-header">
                <h2>Input monitor</h2>
                <div className="assigned-control">
                  {inputDebug.source}
                </div>
              </div>

              <div className="input-debug-grid">
                {joystickMaskToLabels(inputDebug.mask).map(([label, active]) => (
                  <div
                    key={label}
                    className={`input-bit ${active ? 'active' : ''}`}
                  >
                    {label}
                  </div>
                ))}
              </div>

              <div className="input-debug-meta">
                <span>Mask {inputDebug.mask}</span>
                <span>{dataChannelRef.current?.readyState || 'no channel'}</span>
                <span>{inputCaptured ? 'captured' : 'released'}</span>
              </div>

              <div className="log-list input-debug-list">
                {inputDebug.events.length === 0 ? (
                  <div className="log-entry">No inputs seen yet.</div>
                ) : inputDebug.events.map((event, index) => (
                  <div key={`${event}-${index}`} className="log-entry">
                    {event}
                  </div>
                ))}
              </div>
            </div>

            <div className="panel log-panel">
              <h2>Session log</h2>

              {logs.length === 0 ? <p className="muted">No events yet.</p> : null}

              <div className="log-list">
                {logs.map((log, index) => (
                  <div key={`${log}-${index}`} className="log-entry">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
