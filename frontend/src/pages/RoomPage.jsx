import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import useSignaling from '../hooks/useSignaling';
import { buildRtcConfig, waitForIceGatheringComplete } from '../utils/webrtc';

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
  const [controlMode, setControlMode] = useState(() => {
    return localStorage.getItem('amstrad_control_mode') || 'keyboard';
  });

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
  const controlLabel = {
    keyboard: 'Keyboard',
    joystick1: 'Joystick 1',
    joystick2: 'Joystick 2',
  }[controlMode];
  const roleLabel = !room
    ? 'Loading...'
    : isHost ? 'Host' : 'Guest';

  const addLog = useCallback((message) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()} - ${message}`, ...prev].slice(0, 80));
  }, []);

  const sendSignalRef = useRef(() => false);

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

  function keyToJoystickBit(key) {
    switch (key) {
      case 'ArrowUp':
        return 1;
      case 'ArrowDown':
        return 2;
      case 'ArrowLeft':
        return 4;
      case 'ArrowRight':
        return 8;
      case 'Control':
      case 'ControlLeft':
      case 'ControlRight':
      case ' ':
      case 'Space':
        return 16;
      default:
        return 0;
    }
  }

  function isJoystickMode(mode) {
    return mode === 'joystick1' || mode === 'joystick2';
  }

  function getJoystickPlayer(mode) {
    return mode === 'joystick2' ? 2 : 1;
  }

  function hostKeyToCpcKeyboardKey(key) {
    switch (key) {
      case 'ArrowUp':
        return 'q';
      case 'ArrowDown':
        return 'a';
      case 'ArrowLeft':
        return 'o';
      case 'ArrowRight':
        return 'p';
      case ' ':
      case 'Space':
        return ' ';
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

  useEffect(() => {
    localStorage.setItem('amstrad_control_mode', controlMode);
  }, [controlMode]);

  const sendLocalJoystickMask = useCallback((mask) => {
    const payload = {
      type: 'joystick',
      player: getJoystickPlayer(controlMode),
      mask,
    };

    if (isHost) {
      forwardInputToEmulator({
        type: 'amstrad_remote_joystick',
        player: payload.player,
        mask: payload.mask,
      });
      return;
    }

    const channel = dataChannelRef.current;
    if (channel?.readyState === 'open') {
      channel.send(JSON.stringify(payload));
    }
  }, [controlMode, forwardInputToEmulator, isHost]);

  const releaseInputCapture = useCallback(() => {
    if (isJoystickMode(controlMode)) {
      sendLocalJoystickMask(0);
    }

    setInputCaptured(false);
  }, [controlMode, sendLocalJoystickMask]);

  const handleGuestPayloadOnHost = useCallback((rawMessage) => {
    try {
      const parsed = JSON.parse(rawMessage);

      if (parsed.type === 'key') {
        forwardInputToEmulator({
          type: 'amstrad_remote_input',
          key: parsed.key,
          action: parsed.action,
          player: parsed.player,
        });
      }

      if (parsed.type === 'joystick') {
        forwardInputToEmulator({
          type: 'amstrad_remote_joystick',
          mask: parsed.mask,
          player: parsed.player,
        });
      }
    } catch (err) {
      addLog(`Input parse error: ${err.message}`);
    }
  }, [addLog, forwardInputToEmulator]);

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
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        addLog('Remote stream attached');
      }
    };

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      dataChannelRef.current = channel;

      channel.onopen = () => addLog('Input data channel open');
      channel.onmessage = (msg) => handleGuestPayloadOnHost(msg.data);
    };

    return () => {
      if (mirrorLoopRef.current) {
        cancelAnimationFrame(mirrorLoopRef.current);
      }

      dataChannelRef.current?.close();
      pc.close();
    };
  }, [addLog, handleGuestPayloadOnHost]);

  useEffect(() => {
    if (isHost !== true) return undefined;

    let hostJoystickMask = 0;

    function handleHostKeyDown(event) {
      if (!shouldHandleKey(event)) return;
      if (!inputCaptured) return;
      if (event.repeat) return;

      if (isJoystickMode(controlMode)) {
        const joyBit = keyToJoystickBit(event.key);

        if (joyBit) {
          hostJoystickMask |= joyBit;

          forwardInputToEmulator({
            type: 'amstrad_remote_joystick',
            player: getJoystickPlayer(controlMode),
            mask: hostJoystickMask,
          });

          event.preventDefault();
          return;
        }
      }

      const mappedKey = hostKeyToCpcKeyboardKey(event.key);

      if (controlMode === 'keyboard' && (mappedKey || isMenuKey(event.key))) {
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

      if (isJoystickMode(controlMode)) {
        const joyBit = keyToJoystickBit(event.key);

        if (joyBit) {
          hostJoystickMask &= ~joyBit;

          forwardInputToEmulator({
            type: 'amstrad_remote_joystick',
            player: getJoystickPlayer(controlMode),
            mask: hostJoystickMask,
          });

          event.preventDefault();
          return;
        }
      }

      const mappedKey = hostKeyToCpcKeyboardKey(event.key);

      if (controlMode === 'keyboard' && (mappedKey || isMenuKey(event.key))) {
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
  }, [isHost, controlMode, forwardInputToEmulator, inputCaptured]);

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
      if (event.repeat) return;

      const mappedKey = hostKeyToCpcKeyboardKey(event.key);

      if (controlMode === 'keyboard' && mappedKey) {
        sendToHost({
          type: 'key',
          player: 1,
          key: mappedKey,
          action: 'down',
        });

        event.preventDefault();
        return;
      }

      if (isJoystickMode(controlMode)) {
        const joyBit = keyToJoystickBit(event.key);

        if (joyBit) {
          guestJoystickMask |= joyBit;

          sendToHost({
            type: 'joystick',
            player: getJoystickPlayer(controlMode),
            mask: guestJoystickMask,
          });

          event.preventDefault();
          return;
        }
      }

      if (isMenuKey(event.key) || event.key === '@' || event.key === 'à') {
        sendToHost({
          type: 'key',
          player: 1,
          key: event.key,
          action: 'down',
        });

        event.preventDefault();
      }
    }

    function handleGuestKeyUp(event) {
      if (!shouldHandleKey(event)) return;
      if (!inputCaptured) return;

      if (controlMode === 'keyboard') {
        const mappedKey = hostKeyToCpcKeyboardKey(event.key);

        if (mappedKey || isMenuKey(event.key)) {
          sendToHost({
            type: 'key',
            player: 1,
            key: mappedKey || event.key,
            action: 'up',
          });

          event.preventDefault();
          return;
        }
      }

      if (!isJoystickMode(controlMode)) return;

      const joyBit = keyToJoystickBit(event.key);

      if (joyBit) {
        guestJoystickMask &= ~joyBit;

        sendToHost({
          type: 'joystick',
          player: getJoystickPlayer(controlMode),
          mask: guestJoystickMask,
        });

        event.preventDefault();
        return;
      }

      if (isMenuKey(event.key)) {
        sendToHost({
          type: 'key',
          player: 1,
          key: event.key,
          action: 'up',
        });

        event.preventDefault();
      }
    }

    window.addEventListener('keydown', handleGuestKeyDown);
    window.addEventListener('keyup', handleGuestKeyUp);

    return () => {
      window.removeEventListener('keydown', handleGuestKeyDown);
      window.removeEventListener('keyup', handleGuestKeyUp);
    };
  }, [isHost, controlMode, inputCaptured]);

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

      addLog(`Added ${stream.getTracks().length} mirror track(s)`);

      const channel = pc.createDataChannel('inputs');
      dataChannelRef.current = channel;

      channel.onopen = () => addLog('Host input data channel open');
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

  function openDiskPicker() {
    if (!isHost) return;

    fileInputRef.current?.click();
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
          </div>
        </div>

        <div className="session-strip">
          <span>{status}</span>
          <span>{signalingOpen ? 'Signaling connected' : 'Connecting signaling'}</span>
          <span>{remoteConnected ? 'Peer connected' : 'Waiting for peer'}</span>
          {loadedDiskName ? <span>{loadedDiskName}</span> : null}
        </div>

        {error ? <p className="error">{error}</p> : null}

        <div className="room-layout">
          <div className="panel video-panel">
            <div className="play-header">
              <h2>{isHost ? 'Host screen' : 'Remote screen'}</h2>

              <div className="input-toolbar">
                <div className="segmented-control" aria-label="Control mode">
                  <button
                    type="button"
                    className={controlMode === 'keyboard' ? 'active' : ''}
                    onClick={() => setControlMode('keyboard')}
                  >
                    Keys
                  </button>
                  <button
                    type="button"
                    className={controlMode === 'joystick1' ? 'active' : ''}
                    onClick={() => setControlMode('joystick1')}
                  >
                    Joy 1
                  </button>
                  <button
                    type="button"
                    className={controlMode === 'joystick2' ? 'active' : ''}
                    onClick={() => setControlMode('joystick2')}
                  >
                    Joy 2
                  </button>
                </div>

                <button
                  type="button"
                  className={inputCaptured ? 'danger' : 'secondary'}
                  onClick={inputCaptured ? releaseInputCapture : () => setInputCaptured(true)}
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
                  onClick={() => setInputCaptured(true)}
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
                  muted
                  className="video"
                  onClick={() => setInputCaptured(true)}
                />

                <button onClick={connectGuest} disabled={guestPrepared}>
                  {guestPrepared ? 'Guest connection ready' : 'Prepare guest connection'}
                </button>
              </>
            )}
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
      </div>
    </div>
  );
}
