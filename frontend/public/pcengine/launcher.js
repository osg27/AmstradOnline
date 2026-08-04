(function () {
  const screen = document.getElementById('pcengine-screen');
  const gameContainer = document.getElementById('game');
  const context = screen.getContext('2d', { alpha: false });
  const isX68000 = window.location.pathname.includes('/x68000/');
  const systemName = isX68000 ? 'Sharp X68000' : 'PC Engine';
  const messagePrefix = isX68000 ? 'x68000' : 'pcengine';

  let currentRom = null;
  let firmware = null;
  let firmwareKey = '';
  let romLoadInProgress = false;
  let firmwareUrl = null;
  let externalGameUrls = [];
  let loaderScript = null;
  let gameUrl = null;
  let sharedAudioContext = null;
  let audioDestination = null;
  let audioCaptureGain = null;
  let keepAlive = null;
  let emulatorVolume = 1;
  let emulatorPaused = false;
  let localMask = 0;
  let remoteMask = 0;
  let lastSimulatedMasks = [0, 0];
  let statusText = `${systemName} ready`;
  let traceSequence = 0;

  function px68kTrace(stage, detail = '') {
    if (!isX68000) return;
    const entry = {
      sequence: ++traceSequence,
      stage,
      detail: String(detail || ''),
      elapsedMs: Math.round(performance.now()),
      timestamp: new Date().toISOString(),
    };
    console.log(`[PX68k trace ${entry.sequence}] ${stage}`, entry.detail);
    try { localStorage.setItem('osg-px68k-last-trace', JSON.stringify(entry)); } catch {}
    try { window.parent.postMessage({ type: 'x68000_trace', ...entry }, window.location.origin); } catch {}
  }

  window.EJS_px68kTrace = px68kTrace;
  if (isX68000) {
    try {
      const previous = localStorage.getItem('osg-px68k-last-trace');
      if (previous) {
        window.parent.postMessage({
          type: 'x68000_trace',
          sequence: 0,
          stage: 'previous-session-last-stage',
          detail: previous,
        }, window.location.origin);
      }
    } catch {}
  }
  px68kTrace('launcher-initialised', `launcher=2026-08-05-3 href=${window.location.href}`);

  const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;

  function drawStatus(main, sub = '') {
    statusText = main;
    context.fillStyle = '#000';
    context.fillRect(0, 0, screen.width, screen.height);
    context.fillStyle = '#fff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '700 34px system-ui, sans-serif';
    context.fillText(main, screen.width / 2, screen.height / 2 - 18);
    if (sub) {
      context.fillStyle = '#bcc4cf';
      context.font = '22px system-ui, sans-serif';
      context.fillText(sub, screen.width / 2, screen.height / 2 + 24);
    }
  }

  function ensureAudio() {
    if (!OriginalAudioContext) return null;
    if (!sharedAudioContext) {
      sharedAudioContext = new OriginalAudioContext();
    }
    if (!audioDestination) {
      audioDestination = sharedAudioContext.createMediaStreamDestination();
      audioCaptureGain = sharedAudioContext.createGain();
      audioCaptureGain.gain.value = emulatorVolume;
      audioCaptureGain.connect(audioDestination);
      keepAlive = sharedAudioContext.createOscillator();
      const gain = sharedAudioContext.createGain();
      gain.gain.value = 0;
      keepAlive.connect(gain).connect(audioCaptureGain);
      keepAlive.start();
    }
    return sharedAudioContext;
  }

  if (OriginalAudioContext) {
    function SharedAudioContext(...args) {
      if (!sharedAudioContext) {
        sharedAudioContext = new OriginalAudioContext(...args);
      }
      ensureAudio();
      return sharedAudioContext;
    }

    SharedAudioContext.prototype = OriginalAudioContext.prototype;
    window.AudioContext = SharedAudioContext;
    window.webkitAudioContext = SharedAudioContext;

    const originalConnect = window.AudioNode?.prototype?.connect;
    if (originalConnect && !window.__oldStylePcEngineAudioPatched) {
      window.__oldStylePcEngineAudioPatched = true;
      window.AudioNode.prototype.connect = function patchedConnect(destination, ...args) {
        const result = originalConnect.call(this, destination, ...args);
        if (
          audioDestination
          && destination === sharedAudioContext?.destination
          && this !== audioDestination
        ) {
          try {
            originalConnect.call(this, audioCaptureGain || audioDestination);
          } catch {
            // Some nodes only allow one output. The main audio path should keep working.
          }
        }
        return result;
      };
    }
  }

  window.getPcEngineAudioStream = function getPcEngineAudioStream() {
    const audioContext = ensureAudio();
    audioContext?.resume?.().catch(() => {});
    return audioDestination?.stream || null;
  };
  window.getX68000AudioStream = window.getPcEngineAudioStream;

  function setEmulatorVolume(volume) {
    emulatorVolume = Math.min(1, Math.max(0, Number(volume) || 0));
    window.EJS_volume = emulatorVolume;
    if (audioCaptureGain && sharedAudioContext) {
      audioCaptureGain.gain.setValueAtTime(emulatorPaused ? 0 : emulatorVolume, sharedAudioContext.currentTime);
    }
    window.EJS_emulator?.setVolume?.(emulatorPaused ? 0 : emulatorVolume);
  }

  function setEmulatorPaused(paused) {
    emulatorPaused = Boolean(paused);
    setMask(1, 0);
    setMask(2, 0);
    if (emulatorPaused) {
      window.EJS_emulator?.pause?.(true);
    } else {
      window.EJS_emulator?.play?.(true);
    }
    setEmulatorVolume(emulatorVolume);
  }

  function maskToButtons(mask) {
    const buttons = new Array(16).fill(false);
    buttons[12] = Boolean(mask & 1);
    buttons[13] = Boolean(mask & 2);
    buttons[14] = Boolean(mask & 4);
    buttons[15] = Boolean(mask & 8);
    buttons[0] = Boolean(mask & 16); // I
    buttons[1] = Boolean(mask & 32); // II
    buttons[9] = Boolean(mask & 64); // Run
    buttons[8] = Boolean(mask & 128); // Select
    return buttons;
  }

  function buildPad(index, mask) {
    const pressedButtons = maskToButtons(mask);
    return {
      id: `Old Style PC Engine Pad ${index + 1}`,
      index,
      connected: true,
      mapping: 'standard',
      timestamp: performance.now(),
      axes: [0, 0, 0, 0],
      buttons: pressedButtons.map((pressed) => ({
        pressed,
        touched: pressed,
        value: pressed ? 1 : 0,
      })),
    };
  }

  const originalGetGamepads = navigator.getGamepads?.bind(navigator);
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value() {
      const nativePads = originalGetGamepads ? Array.from(originalGetGamepads()) : [];
      nativePads[0] = buildPad(0, localMask);
      nativePads[1] = buildPad(1, remoteMask);
      return nativePads;
    },
  });

  function simulateMask(playerIndex, nextMask) {
    const emulator = window.EJS_emulator;
    const manager = emulator?.gameManager;

    if (!emulator?.started || !manager?.simulateInput) return;

    const previous = lastSimulatedMasks[playerIndex] || 0;
    const mappings = [
      [1, 4],
      [2, 5],
      [4, 6],
      [8, 7],
      [16, 8],
      [32, 0],
      [64, 3],
      [128, 2],
    ];

    mappings.forEach(([bit, button]) => {
      const wasPressed = Boolean(previous & bit);
      const isPressed = Boolean(nextMask & bit);
      if (wasPressed !== isPressed) {
        manager.simulateInput(playerIndex, button, isPressed ? 1 : 0);
      }
    });

    lastSimulatedMasks[playerIndex] = nextMask;
  }

  function setMask(player, mask) {
    if (player === 1) {
      localMask = mask;
      simulateMask(0, mask);
    } else {
      remoteMask = mask;
      simulateMask(1, mask);
    }
  }

  function keyToMaskBit(key) {
    switch (key) {
      case 'ArrowUp':
      case 'q':
      case 'Q':
        return 1;
      case 'ArrowDown':
      case 'a':
      case 'A':
        return 2;
      case 'ArrowLeft':
      case 'o':
      case 'O':
        return 4;
      case 'ArrowRight':
      case 'p':
      case 'P':
        return 8;
      case 'x':
      case 'X':
      case 'f':
      case 'F':
        return 16;
      case 'z':
      case 'Z':
      case 'g':
      case 'G':
        return 32;
      case 'Enter':
        return 64;
      case 'c':
      case 'C':
        return 128;
      default:
        return 0;
    }
  }

  function handleKeyInput(player, key, action) {
    const bit = keyToMaskBit(key);
    if (!bit) return;

    const current = player === 1 ? localMask : remoteMask;
    const next = action === 'down' ? current | bit : current & ~bit;
    setMask(player, next);
  }

  function clearGameContainer() {
    try {
      window.EJS_emulator?.gameManager?.clearEJSResetTimer?.();
      window.EJS_emulator?.gamepad?.terminate?.();
    } catch {}

    gameContainer.innerHTML = '';
    window.EJS_emulator = null;
    lastSimulatedMasks = [0, 0];
    if (loaderScript) {
      loaderScript.remove();
      loaderScript = null;
    }
    if (typeof gameUrl === 'string' && gameUrl.startsWith('blob:')) {
      URL.revokeObjectURL(gameUrl);
    }
    gameUrl = null;
    externalGameUrls.forEach((url) => URL.revokeObjectURL(url));
    externalGameUrls = [];
  }

  function resetToReady() {
    currentRom = null;
    localMask = 0;
    remoteMask = 0;
    clearGameContainer();
    drawStatus(`${systemName} ready`, `Load a ${systemName} game from the room`);
  }

  function configureEmulator(fileName, romUrl, externalFiles = {}) {
    window.EJS_DEBUG_XX = true;
    window.EJS_player = '#game';
    window.EJS_core = isX68000 ? 'x68000' : 'pce';
    window.EJS_biosUrl = isX68000 ? firmwareUrl : undefined;
    window.EJS_gameName = fileName;
    window.EJS_gameUrl = romUrl;
    window.EJS_externalFiles = externalFiles;
    window.EJS_pathtodata = '/emulatorjs/data/';
    window.EJS_paths = {
      'emulator.js': '/emulatorjs/data/src/emulator.js',
      'emulator.css': '/emulatorjs/data/emulator.css',
      'cache.js': '/emulatorjs/data/src/cache.js',
      'compression.js': '/emulatorjs/data/src/compression.js',
      'consts.js': '/emulatorjs/data/src/consts.js',
      'GameManager.js': '/emulatorjs/data/src/GameManager.js',
      'gamepad.js': '/emulatorjs/data/src/gamepad.js',
      'license.js': '/emulatorjs/data/src/license.js',
      'netplay.js': '/emulatorjs/data/src/netplay.js',
      'setup.js': '/emulatorjs/data/src/setup.js',
      'shaders.js': '/emulatorjs/data/src/shaders.js',
      'storage.js': '/emulatorjs/data/src/storage.js',
      'utils.js': '/emulatorjs/data/src/utils.js',
      'nipplejs.js': '/emulatorjs/data/src/vendor/nipplejs.js',
      'socket.io.min.js': '/emulatorjs/data/src/vendor/socket.io.min.js',
    };
    window.EJS_startOnLoaded = true;
    window.EJS_threads = false;
    window.EJS_forceLegacyCores = false;
    window.EJS_disableAutoLang = false;
    window.EJS_disableLocalStorage = true;
    window.EJS_volume = 1;
    window.EJS_backgroundColor = '#000';
    window.EJS_color = '#2f8f76';
    window.EJS_alignStartButton = 'center';
    window.EJS_defaultControls = {
      0: {
        0: { value: 'z', value2: 'BUTTON_2' },
        2: { value: 'c', value2: 'SELECT' },
        3: { value: 'enter', value2: 'START' },
        4: { value: 'up arrow', value2: 'DPAD_UP' },
        5: { value: 'down arrow', value2: 'DPAD_DOWN' },
        6: { value: 'left arrow', value2: 'DPAD_LEFT' },
        7: { value: 'right arrow', value2: 'DPAD_RIGHT' },
        8: { value: 'x', value2: 'BUTTON_1' },
      },
      1: {
        0: { value: 'g', value2: 'BUTTON_2' },
        2: { value: 'h', value2: 'SELECT' },
        3: { value: 'enter', value2: 'START' },
        4: { value: 'q', value2: 'DPAD_UP' },
        5: { value: 'a', value2: 'DPAD_DOWN' },
        6: { value: 'o', value2: 'DPAD_LEFT' },
        7: { value: 'p', value2: 'DPAD_RIGHT' },
        8: { value: 'f', value2: 'BUTTON_1' },
      },
    };
    window.EJS_Buttons = {
      playPause: false,
      restart: false,
      mute: false,
      settings: false,
      fullscreen: false,
      saveState: false,
      loadState: false,
      screenRecord: false,
      gamepad: false,
      cheat: false,
      volumeSlider: false,
      saveSavFiles: false,
      loadSavFiles: false,
      quickSave: false,
      quickLoad: false,
      screenshot: false,
      cacheManager: false,
    };

    window.EJS_ready = () => {
      console.log(`Old Style Gaming ${systemName}: EmulatorJS ready`);
      px68kTrace('emulatorjs-ready');
    };
    window.EJS_onGameStart = () => {
      console.log(`Old Style Gaming ${systemName}: game started`);
      px68kTrace('emulatorjs-start-event');
      romLoadInProgress = false;
      statusText = '';
    };
    window.EJS_onExit = () => {
      drawStatus(`${systemName} stopped`, fileName);
    };
  }

  async function loadCurrentRom() {
    if (romLoadInProgress) {
      px68kTrace('rom-load-ignored', 'another load is already in progress');
      return;
    }
    if (!currentRom) {
      drawStatus(`${systemName} ready`, `Load a ${systemName} game from the room`);
      return;
    }
    if (isX68000 && !firmware) {
      drawStatus('X68000 firmware required', 'Load iplrom.dat and cgrom.dat from the room controls');
      return;
    }
    romLoadInProgress = true;
    px68kTrace('rom-load-begin', `${currentRom.fileName} bytes=${currentRom.bytes?.byteLength || 0} files=${currentRom.files?.length || 0}`);

    ensureAudio()?.resume?.().catch(() => {});
    drawStatus(`Checking ${systemName} runtime`, currentRom.fileName);
    try {
      await preflightEmulatorJs();
      px68kTrace('preflight-complete');
    } catch (error) {
      romLoadInProgress = false;
      drawStatus(`${systemName} runtime missing`, error.message);
      return;
    }

    clearGameContainer();
    if (firmwareUrl) URL.revokeObjectURL(firmwareUrl);
    firmwareUrl = firmware ? new File([firmware.bytes], firmware.fileName, { type: 'application/zip' }) : null;
    px68kTrace('firmware-file-created', `${firmware?.fileName || 'none'} bytes=${firmware?.bytes?.byteLength || 0}`);
    // A named File lets EmulatorJS identify .zip/.7z content, extract it and pass
    // the inner .pce/.sgx ROM to Beetle PCE. A blob URL loses the archive name and
    // causes the core to start with the blob UUID as empty/unsupported content.
    const gameFiles = currentRom.files?.length ? currentRom.files : [currentRom];
    let primaryGame = gameFiles[0];
    const externalFiles = {};
    if (isX68000 && gameFiles.length > 1) {
      gameFiles.forEach((file) => {
        const url = URL.createObjectURL(new Blob([file.bytes], { type: 'application/octet-stream' }));
        externalGameUrls.push(url);
        externalFiles[file.fileName] = url;
      });
      const playlist = gameFiles.map((file) => file.fileName).join('\n');
      primaryGame = { fileName: 'game.m3u', bytes: new TextEncoder().encode(playlist) };
    }
    gameUrl = new File([primaryGame.bytes], primaryGame.fileName, {
      type: currentRom.fileName.toLowerCase().endsWith('.7z')
        ? 'application/x-7z-compressed'
        : 'application/octet-stream',
    });
    configureEmulator(primaryGame.fileName, gameUrl, externalFiles);
    px68kTrace('emulator-configured', `primary=${primaryGame.fileName} bytes=${primaryGame.bytes?.byteLength || 0} external=${Object.keys(externalFiles).length}`);
    drawStatus(`Loading ${systemName}`, currentRom.fileName);

    loaderScript = document.createElement('script');
    loaderScript.src = `/emulatorjs/data/loader.js?v=${Date.now()}`;
    loaderScript.async = true;
    loaderScript.onerror = () => {
      romLoadInProgress = false;
      drawStatus(`${systemName} failed to load`, 'Could not load EmulatorJS');
    };
    document.body.appendChild(loaderScript);
    px68kTrace('loader-script-appended', loaderScript.src);
  }

  async function preflightEmulatorJs() {
    const required = [
      '/emulatorjs/data/loader.js',
      '/emulatorjs/data/src/emulator.js',
      '/emulatorjs/data/src/compression.js',
      '/emulatorjs/data/compression/extractzip.js',
      `/emulatorjs/data/cores/${isX68000 ? 'px68k' : 'mednafen_pce'}-wasm.data`,
    ];

    for (const path of required) {
      const response = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
      const contentType = response.headers.get('content-type') || '';

      if (!response.ok || contentType.includes('text/html')) {
        throw new Error(`${path} returned ${response.status || 'HTML'}`);
      }
    }
  }

  window.addEventListener('error', (event) => {
    const where = event.filename ? `${event.filename.split('/').slice(-3).join('/')} ${event.lineno || ''}`.trim() : '';
    const message = [event.message || 'Check browser console', where].filter(Boolean).join(' - ');
    console.error(`Old Style Gaming ${systemName} error:`, event.error || event.message, event.filename);
    drawStatus(`${systemName} error`, message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error(`Old Style Gaming ${systemName} promise error:`, event.reason);
    drawStatus(`${systemName} error`, event.reason?.message || 'Check browser console');
  });

  function mirrorEmulatorCanvas() {
    const gameCanvas = gameContainer.querySelector('canvas');

    if (gameCanvas && gameCanvas.width && gameCanvas.height) {
      context.fillStyle = '#000';
      context.fillRect(0, 0, screen.width, screen.height);

      const scale = Math.min(screen.width / gameCanvas.width, screen.height / gameCanvas.height);
      const width = gameCanvas.width * scale;
      const height = gameCanvas.height * scale;
      const x = (screen.width - width) / 2;
      const y = (screen.height - height) / 2;

      context.imageSmoothingEnabled = false;
      context.drawImage(gameCanvas, x, y, width, height);
    } else if (statusText) {
      // Keep the last status frame visible until the core creates its own canvas.
    }

    requestAnimationFrame(mirrorEmulatorCanvas);
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;

    const message = event.data || {};
    if (message.type === `${messagePrefix}_start`) {
      window.getPcEngineAudioStream();
      return;
    }

    if (message.type === 'x68000_firmware') {
      const bytes = new Uint8Array(message.bytes || []);
      const nextFirmwareKey = `${message.fileName || 'x68000-firmware.zip'}:${bytes.byteLength}`;
      if (nextFirmwareKey === firmwareKey) return;
      firmwareKey = nextFirmwareKey;
      firmware = { fileName: message.fileName || 'x68000-firmware.zip', bytes };
      px68kTrace('firmware-received', nextFirmwareKey);
      if (currentRom) loadCurrentRom();
      return;
    }

    if (message.type === `${messagePrefix}_autoload`) {
      currentRom = {
        fileName: message.fileName || (isX68000 ? 'game.dim' : 'game.pce'),
        bytes: new Uint8Array(message.bytes || []),
        files: (message.files || []).map((file) => ({ fileName: file.fileName, bytes: new Uint8Array(file.bytes || []) })),
      };
      px68kTrace('rom-received', `${currentRom.fileName} bytes=${currentRom.bytes.byteLength} files=${currentRom.files.length}`);
      loadCurrentRom();
      return;
    }

    if (message.type === `${messagePrefix}_reset`) {
      resetToReady();
      return;
    }

    if (message.type === 'amstrad_audio_unlock') {
      window.getPcEngineAudioStream();
      return;
    }

    if (message.type === 'emulator_set_volume') {
      setEmulatorVolume(message.volume);
      return;
    }

    if (message.type === 'emulator_set_paused') {
      setEmulatorPaused(message.paused);
      return;
    }

    if (message.type === 'amstrad_remote_joystick') {
      setMask(message.player || 1, Number(message.mask) || 0);
      return;
    }

    if (message.type === 'amstrad_remote_input' || message.type === 'amstrad_remote_control') {
      handleKeyInput(message.player || 1, message.key, message.action);
    }
  });

  screen.addEventListener('pointerdown', () => {
    window.getPcEngineAudioStream();
    window.focus();
  });

  drawStatus(`${systemName} ready`, `Load a ${systemName} game from the room`);
  mirrorEmulatorCanvas();
})();
