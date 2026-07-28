(function () {
  const isBeetleSaturn = window.location.pathname.startsWith('/saturn-beetle/');
  const isSaturn = isBeetleSaturn || window.location.pathname.startsWith('/saturn/');
  const systemName = isSaturn ? 'Saturn' : 'PlayStation';
  const messagePrefix = isSaturn ? 'saturn' : 'playstation';
  const screen = document.getElementById('playstation-screen');
  const gameContainer = document.getElementById('game');
  const context = screen.getContext('2d', { alpha: false });

  let currentRom = null;
  let loaderScript = null;
  let gameUrl = null;
  let externalGameUrls = [];
  let sharedAudioContext = null;
  let audioDestination = null;
  let audioCaptureGain = null;
  let keepAlive = null;
  let emulatorVolume = 1;
  let emulatorPaused = false;
  let localMask = 0;
  let remoteMask = 0;
  let lastSimulatedMasks = [0, 0];
  let bios = null;
  let biosUrl = null;
  let statusText = `${systemName} ready`;
  let showNativeCanvas = false;
  let pendingAccurateSaturnRom = null;

  const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;

  function drawStatus(main, sub = '') {
    statusText = main;
    if (isBeetleSaturn) {
      showNativeCanvas = false;
      screen.style.display = 'block';
    }
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
    if (originalConnect && !window.__oldStylePlayStationAudioPatched) {
      window.__oldStylePlayStationAudioPatched = true;
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

  const getSystemAudioStream = function getSystemAudioStream() {
    const audioContext = ensureAudio();
    audioContext?.resume?.().catch(() => {});
    return audioDestination?.stream || null;
  };
  window.getPlayStationAudioStream = getSystemAudioStream;
  window.getSaturnAudioStream = getSystemAudioStream;

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
    buttons[0] = Boolean(mask & 16); // Cross
    buttons[1] = Boolean(mask & 32); // Circle
    buttons[9] = Boolean(mask & 64); // Start
    buttons[2] = Boolean(mask & 128); // Square
    buttons[3] = Boolean(mask & 256); // Triangle
    buttons[8] = Boolean(mask & 512); // Select
    buttons[4] = Boolean(mask & 1024); // L1
    buttons[5] = Boolean(mask & 2048); // R1
    return buttons;
  }

  function buildPad(index, mask) {
    const pressedButtons = maskToButtons(mask);
    return {
      id: `Old Style PlayStation Pad ${index + 1}`,
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
      [32, 8],
      [64, 3],
      [128, 1],
      [256, 9],
      [512, 2],
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
    drawStatus(`${systemName} ready`, `Load a ${systemName} game from the room`);
  }

  function configureEmulator(fileName, romUrl, externalFiles = {}) {
    window.EJS_DEBUG_XX = true;
    window.EJS_player = '#game';
    // Use the concrete core name for the isolated Saturn build. Using a new
    // system alias here makes an older cached consts.js treat the alias as the
    // core filename and request a non-existent *-legacy-wasm.data payload.
    window.EJS_core = isBeetleSaturn ? 'mednafen_saturn' : isSaturn ? 'segaSaturn' : 'psx';
    window.EJS_biosUrl = biosUrl;
    window.EJS_gameName = fileName;
    window.EJS_gameUrl = romUrl;
    window.EJS_externalFiles = externalFiles;
    window.EJS_rawFiles = isBeetleSaturn && bios
      ? {
        '/sega_101.bin': bios.bytes,
        '/mpr-17933.bin': bios.bytes,
      }
      : undefined;
    window.EJS_retroarchOpts = isSaturn
      ? [
        { name: 'system_directory', default: '/', isString: true },
      ]
      : undefined;
    window.EJS_pathtodata = '/emulatorjs/data/';
    window.EJS_paths = {
      'emulator.js': `/emulatorjs/data/src/emulator.js?v=${isBeetleSaturn ? '2026-07-28-3' : '2026-07-27-1'}`,
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
    window.EJS_threads = isBeetleSaturn;
    window.EJS_forceLegacyCores = false;
    window.EJS_disableAutoLang = false;
    window.EJS_disableLocalStorage = true;
    window.EJS_disableDatabases = isSaturn;
    window.EJS_cacheConfig = isSaturn ? { enabled: false } : undefined;
    window.EJS_volume = 1;
    window.EJS_backgroundColor = '#000';
    window.EJS_color = '#2f8f76';
    window.EJS_alignStartButton = 'center';
    window.EJS_defaultControls = {
      0: {
        0: { value: 'x', value2: 'BUTTON_1' },
        1: { value: 'c', value2: 'BUTTON_2' },
        2: { value: 'shift', value2: 'SELECT' },
        3: { value: 'enter', value2: 'START' },
        4: { value: 'up arrow', value2: 'DPAD_UP' },
        5: { value: 'down arrow', value2: 'DPAD_DOWN' },
        6: { value: 'left arrow', value2: 'DPAD_LEFT' },
        7: { value: 'right arrow', value2: 'DPAD_RIGHT' },
        8: { value: 'z', value2: 'BUTTON_3' },
        9: { value: 'v', value2: 'BUTTON_4' },
        10: { value: 'd', value2: 'LEFT_TOP_SHOULDER' },
        11: { value: 's', value2: 'RIGHT_TOP_SHOULDER' },
      },
      1: {
        0: { value: 'f', value2: 'BUTTON_1' },
        1: { value: 'h', value2: 'BUTTON_2' },
        2: { value: 'shift', value2: 'SELECT' },
        3: { value: 'enter', value2: 'START' },
        4: { value: 'q', value2: 'DPAD_UP' },
        5: { value: 'a', value2: 'DPAD_DOWN' },
        6: { value: 'o', value2: 'DPAD_LEFT' },
        7: { value: 'p', value2: 'DPAD_RIGHT' },
        8: { value: 'g', value2: 'BUTTON_3' },
        9: { value: 'j', value2: 'BUTTON_4' },
      },
    };
    window.EJS_defaultOptions = isBeetleSaturn
      ? {
        // Mid-frame synchronisation can stall the threaded WebAssembly
        // frontend before its first complete video/audio frame.
        beetle_saturn_midsync: 'disabled',
        // With no disc there is nothing to auto-detect the console region
        // from. Match the known-good Japanese BIOS used by this test.
        beetle_saturn_region: 'Japan',
      }
      : isSaturn
      ? {
        yabause_force_hle_bios: 'disabled',
        yabause_frameskip: 'disabled',
        yabause_numthreads: '1',
      }
      : undefined;
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
    };
    window.EJS_onGameStart = () => {
      console.log(`Old Style Gaming ${systemName}: game started`);
      statusText = '';
      if (isBeetleSaturn) {
        showNativeCanvas = true;
        screen.style.display = 'none';
      }
      ensureAudio()?.resume?.().catch(() => {});
      setEmulatorVolume(emulatorVolume);
    };
    window.EJS_onExit = () => {
      drawStatus(`${systemName} stopped`, fileName);
    };
  }

  async function loadCurrentRom() {
    if (!currentRom) {
      drawStatus(`${systemName} ready`, `Load a ${systemName} game from the room`);
      return;
    }
    if (isSaturn && !bios) {
      drawStatus('Saturn BIOS required', 'Load your local saturn_bios.bin first');
      return;
    }

    ensureAudio()?.resume?.().catch(() => {});
    drawStatus(`Checking ${systemName} runtime`, currentRom.fileName);
    try {
      await preflightEmulatorJs();
    } catch (error) {
      drawStatus(`${systemName} runtime missing`, error.message);
      return;
    }

    clearGameContainer();
    const gameFiles = currentRom.files?.length
      ? currentRom.files
      : [{ fileName: currentRom.fileName, bytes: currentRom.bytes }];
    const primaryGame = gameFiles.find((file) => file.fileName.toLowerCase().endsWith('.cue')) || gameFiles[0];
    const externalFiles = {};

    gameFiles.forEach((file) => {
      if (file === primaryGame) return;
      const url = URL.createObjectURL(new Blob([file.bytes], { type: 'application/octet-stream' }));
      externalGameUrls.push(url);
      externalFiles[file.fileName] = url;
    });

    // EmulatorJS uses the File name to detect and extract archives. An anonymous
    // blob URL can make a ZIP reach PCSX as an unknown file with no content.
    gameUrl = new File([primaryGame.bytes], primaryGame.fileName, { type: 'application/octet-stream' });
    biosUrl = bios
      ? new File([bios.bytes], isSaturn ? 'saturn_bios.bin' : bios.fileName, { type: 'application/octet-stream' })
      : null;
    configureEmulator(primaryGame.fileName, gameUrl, externalFiles);
    drawStatus(`Loading ${systemName}`, primaryGame.fileName);

    loaderScript = document.createElement('script');
    loaderScript.src = `/emulatorjs/data/loader.js?v=${Date.now()}`;
    loaderScript.async = true;
    loaderScript.onerror = () => drawStatus(`${systemName} failed to load`, 'Could not load EmulatorJS');
    document.body.appendChild(loaderScript);
  }

  async function preflightEmulatorJs() {
    const required = [
      '/emulatorjs/data/loader.js',
      '/emulatorjs/data/src/emulator.js',
      '/emulatorjs/data/src/compression.js',
      '/emulatorjs/data/compression/extract7z.js',
      '/emulatorjs/data/compression/extractzip.js',
      `/emulatorjs/data/cores/${isBeetleSaturn ? 'mednafen_saturn-thread' : isSaturn ? 'yabause' : 'pcsx_rearmed'}-wasm.data`,
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
    if (showNativeCanvas) {
      requestAnimationFrame(mirrorEmulatorCanvas);
      return;
    }

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
      getSystemAudioStream();
      return;
    }

    if (message.type === `${messagePrefix}_autoload`) {
      const nextRom = {
        fileName: message.fileName || 'game.chd',
        bytes: new Uint8Array(message.bytes || []),
        files: (message.files || []).map((file) => ({
          fileName: file.fileName,
          bytes: new Uint8Array(file.bytes || []),
        })),
      };
      if (isBeetleSaturn) {
        // Keep the selected disc ready for the next phase of the isolated
        // core test, but first prove that the core can render and play audio
        // from the Saturn BIOS with no disc mounted.
        pendingAccurateSaturnRom = nextRom;
        return;
      }
      currentRom = nextRom;
      loadCurrentRom();
      return;
    }

    if (message.type === `${messagePrefix}_reset`) {
      resetToReady();
      return;
    }

    if (message.type === `${messagePrefix}_bios`) {
      bios = {
        fileName: message.fileName || (isSaturn ? 'saturn_bios.bin' : 'scph5501.bin'),
        bytes: new Uint8Array(message.bytes || []),
      };
      if (isBeetleSaturn) {
        currentRom = {
          // Beetle Saturn deliberately falls back to its BIOS when content
          // is not a recognised disc or ST-V image.
          fileName: 'Saturn BIOS Boot.biosboot',
          bytes: new Uint8Array([0]),
          files: [],
        };
        drawStatus(`${systemName} BIOS boot`, 'No disc mounted');
        loadCurrentRom();
        return;
      }
      drawStatus(`${systemName} BIOS ready`, bios.fileName);
      return;
    }

    if (message.type === 'amstrad_audio_unlock') {
      getSystemAudioStream();
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
    getSystemAudioStream();
    window.focus();
  });
  gameContainer.addEventListener('pointerdown', () => {
    getSystemAudioStream();
    window.focus();
  });

  drawStatus(`${systemName} ready`, `Load a ${systemName} game from the room`);
  mirrorEmulatorCanvas();
})();
