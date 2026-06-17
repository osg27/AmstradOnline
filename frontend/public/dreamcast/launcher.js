(function () {
  const screen = document.getElementById('dreamcast-screen');
  const gameContainer = document.getElementById('game');
  const context = screen.getContext('2d', { alpha: false });

  let currentRom = null;
  let bootBiosOnly = false;
  let loaderScript = null;
  let gameUrl = null;
  let externalGameUrls = [];
  let dreamcastBios = {
    boot: null,
    flash: null,
  };
  let sharedAudioContext = null;
  let audioDestination = null;
  let keepAlive = null;
  let localMask = 0;
  let remoteMask = 0;
  let lastSimulatedMasks = [0, 0];
  let statusText = 'Dreamcast ready';

  const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
  const FLYCAST_CORE_OPTIONS = {
    reicast_hle_bios: 'disabled',
    reicast_threaded_rendering: 'disabled',
    reicast_synchronous_rendering: 'disabled',
    reicast_internal_resolution: '640x480',
    reicast_mipmapping: 'disabled',
    reicast_anisotropic_filtering: '1',
    reicast_texupscale: 'disabled',
    reicast_enable_rttb: 'disabled',
    reicast_enable_purupuru: 'disabled',
    reicast_alpha_sorting: 'per-strip (fast, least accurate)',
    reicast_delay_frame_swapping: 'disabled',
    reicast_frame_skipping: 'enabled',
    reicast_framerate: 'normal',
  };

  function buildFlycastCoreOptions(bootToBios = false) {
    return {
      reicast_boot_to_bios: bootToBios ? 'enabled' : 'disabled',
      ...FLYCAST_CORE_OPTIONS,
    };
  }

  function serialiseCoreOptions(options) {
    return Object.entries(options)
      .map(([key, value]) => `${key} = "${value}"`)
      .join('\n') + '\n';
  }

  function installConsoleForwarding() {
    if (window.__oldStyleDreamcastConsoleForwarded) return;
    window.__oldStyleDreamcastConsoleForwarded = true;

    let forwardedCount = 0;
    const forward = (level, args) => {
      if (forwardedCount >= 80) return;

      const text = args.map((arg) => {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return arg.stack || arg.message;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }).join(' ');

      if (!text) return;
      if (
        !/flycast|retroarch|reicast|shader|webgl|gl_|bios|chd|gdrom|disc|load|failed|error|warn|trace|callMain|exception/i.test(text)
        && level === 'log'
      ) {
        return;
      }

      forwardedCount += 1;
      sendHostStatus(`${level}: ${text.slice(0, 240)}`);
    };

    ['log', 'warn', 'error'].forEach((level) => {
      const original = console[level]?.bind(console);
      if (!original) return;
      console[level] = (...args) => {
        original(...args);
        forward(level, args);
      };
    });
  }

  function installFlycastWebGlPatches() {
    if (window.__oldStyleFlycastWebGlPatched) return;
    window.__oldStyleFlycastWebGlPatched = true;

    const originalWarn = console.warn;
    console.warn = function patchedWarn(...args) {
      const message = typeof args[0] === 'string' ? args[0] : '';
      if (message.includes('__syscall_mprotect') || message.includes('is not a valid value')) return;
      originalWarn.apply(console, args);
    };

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, attrs) {
      const context = originalGetContext.call(this, type, attrs);
      if (!context || (type !== 'webgl2' && type !== 'experimental-webgl2') || context.__flycastPatched) {
        return context;
      }

      context.__flycastPatched = true;
      const originalGetParameter = context.getParameter.bind(context);
      context.getParameter = function patchedGetParameter(parameterName) {
        if (parameterName === 0x1f02 || parameterName === context.VERSION) {
          return 'OpenGL ES 3.0 WebGL 2.0';
        }
        if (parameterName === 0x8b8c || parameterName === context.SHADING_LANGUAGE_VERSION) {
          return 'OpenGL ES GLSL ES 3.00';
        }
        return originalGetParameter(parameterName);
      };

      const originalGetError = context.getError.bind(context);
      context.getError = function patchedGetError() {
        let error = originalGetError();
        while (error === 0x500) {
          error = originalGetError();
        }
        return error;
      };

      const textureBindings = {
        [context.TEXTURE_2D]: context.TEXTURE_BINDING_2D,
        [context.TEXTURE_CUBE_MAP]: context.TEXTURE_BINDING_CUBE_MAP,
        [context.TEXTURE_3D]: context.TEXTURE_BINDING_3D,
        [context.TEXTURE_2D_ARRAY]: context.TEXTURE_BINDING_2D_ARRAY,
      };
      const originalTexParameteri = context.texParameteri.bind(context);
      context.texParameteri = function patchedTexParameteri(target, parameterName, parameter) {
        const binding = textureBindings[target];
        if (binding && !originalGetParameter(binding)) return undefined;
        return originalTexParameteri(target, parameterName, parameter);
      };
      const originalTexParameterf = context.texParameterf.bind(context);
      context.texParameterf = function patchedTexParameterf(target, parameterName, parameter) {
        const binding = textureBindings[target];
        if (binding && !originalGetParameter(binding)) return undefined;
        return originalTexParameterf(target, parameterName, parameter);
      };

      console.log('[flycast-wasm] Patched WebGL2 context');
      return context;
    };
  }

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

  function sendHostStatus(message) {
    window.parent?.postMessage({ type: 'dreamcast_status', message }, window.location.origin);
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

  function configureEmulator(fileName, romUrl, externalFiles = {}, options = {}) {
    window.EJS_DEBUG_XX = true;
    window.EJS_player = '#game';
    window.EJS_core = 'dreamcast';
    window.EJS_gameName = fileName;
    window.EJS_gameUrl = romUrl;
    window.EJS_externalFiles = externalFiles;
    window.EJS_defaultOptions = buildFlycastCoreOptions(Boolean(options.bootToBios));
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
    window.EJS_dontExtractRom = true;
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

  function installFlycastStartGamePatch() {
    if (window.__oldStyleFlycastStartGamePatchInstalled) return;
    window.__oldStyleFlycastStartGamePatchInstalled = true;

    const timer = window.setInterval(() => {
      const emulator = window.EJS_emulator;
      if (!emulator || emulator.__oldStyleFlycastStartGamePatched || typeof emulator.startGame !== 'function') return;

      emulator.__oldStyleFlycastStartGamePatched = true;
      window.clearInterval(timer);

      const originalStartGame = emulator.startGame;
      emulator.startGame = function patchedStartGame(...args) {
        try {
          const fs = this.gameManager?.FS;
          if (fs) {
            try {
              if (!fs.analyzePath('/dc').exists) fs.mkdir('/dc');
            } catch {}

            try {
              this.gameManager.writeFile('/dc_boot.bin', dreamcastBios.boot.bytes);
              this.gameManager.writeFile('/dc_flash.bin', dreamcastBios.flash.bytes);
              this.gameManager.writeFile('/dc/dc_boot.bin', dreamcastBios.boot.bytes);
              this.gameManager.writeFile('/dc/dc_flash.bin', dreamcastBios.flash.bytes);
            } catch (error) {
              console.warn('[Old Style Dreamcast] BIOS FS write failed', error);
            }

            if (this.Module?.callbacks) {
              const coreOptions = serialiseCoreOptions(buildFlycastCoreOptions(bootBiosOnly));
              const originalSetupCoreSettingFile = this.Module.callbacks.setupCoreSettingFile;
              this.Module.callbacks.setupCoreSettingFile = (filePath) => {
                try {
                  this.gameManager.writeFile(filePath, coreOptions);
                } catch (error) {
                  console.warn('[Old Style Dreamcast] Core option write failed', error);
                }
                if (originalSetupCoreSettingFile) {
                  originalSetupCoreSettingFile(filePath);
                }
              };
            }

            const cfgPath = '/home/web_user/.config/retroarch/retroarch.cfg';
            try {
              const cfg = new TextDecoder().decode(fs.readFile(cfgPath));
              if (!cfg.includes('system_directory')) {
                fs.writeFile(cfgPath, `${cfg}system_directory = "/"\n`);
              }
            } catch {}

            const hasBoot = fs.analyzePath('/dc/dc_boot.bin').exists;
            const hasFlash = fs.analyzePath('/dc/dc_flash.bin').exists;
            const bootMessage = `Flycast booting ${this.fileName || 'Dreamcast BIOS'} / BIOS ${hasBoot && hasFlash ? 'ok' : 'missing'}`;
            console.log(`[Old Style Dreamcast] ${bootMessage}`);
            sendHostStatus(bootMessage);
          }
        } catch (error) {
          console.warn('[Old Style Dreamcast] startGame patch failed', error);
          sendHostStatus(`Flycast preboot check failed: ${error.message || error}`);
        }

        return originalStartGame.apply(this, args);
      };
    }, 50);
  }

  async function loadCurrentRom() {
    if (!currentRom && !bootBiosOnly) {
      drawStatus('Dreamcast ready', 'Load a Dreamcast game from the room');
      return;
    }

    if (!dreamcastBios.boot || !dreamcastBios.flash) {
      drawStatus('Dreamcast BIOS needed', 'Load dc_boot.bin and dc_flash.bin');
      sendHostStatus('Dreamcast BIOS needed: load dc_boot.bin and dc_flash.bin');
      return;
    }

    ensureAudio()?.resume?.().catch(() => {});
    drawStatus('Checking Dreamcast runtime', bootBiosOnly ? 'Dreamcast BIOS' : currentRom.fileName);
    try {
      await preflightEmulatorJs();
    } catch (error) {
      drawStatus('Dreamcast runtime missing', error.message);
      return;
    }

    clearGameContainer();
    const gameFiles = bootBiosOnly
      ? [{ fileName: '__dreamcast_bios_boot.chd', bytes: new Uint8Array([0]) }]
      : currentRom.files?.length
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
    installConsoleForwarding();
    installFlycastWebGlPatches();
    installFlycastStartGamePatch();
    configureEmulator(primaryGame.fileName, gameUrl, externalFiles, { bootToBios: bootBiosOnly });
    drawStatus(bootBiosOnly ? 'Booting Dreamcast BIOS' : 'Loading Dreamcast', bootBiosOnly ? 'No disc inserted' : primaryGame.fileName);
    sendHostStatus(bootBiosOnly ? 'Starting Dreamcast BIOS' : `Starting Dreamcast game: ${primaryGame.fileName}`);

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
      if (!gameCanvas.__oldStyleDreamcastProbeStarted) {
        gameCanvas.__oldStyleDreamcastProbeStarted = true;
        let probes = 0;
        const probeCanvas = document.createElement('canvas');
        probeCanvas.width = 8;
        probeCanvas.height = 8;
        const probeContext = probeCanvas.getContext('2d', { willReadFrequently: true });
        const probe = () => {
          probes += 1;
          try {
            probeContext.drawImage(gameCanvas, 0, 0, 8, 8);
            const pixels = probeContext.getImageData(0, 0, 8, 8).data;
            let lit = false;
            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i] || pixels[i + 1] || pixels[i + 2]) {
                lit = true;
                break;
              }
            }
            if (lit) {
              sendHostStatus('Flycast canvas is rendering video');
              return;
            }
          } catch (error) {
            sendHostStatus(`Flycast canvas probe failed: ${error.message || error}`);
            return;
          }
          if (probes < 12) window.setTimeout(probe, 1000);
        };
        window.setTimeout(probe, 1000);
      }

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
      bootBiosOnly = false;
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

    if (message.type === 'dreamcast_boot_bios') {
      bootBiosOnly = true;
      currentRom = null;
      loadCurrentRom();
      return;
    }

    if (message.type === 'dreamcast_bios') {
      const files = (message.files || []).map((file) => ({
        fileName: String(file.fileName || '').toLowerCase(),
        bytes: new Uint8Array(file.bytes || []),
      }));
      const boot = files.find((file) => file.fileName === 'dc_boot.bin');
      const flash = files.find((file) => file.fileName === 'dc_flash.bin');

      if (!boot || !flash) {
        drawStatus('Dreamcast BIOS incomplete', 'Need dc_boot.bin and dc_flash.bin');
        sendHostStatus('Dreamcast BIOS incomplete');
        return;
      }

      dreamcastBios = { boot, flash };
      drawStatus('Dreamcast BIOS ready', currentRom?.fileName || 'Load a Dreamcast game');
      sendHostStatus('Dreamcast BIOS received');
      if (currentRom || bootBiosOnly) {
        loadCurrentRom();
      }
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
