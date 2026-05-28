import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';
import useSignaling from '../hooks/useSignaling';
import { buildRtcConfig, waitForIceGatheringComplete } from '../utils/webrtc';

const CONTROL_ACTIONS = [
  { id: 'up', label: 'Up', bit: 1 },
  { id: 'down', label: 'Down', bit: 2 },
  { id: 'left', label: 'Left', bit: 4 },
  { id: 'right', label: 'Right', bit: 8 },
  { id: 'fire', label: 'Fire', bit: 16 },
];

const DEFAULT_CONTROL_MAPPINGS = {
  player1: {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    fire: 'x',
  },
  player2: {
    up: 'q',
    down: 'a',
    left: 'o',
    right: 'p',
    fire: 'f',
  },
};

function normaliseMapping(mapping, fallback) {
  return CONTROL_ACTIONS.reduce((next, action) => ({
    ...next,
    [action.id]: String(mapping?.[action.id] || fallback[action.id]),
  }), {});
}

function loadStoredControlMappings() {
  try {
    const stored = JSON.parse(localStorage.getItem('amstradControlMappings') || '{}');

    return {
      player1: normaliseMapping(stored.player1, DEFAULT_CONTROL_MAPPINGS.player1),
      player2: normaliseMapping(stored.player2, DEFAULT_CONTROL_MAPPINGS.player2),
    };
  } catch {
    return DEFAULT_CONTROL_MAPPINGS;
  }
}

function saveStoredControlMappings(mappings) {
  localStorage.setItem('amstradControlMappings', JSON.stringify(mappings));
}

function normaliseCapturedKey(event) {
  if (event.key === ' ') return ' ';
  if (event.key.length === 1) return event.key.toLowerCase();
  return event.key;
}

function keyMatches(inputKey, mappedKey) {
  const input = inputKey === ' ' ? ' ' : String(inputKey).toLowerCase();
  const mapped = mappedKey === ' ' ? ' ' : String(mappedKey).toLowerCase();

  return input === mapped;
}

