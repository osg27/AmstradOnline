(function () {
  const screen = document.getElementById('arcade-screen');
  const statusPanel = document.getElementById('arcade-status');
  const statusTitle = statusPanel?.querySelector('strong');
  const statusDetail = statusPanel?.querySelector('span');

  let currentRun = null;
  let scriptElement = null;
  let statusText = 'MAME ready';
  let localMask = 0;
  let remoteMask = 0;
  let sharedAudioContext = null;
  let audioDestination = null;
  let keepAlive = null;

  const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
  const RUN_DB = 'oldstyle-arcade-mame';
  const RUN_STORE = 'runs';
  const CURRENT_RUN_KEY = 'current';
  const PENDING_RUN_FLAG = 'oldstyle-arcade-pending-run';
  const DEFAULT_MAME_ARGS = [
    '-rompath',
    '/roms',
  ];
  const MAX_VISIBLE_CANVAS_SCALE = 0.45;

  function postArcadeLog(message, level = 'info') {
    try {
      window.parent?.postMessage({
        type: 'arcade_log',
        level,
        message: String(message || ''),
      }, window.location.origin);
    } catch {
      // Parent logging is best-effort only.
    }
  }

  function drawStatus(main, sub = '') {
    statusText = main;
    postArcadeLog(sub ? `${main}: ${sub}` : main, main.toLowerCase().includes('error') ? 'error' : 'info');
    if (!statusPanel || !statusTitle || !statusDetail) return;
    statusTitle.textContent = main;
    statusDetail.textContent = sub;
    statusPanel.classList.remove('hidden');
  }

  function hideStatus() {
    statusPanel?.classList.add('hidden');
  }

  function fitArcadeCanvas() {
    const width = Number(screen.width) || 640;
    const height = Number(screen.height) || 480;
    const viewportWidth = Math.max(1, document.documentElement.clientWidth || window.innerWidth || 1);
    const viewportHeight = Math.max(1, document.documentElement.clientHeight || window.innerHeight || 1);
    const fitScale = Math.min(
      (viewportWidth - 16) / width,
      (viewportHeight - 16) / height,
      MAX_VISIBLE_CANVAS_SCALE,
    );
    const scale = Math.max(0.05, fitScale);

    document.documentElement.style.setProperty('--arcade-fit-scale', String(scale));

    const detail = `${width}x${height} at ${Math.round(scale * 100)}% in ${viewportWidth}x${viewportHeight}`;
    if (fitArcadeCanvas.lastDetail !== detail) {
      fitArcadeCanvas.lastDetail = detail;
      postArcadeLog(`Canvas fit: ${detail}`);
    }
  }

  window.addEventListener('resize', fitArcadeCanvas);
  setInterval(fitArcadeCanvas, 500);
  fitArcadeCanvas();

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
    if (originalConnect && !window.__oldStyleArcadeAudioPatched) {
      window.__oldStyleArcadeAudioPatched = true;
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
            // Keep the normal MAME audio path working if this node cannot be split.
          }
        }
        return result;
      };
    }
  }

  window.getArcadeAudioStream = function getArcadeAudioStream() {
    const audioContext = ensureAudio();
    audioContext?.resume?.().catch(() => {});
    return audioDestination?.stream || null;
  };

  function normalizeRuntime(runtime) {
    const name = String(runtime || 'mamepacmantest.js').trim() || 'mamepacmantest.js';
    return name.endsWith('.js') ? name : `${name}.js`;
  }

  function driverFromFileName(fileName) {
    return String(fileName || 'game.zip')
      .replace(/\.(zip|7z|rar|chd)$/i, '')
      .trim()
      .toLowerCase();
  }

  function splitArgs(args) {
    return String(args || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function stripDefaultVideoArgs(args) {
    const parts = splitArgs(args);
    const filtered = [];

    for (let index = 0; index < parts.length; index += 1) {
      const arg = parts[index].toLowerCase();
      if (arg === '-verbose' || arg === '-window') continue;
      if (arg === '-video' || arg === '-resolution' || arg === '-rompath') {
        index += 1;
        continue;
      }
      filtered.push(parts[index]);
    }

    return filtered;
  }

  async function preflightRuntime(runtime) {
    const paths = [
      `/arcade/mame/${runtime}`,
      `/arcade/mame/${runtime.replace(/\.js$/i, '.wasm')}`,
    ];

    for (const path of paths) {
      const response = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || contentType.includes('text/html')) {
        throw new Error(`${path} missing`);
      }
    }
  }

  function openRunDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(RUN_DB, 1);

      request.onupgradeneeded = () => {
        request.result.createObjectStore(RUN_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open arcade ROM storage'));
    });
  }

  function withRunStore(mode, callback) {
    return openRunDb().then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(RUN_STORE, mode);
      const store = transaction.objectStore(RUN_STORE);
      const request = callback(store);

      transaction.oncomplete = () => {
        db.close();
        resolve(request?.result);
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error('Arcade ROM storage failed'));
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error || new Error('Arcade ROM storage aborted'));
      };
    }));
  }

  function bytesToBuffer(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  }

  function normalizeRun(run) {
    const files = (run.files || []).map((file) => ({
      name: file.name || 'game.zip',
      bytes: file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes || []),
    }));

    return {
      runtime: normalizeRuntime(run.runtime),
      driver: String(run.driver || driverFromFileName(files[0]?.name)).trim().toLowerCase(),
      args: run.args || '',
      files,
    };
  }

  async function saveStoredRun(run) {
    const normalized = normalizeRun(run);
    const stored = {
      ...normalized,
      files: normalized.files.map((file) => ({
        name: file.name,
        bytes: bytesToBuffer(file.bytes),
      })),
    };

    await withRunStore('readwrite', (store) => store.put(stored, CURRENT_RUN_KEY));
    return normalized;
  }

  async function loadStoredRun() {
    const stored = await withRunStore('readonly', (store) => store.get(CURRENT_RUN_KEY));

    if (!stored) return null;

    return normalizeRun({
      ...stored,
      files: (stored.files || []).map((file) => ({
        name: file.name,
        bytes: new Uint8Array(file.bytes || []),
      })),
    });
  }

  async function persistRunAndReload(run) {
    const storedRun = await saveStoredRun(run);

    if (!storedRun.driver) {
      drawStatus('MAME driver needed', 'Enter a driver name before loading the ROM');
      return;
    }

    sessionStorage.setItem(PENDING_RUN_FLAG, '1');
    postArcadeLog(`Stored ${storedRun.files.length} ROM file(s); restarting clean MAME page`);
    window.location.reload();
  }

  function buildArguments(run) {
    const args = [run.driver, ...DEFAULT_MAME_ARGS];

    stripDefaultVideoArgs(run.args).forEach((arg) => args.push(arg));
    return args;
  }

  function clearPreviousRuntime() {
    if (scriptElement) {
      scriptElement.remove();
      scriptElement = null;
    }
    delete window.Module;
  }

  function configureModule(run) {
    const canvas = screen;
    canvas.className = 'emscripten';
    canvas.tabIndex = -1;
    fitArcadeCanvas();
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      drawStatus('MAME error', 'WebGL context lost. Reload the room.');
    }, false);

    window.Module = {
      noInitialRun: false,
      arguments: buildArguments(run),
      locateFile(path) {
        return `/arcade/mame/${path}`;
      },
      preRun: [
        function mountLocalRoms() {
          window.Module.addRunDependency('oldstyle-roms');
          try {
            FS.mkdir('/roms');
          } catch {}

          try {
            run.files.forEach((file) => {
              FS.writeFile(`/roms/${file.name}`, file.bytes);
              postArcadeLog(`Mounted ${file.name} to /roms/${file.name} (${file.bytes.length} bytes)`);
              console.log(`Mounted ${file.name} to /roms/${file.name}`);
            });
          } finally {
            window.Module.removeRunDependency('oldstyle-roms');
          }
        },
      ],
      postRun: [],
      print(text) {
        postArcadeLog(text);
        console.log(text);
      },
      printErr(text) {
        postArcadeLog(text, 'error');
        console.warn(text);
      },
      canvas,
      setStatus(text) {
        if (text) {
          drawStatus('MAME loading', text);
        } else {
          hideStatus();
        }
      },
      monitorRunDependencies(left) {
        if (left) {
          drawStatus('MAME loading', `Preparing ${left} dependencies`);
        }
      },
    };
  }

  function loadScript(runtime) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.async = true;
      script.type = 'text/javascript';
      script.src = `/arcade/mame/${runtime}?v=${Date.now()}`;
      script.onload = () => {
        postArcadeLog(`Loaded runtime ${runtime}`);
        resolve();
      };
      script.onerror = () => reject(new Error(`Could not load ${runtime}`));
      document.body.appendChild(script);
      scriptElement = script;
    });
  }

  async function startRun(run) {
    const normalizedRun = normalizeRun(run);
    const runtime = normalizedRun.runtime;
    const driver = normalizedRun.driver;

    if (!driver) {
      drawStatus('MAME driver needed', 'Enter a driver name before loading the ROM');
      return;
    }

    currentRun = normalizedRun;

    ensureAudio()?.resume?.().catch(() => {});
    drawStatus('Checking MAME runtime', `${runtime} / ${driver}`);
    await preflightRuntime(runtime);

    clearPreviousRuntime();
    configureModule(currentRun);
    drawStatus('Starting MAME', `${driver} (${runtime})`);
    postArcadeLog(`Starting driver ${driver} with ${currentRun.files.length} file(s)`);
    postArcadeLog(`MAME args: ${buildArguments(currentRun).join(' ')}`);
    await loadScript(runtime);
    fitArcadeCanvas();
    hideStatus();
    statusText = '';
  }

  function keyForMask(player, bit) {
    const playerOne = {
      1: 'ArrowUp',
      2: 'ArrowDown',
      4: 'ArrowLeft',
      8: 'ArrowRight',
      16: 'Control',
      32: 'Alt',
      64: '1',
      128: ' ',
    };
    const playerTwo = {
      1: 'r',
      2: 'f',
      4: 'd',
      8: 'g',
      16: 'a',
      32: 's',
      64: '2',
      128: 'q',
    };
    return (player === 1 ? playerOne : playerTwo)[bit] || '';
  }

  function dispatchKey(key, action) {
    if (!key) return;

    const eventType = action === 'down' ? 'keydown' : 'keyup';
    const event = new KeyboardEvent(eventType, {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      bubbles: true,
      cancelable: true,
    });

    screen.dispatchEvent(event);
    window.dispatchEvent(event);
  }

  function setMask(player, nextMask) {
    const previousMask = player === 1 ? localMask : remoteMask;
    const mappings = [1, 2, 4, 8, 16, 32, 64, 128];

    mappings.forEach((bit) => {
      const wasPressed = Boolean(previousMask & bit);
      const isPressed = Boolean(nextMask & bit);
      if (wasPressed !== isPressed) {
        dispatchKey(keyForMask(player, bit), isPressed ? 'down' : 'up');
      }
    });

    if (player === 1) {
      localMask = nextMask;
    } else {
      remoteMask = nextMask;
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

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;

    const message = event.data || {};
    if (message.type === 'arcade_start') {
      window.getArcadeAudioStream();
      return;
    }

    if (message.type === 'arcade_autoload') {
      postArcadeLog(`Received ROM ${message.fileName || 'game.zip'} for driver ${message.driver || '(auto)'}`);
      persistRunAndReload({
        runtime: message.runtime,
        driver: message.driver,
        args: message.args,
        files: [
          {
            name: message.fileName || 'game.zip',
            bytes: new Uint8Array(message.bytes || []),
          },
        ],
      }).catch((error) => {
        console.error('Old Style Gaming MAME storage error:', error);
        postArcadeLog(error?.stack || error?.message || error, 'error');
        drawStatus('MAME error', error.message || 'Check browser console');
      });
      return;
    }

    if (message.type === 'arcade_reset') {
      Promise.resolve(currentRun || loadStoredRun()).then((run) => {
        if (!run) {
          drawStatus('MAME ready', 'Load a MAME ROM zip from the room');
          return null;
        }
        return persistRunAndReload(run);
      }).catch((error) => {
        console.error('Old Style Gaming MAME reset error:', error);
        postArcadeLog(error?.stack || error?.message || error, 'error');
        drawStatus('MAME error', error.message || 'Check browser console');
      });
      return;
    }

    if (message.type === 'amstrad_audio_unlock') {
      window.getArcadeAudioStream();
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

  window.addEventListener('error', (event) => {
    const message = event.message || 'Check browser console';
    console.error('Old Style Gaming MAME window error:', event.error || message);
    postArcadeLog(event.error?.stack || message, 'error');
    drawStatus('MAME error', message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('Old Style Gaming MAME promise error:', event.reason);
    postArcadeLog(event.reason?.stack || event.reason?.message || event.reason, 'error');
    drawStatus('MAME error', event.reason?.message || 'Check browser console');
  });

  screen.addEventListener('pointerdown', () => {
    window.getArcadeAudioStream();
    window.focus();
  });

  async function bootStoredRun() {
    if (sessionStorage.getItem(PENDING_RUN_FLAG) !== '1') {
      drawStatus('MAME ready', 'Load a MAME ROM zip from the room');
      postArcadeLog('Arcade launcher ready');
      return;
    }

    try {
      const storedRun = await loadStoredRun();
      if (!storedRun) {
        sessionStorage.removeItem(PENDING_RUN_FLAG);
        drawStatus('MAME ready', 'Load a MAME ROM zip from the room');
        postArcadeLog('Arcade launcher ready; no stored ROM found');
        return;
      }

      sessionStorage.removeItem(PENDING_RUN_FLAG);
      postArcadeLog('Booting stored MAME run after clean reload');
      await startRun(storedRun);
    } catch (error) {
      console.error('Old Style Gaming MAME boot error:', error);
      postArcadeLog(error?.stack || error?.message || error, 'error');
      drawStatus('MAME error', error.message || 'Check browser console');
    }
  }

  bootStoredRun();
})();
