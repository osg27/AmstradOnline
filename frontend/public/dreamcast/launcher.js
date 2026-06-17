(function () {
  const screen = document.getElementById('dreamcast-screen');
  const gameContainer = document.getElementById('game');
  const context = screen.getContext('2d', { alpha: false });

  let currentRom = null;
  let loaderScript = null;
  let gameUrl = null;
  let externalGameUrls = [];
  let sharedAudioContext = null;
  let audioDestination = null;
  let keepAlive = null;
  let localMask = 0;
  let remoteMask = 0;
  let lastSimulatedMasks = [0, 0];
  let statusText = 'Dreamcast ready';

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
      keepAlive = sharedAudioContext.createOscillator();
      const gain = sharedAudioContext.createGain();
      gain.gain.value = 0;
      keepAlive.connect(gain).connect(audioDestination);
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
    if (originalConnect && !window.__oldStyleDreamcastAudioPatched) {
      window.__oldStyleDreamcastAudioPatched = true;
      window.AudioNode.prototype.connect = function patchedConnect(destination, ...args) {
        const result = originalConnect.call(this, destination, ...args);
        if (
          audioDestination
          && destination === sharedAudioContext?.destination
          && this !== audioDestination
        ) {
          try {
            originalConnect.call(this, audioDestination);
          } catch {
            // Some nodes only allow one output. The main audio path should keep working.
          }
        }
        return result;
      };
    }
  }

  window.getDreamcastAudioStream = function getDreamcastAudioStream() {
    const audioContext = ensureAudio();
    audioContext?.resume?.().catch(() => {});
    return audioDestination?.stream || null;
  };

  function maskToButtons(mask) {
    const buttons = new Array(16).fill(false);
    buttons[12] = Boolean(mask & 1);
    buttons[13] = Boolean(mask & 2);
    buttons[14] = Boolean(mask & 4);
    buttons[15] = Boolean(mask & 8);
    buttons[0] = Boolean(mask & 16); // A
    buttons[1] = Boolean(mask & 32); // B
    buttons[9] = Boolean(mask & 64); // Start
    buttons[2] = Boolean(mask & 128); // X
    buttons[3] = Boolean(mask & 256); // Y
    buttons[8] = Boolean(mask & 512); // Menu/select fallback
    buttons[6] = Boolean(mask & 1024); // L trigger
    buttons[7] = Boolean(mask & 2048); // R trigger
    return buttons;
  }

  function buildPad(index, mask) {
    const pressedButtons = maskToButtons(mask);
    return {
      id: `Old Style Dreamcast Pad ${index + 1}`,
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
      [16, 0],
      [32, 1],
      [64, 3],
      [128, 2],
      [256, 8],
      [512, 9],
      [1024, 10],
      [2048, 11],
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
      case 'v':
      case 'V':
        return 256;
      case 'Shift':
        return 512;
      case 'd':
      case 'D':
        return 1024;
      case 's':
      case 'S':
        return 2048;
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
    if (typeof gameUrl === 'string') {
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
    drawStatus('Dreamcast ready', 'Load a Dreamcast game from the room');
  }

  function configureEmulator(fileName, romUrl, externalFiles = {}) {
    window.EJS_DEBUG_XX = true;
    window.EJS_player = '#game';
    window.EJS_core = 'dreamcast';
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
        0: { value: 'x', value2: 'BUTTON_1' },
        1: { value: 'z', value2: 'BUTTON_2' },
        2: { value: 'c', value2: 'BUTTON_3' },
        3: { value: 'enter', value2: 'START' },
        4: { value: 'up arrow', value2: 'DPAD_UP' },
        5: { value: 'down arrow', value2: 'DPAD_DOWN' },
        6: { value: 'left arrow', value2: 'DPAD_LEFT' },
        7: { value: 'right arrow', value2: 'DPAD_RIGHT' },
        8: { value: 'v', value2: 'BUTTON_4' },
        10: { value: 'd', value2: 'LEFT_TOP_SHOULDER' },
        11: { value: 's', value2: 'RIGHT_TOP_SHOULDER' },
      },
      1: {
        0: { value: 'f', value2: 'BUTTON_1' },
        1: { value: 'g', value2: 'BUTTON_2' },
        2: { value: 'h', value2: 'BUTTON_3' },
        3: { value: 'enter', value2: 'START' },
        4: { value: 'q', value2: 'DPAD_UP' },
        5: { value: 'a', value2: 'DPAD_DOWN' },
        6: { value: 'o', value2: 'DPAD_LEFT' },
        7: { value: 'p', value2: 'DPAD_RIGHT' },
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
      console.log('Old Style Gaming Dreamcast: EmulatorJS ready');
    };
    window.EJS_onGameStart = () => {
      console.log('Old Style Gaming Dreamcast: game started');
      statusText = '';
    };
    window.EJS_onExit = () => {
      drawStatus('Dreamcast stopped', fileName);
    };
  }

  async function loadCurrentRom() {
    if (!currentRom) {
      drawStatus('Dreamcast ready', 'Load a Dreamcast game from the room');
      return;
    }

    ensureAudio()?.resume?.().catch(() => {});
    drawStatus('Checking Dreamcast runtime', currentRom.fileName);
    try {
      await preflightEmulatorJs();
    } catch (error) {
      drawStatus('Dreamcast runtime missing', error.message);
      return;
    }

    clearGameContainer();
    const gameFiles = currentRom.files?.length
      ? currentRom.files
      : [{ fileName: currentRom.fileName, bytes: currentRom.bytes }];
    const primaryGame = gameFiles.find((file) => /\.(gdi|cue)$/i.test(file.fileName)) || gameFiles[0];
    const externalFiles = {};

    gameFiles.forEach((file) => {
      if (file === primaryGame) return;
      const url = URL.createObjectURL(new Blob([file.bytes], { type: 'application/octet-stream' }));
      externalGameUrls.push(url);
      externalFiles[file.fileName] = url;
    });

    gameUrl = new File([primaryGame.bytes], primaryGame.fileName, { type: 'application/octet-stream' });
    configureEmulator(primaryGame.fileName, gameUrl, externalFiles);
    drawStatus('Loading Dreamcast', primaryGame.fileName);

    loaderScript = document.createElement('script');
    loaderScript.src = `/emulatorjs/data/loader.js?v=${Date.now()}`;
    loaderScript.async = true;
    loaderScript.onerror = () => drawStatus('Dreamcast failed to load', 'Could not load EmulatorJS');
    document.body.appendChild(loaderScript);
  }

  async function preflightEmulatorJs() {
    const required = [
      '/emulatorjs/data/loader.js',
      '/emulatorjs/data/src/emulator.js',
      '/emulatorjs/data/src/consts.js',
      '/emulatorjs/data/src/compression.js',
      '/emulatorjs/data/compression/extract7z.js',
      '/emulatorjs/data/compression/extractzip.js',
      '/emulatorjs/data/cores/flycast-wasm.data',
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
    console.error('Old Style Gaming Dreamcast error:', event.error || event.message, event.filename);
    drawStatus('Dreamcast error', message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('Old Style Gaming Dreamcast promise error:', event.reason);
    drawStatus('Dreamcast error', event.reason?.message || 'Check browser console');
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
    if (message.type === 'dreamcast_start') {
      window.getDreamcastAudioStream();
      return;
    }

    if (message.type === 'dreamcast_autoload') {
      currentRom = {
        fileName: message.fileName || 'game.chd',
        bytes: new Uint8Array(message.bytes || []),
        files: (message.files || []).map((file) => ({
          fileName: file.fileName,
          bytes: new Uint8Array(file.bytes || []),
        })),
      };
      loadCurrentRom();
      return;
    }

    if (message.type === 'dreamcast_reset') {
      resetToReady();
      return;
    }

    if (message.type === 'amstrad_audio_unlock') {
      window.getDreamcastAudioStream();
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
    window.getDreamcastAudioStream();
    window.focus();
  });

  drawStatus('Dreamcast ready', 'Load a Dreamcast game from the room');
  mirrorEmulatorCanvas();
})();