function formatKeyLabel(key) {
  if (!key) return '-';
  if (key === ' ') return 'Space';
  if (key === 'ArrowUp') return 'Cursor Up';
  if (key === 'ArrowDown') return 'Cursor Down';
  if (key === 'ArrowLeft') return 'Cursor Left';
  if (key === 'ArrowRight') return 'Cursor Right';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function formatMappingLabel(mapping) {
  return CONTROL_ACTIONS.map((action) => formatKeyLabel(mapping?.[action.id])).join(' / ');
}

export default function RoomPage() {
  const navigate = useNavigate();
  const { roomCode } = useParams();
  const username = localStorage.getItem('username');

  const [room, setRoom] = useState(null);
  const [status, setStatus] = useState('Loading room...');
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [hostStarted, setHostStarted] = useState(false);
  const [guestPrepared, setGuestPrepared] = useState(false);
  const [loadedDiskName, setLoadedDiskName] = useState('');
  const [inputCaptured, setInputCaptured] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showControlConfig, setShowControlConfig] = useState(false);
  const [pendingControlAction, setPendingControlAction] = useState(null);
  const [controlMappings, setControlMappings] = useState(loadStoredControlMappings);
  const [inputDebug, setInputDebug] = useState({
    mask: 0,
    source: 'none',
    events: [],
  });

  const remoteMediaStreamRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const emulatorFrameRef = useRef(null);
  const mirrorCanvasRef = useRef(null);
  const mirrorLoopRef = useRef(null);
  const fileInputRef = useRef(null);
  const pcRef = useRef(null);
  const dataChannelRef = useRef(null);
  const localOfferRef = useRef(null);
  const hostStartingRef = useRef(false);
  const hostStartedRef = useRef(false);
  const guestPreparedRef = useRef(false);
  const gamepadIndexRef = useRef(null);
  const inputSessionIdRef = useRef(`${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const inputSequenceRef = useRef(0);
  const localJoystickMaskRef = useRef(0);
  const lastRemoteInputSessionRef = useRef('');
  const lastRemoteInputSeqRef = useRef(0);
  const lastRemoteInputAtRef = useRef(0);
  const remoteJoystickMaskRef = useRef(0);

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
  const activePlayer = isHost ? 1 : 2;
  const activeMapping = controlMappings[activePlayer === 1 ? 'player1' : 'player2'];
  const controlLabel = !room
    ? 'Loading controls'
    : formatMappingLabel(activeMapping);
  const roleLabel = !room
    ? 'Loading...'
    : isHost ? 'Host' : 'Guest';

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
      && !event.altKey
    );
  }

  function keyToJoystickBit(key, mapping) {
    const matchedAction = CONTROL_ACTIONS.find((action) => keyMatches(key, mapping[action.id]));

    return matchedAction?.bit || 0;
  }

  function gamepadToJoystickMask(pad) {
    let mask = 0;
    const deadzone = 0.45;

    const left = pad.buttons[14]?.pressed || (pad.axes[0] ?? 0) < -deadzone;
    const right = pad.buttons[15]?.pressed || (pad.axes[0] ?? 0) > deadzone;
    const up = pad.buttons[12]?.pressed || (pad.axes[1] ?? 0) < -deadzone;
    const down = pad.buttons[13]?.pressed || (pad.axes[1] ?? 0) > deadzone;
    const fire = [0, 1, 2, 3, 5, 7].some((index) => pad.buttons[index]?.pressed);

    if (up) mask |= 1;
    if (down) mask |= 2;
    if (left) mask |= 4;
    if (right) mask |= 8;
    if (fire) mask |= 16;

    return mask;
  }

  function joystickMaskToLabels(mask) {
    return [
      ['Up', Boolean(mask & 1)],
      ['Down', Boolean(mask & 2)],
      ['Left', Boolean(mask & 4)],
      ['Right', Boolean(mask & 8)],
      ['Fire', Boolean(mask & 16)],
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

    if (payload.type === 'input_config') {
      return `P${payload.player} controls ${formatMappingLabel(payload.mapping)}`;
    }

    return `${payload.type || 'unknown'} input`;
  }

  const joystickMaskToKeys = useCallback((mask, player) => {
    const mapping = controlMappings[player === 1 ? 'player1' : 'player2'];

    return CONTROL_ACTIONS.map((action) => [
      mapping[action.id],
      action.bit,
      Boolean(mask & action.bit),
    ]);
  }, [controlMappings]);

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
      case 'Shift':
      case 'ShiftLeft':
      case 'ShiftRight':
        return 'Shift';
      case 'Backspace':
        return 'Backspace';
      case 'Escape':
        return 'Escape';
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
      'Backspace',
      'Escape',
    ].includes(key);
  }

  const forwardInputToEmulator = useCallback((payload) => {
    const frame = emulatorFrameRef.current;
    const targetWindow = frame?.contentWindow;

    if (!targetWindow) return;

    targetWindow.postMessage(payload, window.location.origin);
  }, []);

  const sendLocalJoystickMask = useCallback((mask) => {
    const player = isHost ? 1 : 2;
    const payload = {
      type: 'joystick',
      player,
      mask,
    };

    addInputDebug(`local P${player} joystick mask ${mask}`, mask, isHost ? 'host local' : 'guest local');

    if (isHost) {
      const previousMask = localJoystickMaskRef.current;

      joystickMaskToKeys(mask, player).forEach(([key, bit, active]) => {
        const wasActive = Boolean(previousMask & bit);

        if (active === wasActive) return;

        const action = active ? 'down' : 'up';

        addInputDebug(`forward to emulator P${player} key ${key} ${action}`);
        forwardInputToEmulator({
          type: 'amstrad_remote_input',
          player,
          key,
          action,
        });
        forwardInputToEmulator({
          type: 'amstrad_remote_control',
          player,
          key,
          action,
        });
      });

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
  }, [addInputDebug, forwardInputToEmulator, isHost, joystickMaskToKeys]);

  const sendControlConfigToHost = useCallback((mapping = controlMappings.player2) => {
    if (isHost !== false) return false;

    const channel = dataChannelRef.current;
    if (channel?.readyState !== 'open') return false;

    channel.send(JSON.stringify({
      type: 'input_config',
      player: 2,
      mapping,
    }));
    addInputDebug(`send to host P2 controls ${formatMappingLabel(mapping)}`, null, 'guest local');
    return true;
  }, [addInputDebug, controlMappings.player2, isHost]);

  const forwardJoystickMaskAsKeys = useCallback((mask, player, previousMask) => {
    joystickMaskToKeys(mask, player).forEach(([key, bit, active]) => {
      const wasActive = Boolean(previousMask & bit);

      if (active === wasActive) return;

      const action = active ? 'down' : 'up';

      addInputDebug(`forward held P${player} key ${key} ${action}`, mask, 'guest remote');
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
  }, [addInputDebug, forwardInputToEmulator, joystickMaskToKeys]);

  const releaseInputCapture = useCallback(() => {
    sendLocalJoystickMask(0);
    setInputCaptured(false);
  }, [sendLocalJoystickMask]);

  const captureInput = useCallback(() => {
    setInputCaptured(true);
    forwardInputToEmulator({
      type: 'amstrad_audio_unlock',
    });

    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = false;
      remoteVideoRef.current.volume = 1;
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [forwardInputToEmulator]);

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
      if (remoteJoystickMaskRef.current === 0) return;
      if (!lastRemoteInputAtRef.current) return;
      if (performance.now() - lastRemoteInputAtRef.current < 180) return;

      const previousMask = remoteJoystickMaskRef.current;

      addInputDebug('guest input timed out, releasing held keys', 0, 'guest remote');
      forwardJoystickMaskAsKeys(0, 2, previousMask);
      remoteJoystickMaskRef.current = 0;
    }, 90);

    return () => {
      window.clearInterval(staleRemoteInputTimer);
    };
  }, [addInputDebug, forwardJoystickMaskAsKeys, isHost]);

  useEffect(() => {
    if (isHost !== true) {
      return undefined;
    }

    const pumpRemoteHeldKeys = window.setInterval(() => {
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
  }, [forwardInputToEmulator, isHost, joystickMaskToKeys]);

  useEffect(() => {
    if (isHost !== false) return;

    sendControlConfigToHost(controlMappings.player2);
  }, [controlMappings.player2, isHost, sendControlConfigToHost]);

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

  const handleGuestPayloadOnHost = useCallback((rawMessage) => {
    try {
      const parsed = JSON.parse(rawMessage);
      addInputDebug(`host received ${formatInputPayload(parsed)}`, parsed.mask ?? null, 'guest remote');

      if (parsed.type === 'key') {
        addInputDebug(`forward to emulator ${formatInputPayload(parsed)}`);
        forwardInputToEmulator({
          type: 'amstrad_remote_input',
          key: parsed.key,
          action: parsed.action,
          player: parsed.player,
        });
      }

      if (parsed.type === 'control') {
        addInputDebug(`forward to emulator ${formatInputPayload(parsed)}`);
        forwardInputToEmulator({
          type: 'amstrad_remote_control',
          key: parsed.key,
          action: parsed.action,
          player: parsed.player,
        });
      }

      if (parsed.type === 'input_state') {
        const player = parsed.player === 2 ? 2 : 1;
        const mask = parsed.mask | 0;
        const seq = Number(parsed.seq) || 0;
        const sessionId = String(parsed.sessionId || 'legacy');

        if (sessionId !== lastRemoteInputSessionRef.current) {
          const previousMask = remoteJoystickMaskRef.current;

          if (previousMask) {
            forwardJoystickMaskAsKeys(0, player, previousMask);
          }

          lastRemoteInputSessionRef.current = sessionId;
          lastRemoteInputSeqRef.current = 0;
          remoteJoystickMaskRef.current = 0;
          addInputDebug(`guest input session ${sessionId}`, 0, 'guest remote');
        }

        if (seq && seq <= lastRemoteInputSeqRef.current) {
          addInputDebug(`ignored old P${player} state #${seq}`, remoteJoystickMaskRef.current, 'guest remote');
          return;
        }

        const previousMask = remoteJoystickMaskRef.current;

        lastRemoteInputSeqRef.current = seq || lastRemoteInputSeqRef.current;
        lastRemoteInputAtRef.current = performance.now();
        if (mask !== previousMask) {
          addInputDebug(`host received P${player} state ${mask} #${seq}`, mask, 'guest remote');
        }
        forwardJoystickMaskAsKeys(mask, player, previousMask);
        remoteJoystickMaskRef.current = mask;
      }

      if (parsed.type === 'input_config') {
        const player = parsed.player === 2 ? 2 : 1;
        const playerKey = player === 1 ? 'player1' : 'player2';
        const fallback = DEFAULT_CONTROL_MAPPINGS[playerKey];
        const mapping = normaliseMapping(parsed.mapping, fallback);

        setControlMappings((prev) => {
          const next = {
            ...prev,
            [playerKey]: mapping,
          };

          saveStoredControlMappings(next);
          return next;
        });
        addInputDebug(`host received P${player} controls ${formatMappingLabel(mapping)}`, null, 'guest remote');
      }

      if (parsed.type === 'joystick') {
        const player = parsed.player === 2 ? 2 : 1;
        const mask = parsed.mask | 0;
        const previousMask = remoteJoystickMaskRef.current;

        lastRemoteInputAtRef.current = performance.now();
        addInputDebug(`host received P${player} held mask ${mask}`, mask, 'guest remote');
        forwardJoystickMaskAsKeys(mask, player, previousMask);
        remoteJoystickMaskRef.current = mask;
      }
    } catch (err) {
      addLog(`Input parse error: ${err.message}`);
      addInputDebug(`parse error ${err.message}`);
    }
  }, [addInputDebug, addLog, forwardInputToEmulator, forwardJoystickMaskAsKeys]);

  const onSignalMessage = useCallback(async (message) => {
    if (message.type === 'system') {
      addLog(message.message);
      return;
    }

    const pc = pcRef.current;

    if (!pc) {
      addLog('Signal received before peer connection existed');
      return;
    }

    if (message.type === 'peer-ready') {
      if (isHost && localOfferRef.current) {
        const sent = sendSignalRef.current({
          type: 'offer',
          offer: localOfferRef.current,
        });

        addLog(sent ? 'Re-sent offer to ready guest' : 'Queued offer for ready guest');
      }

      return;
    }

    if (message.type === 'offer') {
      addLog('Received offer');

      await pc.setRemoteDescription(message.offer);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGatheringComplete(pc);

      sendSignalRef.current({
        type: 'answer',
        answer: pc.localDescription,
      });

      addLog('Sent answer');
      setStatus('Answer sent');
      return;
    }

    if (message.type === 'answer') {
      addLog('Received answer');

      await pc.setRemoteDescription(message.answer);
      setStatus('Peer connected');
      return;
    }

    if (message.type === 'ice-candidate' && message.candidate) {
      try {
        await pc.addIceCandidate(message.candidate);
        addLog('Added ICE candidate');
      } catch (err) {
        addLog(`ICE error: ${err.message}`);
      }
    }
  }, [addLog, isHost]);

  const { send: sendSignal, isOpen: signalingOpen } = useSignaling(roomCode, onSignalMessage);

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
    if (signalingOpen) {
      addLog('Signaling socket open');
    }
  }, [signalingOpen, addLog]);

  useEffect(() => {
    if (!signalingOpen || !room) {
      return;
    }

    sendSignal({
      type: 'peer-ready',
      role: isHost ? 'host' : 'guest',
      username,
    });
  }, [isHost, room, sendSignal, signalingOpen, username]);

  useEffect(() => {
    const pc = new RTCPeerConnection(buildRtcConfig());
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const sent = sendSignalRef.current({
          type: 'ice-candidate',
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
        sendControlConfigToHost();
      };
      channel.onmessage = (msg) => handleGuestPayloadOnHost(msg.data);
    };

    return () => {
      if (mirrorLoopRef.current) {
        cancelAnimationFrame(mirrorLoopRef.current);
      }

      dataChannelRef.current?.close();
      pc.close();
    };
  }, [addLog, handleGuestPayloadOnHost, sendControlConfigToHost]);

  useEffect(() => {
    if (isHost !== true) return undefined;

    function handleHostKeyDown(event) {
      if (!shouldHandleKey(event)) return;
      if (!inputCaptured) return;

      const mappedKey = hostKeyToCpcKeyboardKey(event.key);

      if (mappedKey || isMenuKey(event.key)) {
        addInputDebug(`host key ${event.key} down -> ${mappedKey || event.key}`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'amstrad_remote_input',
          player: 1,
          key: mappedKey || event.key,
          action: 'down',
        });

        event.preventDefault();
      }
    }

    function handleHostKeyUp(event) {
      if (!shouldHandleKey(event)) return;
      if (!inputCaptured) return;

      const mappedKey = hostKeyToCpcKeyboardKey(event.key);

      if (mappedKey || isMenuKey(event.key)) {
        addInputDebug(`host key ${event.key} up -> ${mappedKey || event.key}`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'amstrad_remote_input',
          player: 1,
          key: mappedKey || event.key,
          action: 'up',
        });

        event.preventDefault();
      }
    }

    window.addEventListener('keydown', handleHostKeyDown);
    window.addEventListener('keyup', handleHostKeyUp);

    return () => {
      window.removeEventListener('keydown', handleHostKeyDown);
      window.removeEventListener('keyup', handleHostKeyUp);
    };
  }, [addInputDebug, isHost, forwardInputToEmulator, inputCaptured]);

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

      const joyBit = keyToJoystickBit(event.key, controlMappings.player2);

      if (joyBit) {
        if (event.repeat) {
          addInputDebug(`ignored repeat ${event.key}`, guestJoystickMask, 'guest keyboard');
          event.preventDefault();
          return;
        }

        guestJoystickMask |= joyBit;
        addInputDebug(`guest key ${event.key} down`, guestJoystickMask, 'guest keyboard');

        sendLocalJoystickMask(guestJoystickMask);

        event.preventDefault();
        return;
      }

      if (isMenuKey(event.key) || event.key === '@' || event.key === 'à') {
        const payload = {
          type: 'key',
          player: 1,
          key: event.key,
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

      const joyBit = keyToJoystickBit(event.key, controlMappings.player2);

      if (joyBit) {
        guestJoystickMask &= ~joyBit;
        addInputDebug(`guest key ${event.key} up`, guestJoystickMask, 'guest keyboard');

        sendLocalJoystickMask(guestJoystickMask);

        event.preventDefault();
        return;
      }

      if (isMenuKey(event.key)) {
        const payload = {
          type: 'key',
          player: 1,
          key: event.key,
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
  }, [addInputDebug, controlMappings.player2, isHost, inputCaptured, sendLocalJoystickMask]);

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

    const draw = () => {
      try {
        ctx.drawImage(sourceCanvas, 0, 0, mirrorCanvas.width, mirrorCanvas.height);
      } catch {
        // ignore transient draw issues
      }

      mirrorLoopRef.current = requestAnimationFrame(draw);
    };

    draw();
    addLog('Mirror canvas loop started');
  }

  async function waitForEmulatorCanvas(iframe) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 8000) {
      const iframeDocument = iframe.contentDocument || iframe.contentWindow?.document;
      const emulatorCanvas = iframeDocument?.querySelector('canvas');

      if (emulatorCanvas) {
        return emulatorCanvas;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }

    throw new Error('Could not find emulator canvas in iframe');
  }

  async function startHostSession() {
    if (hostStartingRef.current || hostStartedRef.current) {
      return;
    }

    hostStartingRef.current = true;

    try {
      const pc = pcRef.current;
      const iframe = emulatorFrameRef.current;

      if (!iframe) {
        throw new Error('Emulator frame not found');
      }

      setHostStarted(true);
      addLog('Waiting for emulator iframe');

      const emulatorCanvas = await waitForEmulatorCanvas(iframe);

      startMirrorLoop(emulatorCanvas);

      const mirrorCanvas = mirrorCanvasRef.current;

      if (!mirrorCanvas) {
        throw new Error('Mirror canvas missing');
      }

      const stream = mirrorCanvas.captureStream(60);
      stream.getVideoTracks().forEach((track) => pc.addTrack(track, stream));

      const audioStream = iframe.contentWindow?.getAmstradAudioStream?.();
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
      channel.onmessage = (msg) => handleGuestPayloadOnHost(msg.data);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);
      localOfferRef.current = pc.localDescription;

      const sent = sendSignal({
        type: 'offer',
        offer: localOfferRef.current,
      });

      addLog(sent ? 'Offer sent' : 'Offer queued until signaling opens');
      setStatus('Offer created, waiting for guest');
      hostStartedRef.current = true;
    } catch (err) {
      setError(err.message);
      addLog(`Host session error: ${err.message}`);
      setHostStarted(false);
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
    if (isHost && signalingOpen) {
      startHostSession();
    }
  }, [isHost, signalingOpen]);

  useEffect(() => {
    if (room && !isHost) {
      connectGuest();
    }
  }, [isHost, room]);

  useEffect(() => {
    if (!pendingControlAction || !room) {
      return undefined;
    }

    function captureControlKey(event) {
      event.preventDefault();
      event.stopPropagation();

      const key = normaliseCapturedKey(event);
      const playerKey = activePlayer === 1 ? 'player1' : 'player2';

      sendLocalJoystickMask(0);
      setControlMappings((prev) => {
        const next = {
          ...prev,
          [playerKey]: {
            ...prev[playerKey],
            [pendingControlAction]: key,
          },
        };

        saveStoredControlMappings(next);
        return next;
      });
      addInputDebug(`mapped P${activePlayer} ${pendingControlAction} to ${formatKeyLabel(key)}`, 0, 'controls');
      setPendingControlAction(null);
    }

    window.addEventListener('keydown', captureControlKey, true);

    return () => {
      window.removeEventListener('keydown', captureControlKey, true);
    };
  }, [activePlayer, addInputDebug, pendingControlAction, room, sendLocalJoystickMask]);

  function openDiskPicker() {
    if (!isHost) return;

    fileInputRef.current?.click();
  }

  function resetActiveControlMapping() {
    const playerKey = activePlayer === 1 ? 'player1' : 'player2';

    sendLocalJoystickMask(0);
    setPendingControlAction(null);
    setControlMappings((prev) => {
      const next = {
        ...prev,
        [playerKey]: DEFAULT_CONTROL_MAPPINGS[playerKey],
      };

      saveStoredControlMappings(next);
      return next;
    });
    addInputDebug(`reset P${activePlayer} controls`, 0, 'controls');
  }

  async function handleDiskSelected(event) {
    try {
      const file = event.target.files?.[0];

      if (!file) return;

      const lowerName = file.name.toLowerCase();

      if (!lowerName.endsWith('.dsk')) {
        setError('Only .dsk files are supported right now');
        addLog(`Rejected file: ${file.name}`);
        event.target.value = '';
        return;
      }

      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      forwardInputToEmulator({
        type: 'amstrad_autoload',
        fileName: file.name,
        bytes,
      });

      setLoadedDiskName(file.name);
      addLog(`Loaded disk: ${file.name}`);
      setStatus(`Disk loaded: ${file.name}`);
      event.target.value = '';
    } catch (err) {
      setError(err.message);
      addLog(`Disk load error: ${err.message}`);
    }
  }

  return (
    <div className="page room-page">
      <div className="card room-card">
        <div className="room-topbar">
          <div className="room-title">
            <BrandMark compact />
            <h1>Room {roomCode}</h1>
            <div className="room-meta">
              <span>{username}</span>
              <span>{roleLabel}</span>
              <span>{controlLabel}</span>
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
              onClick={() => {
                setShowControlConfig((value) => !value);
                setPendingControlAction(null);
              }}
            >
              {showControlConfig ? 'Hide controls' : 'Controls'}
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

        <div className="session-strip">
          <span>{status}</span>
          <span>{signalingOpen ? 'Signaling connected' : 'Connecting signaling'}</span>
          <span>{remoteConnected ? 'Peer connected' : 'Waiting for peer'}</span>
          {loadedDiskName ? <span>{loadedDiskName}</span> : null}
        </div>

        {error ? <p className="error">{error}</p> : null}

        {showControlConfig ? (
          <div className="panel control-config-panel">
            <div className="play-header">
              <div>
                <h2>Controller setup</h2>
                <p className="muted">Player {activePlayer}: {formatMappingLabel(activeMapping)}</p>
              </div>
              <button type="button" className="secondary" onClick={resetActiveControlMapping}>
                Reset defaults
              </button>
            </div>

            <div className="control-map-grid">
              {CONTROL_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className={`control-map-button ${pendingControlAction === action.id ? 'active' : ''}`}
                  onClick={() => {
                    sendLocalJoystickMask(0);
                    setPendingControlAction(action.id);
                  }}
                >
                  <span>{action.label}</span>
                  <strong>
                    {pendingControlAction === action.id
                      ? 'Press a key'
                      : formatKeyLabel(activeMapping[action.id])}
                  </strong>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="room-layout">
          <div className="panel video-panel">
            <div className="play-header">
              <h2>{isHost ? 'Host screen' : 'Remote screen'}</h2>

              <div className="input-toolbar">
                <div className="assigned-control" aria-label="Assigned control">
                  Player {activePlayer}: {controlLabel}
                </div>

                <button
                  type="button"
                  className={inputCaptured ? 'danger' : 'secondary'}
                  onClick={inputCaptured ? releaseInputCapture : captureInput}
                >
                  {inputCaptured ? 'Release' : 'Capture'}
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
                  title="Amstrad Emulator"
                  src="/emulator/index.html"
                  style={{
                    position: 'absolute',
                    left: '-99999px',
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
                  accept=".dsk"
                  onChange={handleDiskSelected}
                  style={{ display: 'none' }}
                />

                <div style={{
                  display: 'flex',
                  gap: '10px',
                  flexWrap: 'wrap',
                }}
                >
                  <button onClick={startHostSession} disabled={hostStarted}>
                    {hostStarted ? 'Host session running' : 'Start host session'}
                  </button>

                  <button onClick={openDiskPicker} disabled={!hostStarted}>
                    Load .dsk
                  </button>
                </div>
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
