(function () {
  const screen = document.getElementById('arcade-screen');
  const gameContainer = document.getElementById('mame-container');
  const context = screen.getContext('2d', { alpha: false });

  let currentRom = null;
  let loaderScript = null;
  let sharedAudioContext = null;
  let audioDestination = null;
  let audioCaptureGain = null;
  let keepAlive = null;
  let emulatorVolume = 1;
  let emulatorPaused = false;
  let romStartedAt = 0;
  let currentSampleFiles = [];
  let currentSaveNamespace = '';
  let currentHiTemplate = null;
  let scoreFileWatchTimer = null;
  let lastScoreFileSignature = '';
  const playerMasks = [0, 0, 0, 0];
  let lastSimulatedMasks = [0, 0, 0, 0];
  let statusText = 'MAME 2003-Plus ready';
  const robotronDualStickRoms = new Set(['robotron', 'robotron12', 'robotronyo', 'robotryo']);
  const localSavePrefix = 'oldstylegaming:mame:saves:';

  const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
  const nativeFetch = window.fetch.bind(window);
  const coreCacheVersion = '2026-06-22-1';

  function postArcadeLog(message, level = 'info') {
    window.parent?.postMessage({
      type: 'arcade_log',
      level,
      message: String(message || ''),
    }, window.location.origin);
  }

  window.fetch = (input, options) => {
    const inputUrl = typeof input === 'string' || input instanceof URL ? input : input?.url;
    if (inputUrl) {
      const url = new URL(inputUrl, window.location.href);
      if (/\/cores\/mame2003_plus(?:-legacy)?-wasm\.data$/.test(url.pathname)) {
        url.searchParams.set('osg', coreCacheVersion);
        input = input instanceof Request ? new Request(url, input) : url;
      }
    }
    return nativeFetch(input, options);
  };

  function drawStatus(main, sub = '') {
    statusText = main;
    screen.style.display = 'block';
    postArcadeLog(sub ? `${main}: ${sub}` : main, main.toLowerCase().includes('error') || main.toLowerCase().includes('failed') ? 'error' : 'info');
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
      try {
        sharedAudioContext = new OriginalAudioContext({ latencyHint: 'playback' });
      } catch {
        sharedAudioContext = new OriginalAudioContext();
      }
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
        const contextArgs = args.length ? args : [{ latencyHint: 'playback' }];
        try {
          sharedAudioContext = new OriginalAudioContext(...contextArgs);
        } catch {
          sharedAudioContext = new OriginalAudioContext(...args);
        }
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
            originalConnect.call(this, audioCaptureGain || audioDestination);
          } catch {
            // Some nodes only allow one output. The main audio path should keep working.
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

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  async function syncArcadeFs(manager) {
    try {
      if (typeof manager?.FS?.syncfs === 'function') {
        await new Promise((resolve) => manager.FS.syncfs(false, resolve));
      }
    } catch {
      // Some builds do not complete async filesystem sync; the short wait below still helps.
    }
  }

  async function flushArcadeSaveFiles({ restartCore = false } = {}) {
    const manager = window.EJS_emulator?.gameManager;
    if (!manager?.FS) return;

    try {
      manager.saveSaveFiles?.();
    } catch (error) {
      postArcadeLog(`Could not flush MAME save files: ${error.message}`, 'error');
    }

    await syncArcadeFs(manager);

    if (restartCore) {
      try {
        manager.restart?.();
        postArcadeLog('MAME core restart requested to flush built-in high scores');
        await wait(650);
        manager.saveSaveFiles?.();
        await syncArcadeFs(manager);
      } catch (error) {
        postArcadeLog(`Could not restart MAME core for high-score flush: ${error.message}`, 'error');
      }
    }

    await wait(250);
  }

  function normaliseFsPath(path) {
    return String(path || '').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  }

  function localSaveKey(fileName = currentRom?.fileName) {
    const namespace = currentSaveNamespace ? `${currentSaveNamespace}:` : '';
    return `${localSavePrefix}${namespace}${normaliseRomKey(fileName)}`;
  }

  function currentMameSaveDirectory() {
    return currentSaveNamespace
      ? `/data/tournament-saves/${currentSaveNamespace}`
      : '/data/saves';
  }

  function isActiveMameSavePath(path) {
    if (!currentSaveNamespace) return true;
    const normalised = toAbsoluteFsPath(path).toLowerCase();
    const saveDirectory = currentMameSaveDirectory().toLowerCase();
    return normalised === saveDirectory || normalised.startsWith(`${saveDirectory}/`);
  }

  function isPersistentMameSavePath(path) {
    const normalised = normaliseFsPath(path).replace(/^\/+/, '');
    const lowerPath = normalised.toLowerCase();
    const segments = pathSegments(normalised);

    return !isHiscoreDat(normalised)
      && !lowerPath.endsWith('retroarch.cfg')
      && !lowerPath.endsWith('.zip')
      && !lowerPath.endsWith('.7z')
      && (
        lowerPath.endsWith('.hi')
        || lowerPath.endsWith('.nv')
        || segments.includes('nvram')
        || segments.includes('hi')
      );
  }

  function isCurrentRomGeneratedSaveFile(file) {
    const romKey = normaliseRomKey(currentRom?.fileName);
    if (!romKey || !file?.path) return false;

    const lowerPath = normaliseFsPath(file.path).toLowerCase();
    return lowerPath.endsWith(`/${romKey}.hi`)
      || lowerPath.endsWith(`/${romKey}.nv`)
      || lowerPath.endsWith(`/${romKey}/`)
      || lowerPath.includes(`/nvram/${romKey}/`);
  }

  function hasCurrentRomGeneratedSave(files) {
    return (files || []).some((file) => isCurrentRomGeneratedSaveFile(file));
  }

  function toAbsoluteFsPath(path) {
    const normalised = normaliseFsPath(path);
    return normalised.startsWith('/') ? normalised : `/${normalised}`;
  }

  function loadLocalMameSaveFiles(fileName = currentRom?.fileName) {
    const key = localSaveKey(fileName);
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (!saved || !Array.isArray(saved.files)) return [];
      return saved.files
        .filter((file) => file?.path && file?.data && isPersistentMameSavePath(file.path) && isActiveMameSavePath(file.path))
        .map((file) => ({
          path: toAbsoluteFsPath(file.path),
          bytes: base64ToBytes(file.data),
        }));
    } catch (error) {
      postArcadeLog(`Could not load local MAME saves: ${error.message}`, 'error');
      return [];
    }
  }

  function persistLocalMameSaveFiles(files, fileName = currentRom?.fileName) {
    const persistentFiles = (files || [])
      .filter((file) => file?.path && file?.bytes?.length && isPersistentMameSavePath(file.path) && isActiveMameSavePath(file.path) && isCurrentRomGeneratedSaveFile(file))
      .map((file) => ({
        path: normaliseFsPath(file.path).replace(/^\/+/, ''),
        data: bytesToBase64(file.bytes),
        size: file.bytes.length,
      }));

    if (!persistentFiles.length) return;

    try {
      localStorage.setItem(localSaveKey(fileName), JSON.stringify({
        rom: normaliseRomKey(fileName),
        savedAt: Date.now(),
        files: persistentFiles,
      }));
      postArcadeLog(`Stored ${persistentFiles.length} local MAME save file(s) for ${fileName}`);
    } catch (error) {
      postArcadeLog(`Could not store local MAME saves: ${error.message}`, 'error');
    }
  }

  function safeStat(fs, path) {
    try {
      return fs.stat(path);
    } catch {
      return null;
    }
  }

  function statMtimeMs(stat) {
    const value = stat?.mtime;
    if (!value) return null;
    if (value instanceof Date) return value.getTime();
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }

  function pathSegments(path) {
    return normaliseFsPath(path).split('/').filter(Boolean).map((part) => part.toLowerCase());
  }

  function isHiscoreDat(path) {
    return normaliseFsPath(path).toLowerCase().endsWith('/hiscore.dat')
      || normaliseFsPath(path).toLowerCase() === 'hiscore.dat';
  }

  function isMameScoreCandidate(path, stat) {
    const normalised = normaliseFsPath(path);
    const lowerPath = normalised.toLowerCase();
    const segments = pathSegments(normalised);
    const mtimeMs = statMtimeMs(stat);
    const changedSinceRomStart = Boolean(romStartedAt && mtimeMs && mtimeMs >= romStartedAt - 1000);

    return lowerPath.endsWith('.hi')
      || lowerPath.endsWith('.cfg')
      || lowerPath.endsWith('.fs')
      || segments.includes('hi')
      || segments.includes('nvram');
  }

  function collectSaveFiles(root = '/data/saves', prefix = '') {
    const manager = window.EJS_emulator?.gameManager;
    const fs = manager?.FS;
    const files = [];

    if (!fs) return files;

    function walk(path) {
      let entries = [];
      try {
        entries = fs.readdir(path);
      } catch {
        return;
      }

      entries.forEach((entry) => {
        if (entry === '.' || entry === '..') return;
        const childPath = `${path}/${entry}`;
        let stat = null;
        try {
          stat = fs.stat(childPath);
        } catch {
          return;
        }

        if (fs.isDir(stat.mode)) {
          walk(childPath);
          return;
        }

        if (!fs.isFile(stat.mode)) return;
        try {
          const bytes = fs.readFile(childPath);
          const relativePath = `${prefix}${childPath.slice(root.length).replace(/^\/+/, '')}`;
          files.push({
            path: relativePath,
            bytes,
          });
        } catch (error) {
          postArcadeLog(`Could not read MAME save file ${childPath}: ${error.message}`, 'error');
        }
      });
    }

    walk(root);
    return files;
  }

  function buildFsDebugDump({ quiet = false } = {}) {
    const manager = window.EJS_emulator?.gameManager;
    const fs = manager?.FS;
    const debug = {
      core: window.EJS_core || 'unknown',
      romName: currentRom?.fileName || '',
      romStartedAt,
      searchedRoots: [],
      topLevel: [],
      files: [],
      folders: [],
      hiFiles: [],
      hiDirs: [],
      nvramDirs: [],
      changedFiles: [],
      uploadFiles: [],
      onlyHiscoreDat: false,
      warning: '',
    };

    if (!fs) {
      debug.warning = 'Emulator filesystem is not available yet.';
      return { debug, files: [] };
    }

    const skipRoots = new Set(['/dev', '/proc', '/sys']);
    const seenPaths = new Set();
    const uploadPathSet = new Set();
    const uploadFiles = [];

    function addTopLevel() {
      try {
        debug.topLevel = fs.readdir('/')
          .filter((entry) => entry !== '.' && entry !== '..')
          .map((entry) => {
            const fullPath = `/${entry}`;
            const stat = safeStat(fs, fullPath);
            return {
              path: fullPath,
              type: stat && fs.isDir(stat.mode) ? 'dir' : stat && fs.isFile(stat.mode) ? 'file' : 'other',
              size: Number(stat?.size) || 0,
            };
          });
      } catch (error) {
        debug.warning = `Could not read top-level filesystem: ${error.message}`;
      }
    }

    function addUploadFile(path, stat, reason) {
      const normalised = normaliseFsPath(path);
      if (uploadPathSet.has(normalised)) return;
      uploadPathSet.add(normalised);
      try {
        const bytes = new Uint8Array(fs.readFile(normalised));
        uploadFiles.push({
          path: normalised.replace(/^\/+/, ''),
          bytes,
          size: bytes.length,
          reason,
        });
      } catch (error) {
        postArcadeLog(`Could not read MAME candidate ${normalised}: ${error.message}`, 'error');
      }
    }

    function walk(root) {
      const normalRoot = normaliseFsPath(root);
      if (skipRoots.has(normalRoot) || seenPaths.has(normalRoot)) return;
      seenPaths.add(normalRoot);
      debug.searchedRoots.push(normalRoot);

      let entries = [];
      try {
        entries = fs.readdir(normalRoot);
      } catch {
        return;
      }

      entries.forEach((entry) => {
        if (entry === '.' || entry === '..') return;
        const childPath = normalRoot === '/' ? `/${entry}` : `${normalRoot}/${entry}`;
        const stat = safeStat(fs, childPath);
        if (!stat) return;

        const lowerPath = childPath.toLowerCase();
        const segments = pathSegments(childPath);
        const mtimeMs = statMtimeMs(stat);
        const changedSinceRomStart = Boolean(romStartedAt && mtimeMs && mtimeMs >= romStartedAt - 1000);

        if (fs.isDir(stat.mode)) {
          const folderInfo = { path: childPath, size: 0, mtimeMs };
          debug.folders.push(folderInfo);
          if (segments.includes('hi')) debug.hiDirs.push(folderInfo);
          if (segments.includes('nvram')) debug.nvramDirs.push(folderInfo);
          walk(childPath);
          return;
        }

        if (!fs.isFile(stat.mode)) return;

        const fileInfo = {
          path: childPath,
          size: Number(stat.size) || 0,
          mtimeMs,
          changedSinceRomStart,
        };
        debug.files.push(fileInfo);
        if (lowerPath.endsWith('.hi')) debug.hiFiles.push(fileInfo);
        if (changedSinceRomStart) debug.changedFiles.push(fileInfo);

        if (isMameScoreCandidate(childPath, stat) && isActiveMameSavePath(childPath)) {
          addUploadFile(childPath, stat, lowerPath.endsWith('.hi') ? '.hi' : segments.includes('nvram') ? 'nvram' : segments.includes('hi') ? 'hi-folder' : lowerPath.endsWith('.cfg') ? '.cfg' : lowerPath.endsWith('.fs') ? '.fs' : 'candidate');
        } else if (isHiscoreDat(childPath)) {
          addUploadFile(childPath, stat, 'hiscore.dat-debug');
        }
      });
    }

    addTopLevel();
    walk('/');

    debug.files.sort((left, right) => left.path.localeCompare(right.path));
    debug.folders.sort((left, right) => left.path.localeCompare(right.path));
    debug.uploadFiles = uploadFiles.map((file) => ({
      path: file.path,
      size: file.size,
      reason: file.reason,
    }));
    debug.onlyHiscoreDat = uploadFiles.length > 0 && uploadFiles.every((file) => isHiscoreDat(file.path));
    if (debug.onlyHiscoreDat) {
      debug.warning = 'Only hiscore.dat was found. That is the support definition file, not a generated score file.';
      if (!quiet) postArcadeLog(debug.warning, 'error');
    }

    return { debug, files: uploadFiles };
  }

  function getScoreFileSignature() {
    const { files } = buildFsDebugDump({ quiet: true });
    const romKey = normaliseRomKey(currentRom?.fileName);
    return files
      .filter((file) => {
        const path = normaliseFsPath(file.path).toLowerCase();
        return path.endsWith(`/${romKey}.hi`)
          || path.endsWith(`/${romKey}.nv`)
          || path.includes(`/nvram/${romKey}/`);
      })
      .map((file) => {
        let hash = 2166136261;
        for (const byte of file.bytes) {
          hash ^= byte;
          hash = Math.imul(hash, 16777619);
        }
        return `${file.path}:${file.bytes.length}:${hash >>> 0}`;
      })
      .sort()
      .join('|');
  }

  function stopScoreFileWatch() {
    if (scoreFileWatchTimer) {
      window.clearInterval(scoreFileWatchTimer);
      scoreFileWatchTimer = null;
    }
    lastScoreFileSignature = '';
  }

  function startScoreFileWatch() {
    stopScoreFileWatch();
    window.setTimeout(() => {
      if (!currentRom || !window.EJS_emulator?.gameManager?.FS) return;
      lastScoreFileSignature = getScoreFileSignature();
      scoreFileWatchTimer = window.setInterval(() => {
        const signature = getScoreFileSignature();
        if (!signature || signature === lastScoreFileSignature) return;
        lastScoreFileSignature = signature;
        window.parent?.postMessage({
          type: 'arcade_score_files_changed',
          romName: currentRom.fileName,
        }, window.location.origin);
      }, 2500);
    }, 3000);
  }

  window.getArcadeSaveBundle = async function getArcadeSaveBundle(options = {}) {
    const allowRestart = options.restartCore !== false;
    const forceRestart = options.forceRestart === true;
    await flushArcadeSaveFiles({ restartCore: false });
    let { debug, files } = buildFsDebugDump();

    if (allowRestart && (forceRestart || !hasCurrentRomGeneratedSave(files))) {
      await flushArcadeSaveFiles({ restartCore: true });
      ({ debug, files } = buildFsDebugDump());
    }

    persistLocalMameSaveFiles(files);
    postArcadeLog(`MAME FS scan: ${debug.files.length} files, ${debug.hiFiles.length} .hi, ${debug.nvramDirs.length} nvram dirs, ${debug.uploadFiles.length} upload candidates`);
    window.parent?.postMessage({
      type: 'arcade_fs_debug',
      debug,
    }, window.location.origin);
    return {
      romName: currentRom?.fileName || '',
      files,
      debug,
    };
  };

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
    playerMasks.forEach((_mask, index) => {
      setMask(index + 1, 0);
    });
    if (emulatorPaused) {
      window.EJS_emulator?.pause?.(true);
    } else {
      window.EJS_emulator?.play?.(true);
    }
    setEmulatorVolume(emulatorVolume);
  }

  function normaliseRomKey(fileName) {
    return String(fileName || '')
      .toLowerCase()
      .replace(/\.(zip|7z)$/i, '')
      .replace(/[^a-z0-9_+-]/g, '');
  }

  function isRobotronRom() {
    const key = normaliseRomKey(currentRom?.fileName);
    return robotronDualStickRoms.has(key) || key.startsWith('robotron');
  }

  function maskToButtons(mask) {
    const buttons = new Array(16).fill(false);
    buttons[12] = Boolean(mask & 1);
    buttons[13] = Boolean(mask & 2);
    buttons[14] = Boolean(mask & 4);
    buttons[15] = Boolean(mask & 8);
    buttons[0] = Boolean(mask & 16);
    buttons[1] = Boolean(mask & 32);
    buttons[2] = Boolean(mask & 128);
    buttons[3] = Boolean(mask & 256);
    buttons[4] = Boolean(mask & 512);
    buttons[5] = Boolean(mask & 1024);
    buttons[6] = Boolean(mask & 2048);
    buttons[8] = Boolean(mask & 4096); // Coin / Select
    buttons[9] = Boolean(mask & 64); // Start
    return buttons;
  }

  function buildPad(index, mask) {
    const pressedButtons = maskToButtons(mask);
    const rightStickX = (mask & 32768) ? -1 : (mask & 65536) ? 1 : 0;
    const rightStickY = (mask & 8192) ? -1 : (mask & 16384) ? 1 : 0;
    return {
      id: `Old Style Arcade Pad ${index + 1}`,
      index,
      connected: true,
      mapping: 'standard',
      timestamp: performance.now(),
      axes: isRobotronRom() ? [0, 0, rightStickX, rightStickY] : [0, 0, 0, 0],
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
      playerMasks.forEach((mask, index) => {
        nativePads[index] = buildPad(index, mask);
      });
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
      [128, 9],
      [256, 1],
      [512, 10],
      [1024, 11],
      [2048, 12],
      [4096, 2],
      [64, 3],
    ];

    mappings.forEach(([bit, button]) => {
      const wasPressed = Boolean(previous & bit);
      const isPressed = Boolean(nextMask & bit);
      if (wasPressed !== isPressed) {
        manager.simulateInput(playerIndex, button, isPressed ? 1 : 0);
      }
    });

    if (isRobotronRom()) {
      const analog = 0x7fff;
      const fireUp = Boolean(nextMask & 8192);
      const fireDown = Boolean(nextMask & 16384);
      const fireLeft = Boolean(nextMask & 32768);
      const fireRight = Boolean(nextMask & 65536);
      manager.simulateInput(playerIndex, 20, fireRight ? analog : 0);
      manager.simulateInput(playerIndex, 21, fireLeft ? analog : 0);
      manager.simulateInput(playerIndex, 22, fireDown ? analog : 0);
      manager.simulateInput(playerIndex, 23, fireUp ? analog : 0);
    }

    lastSimulatedMasks[playerIndex] = nextMask;
  }

  function setMask(player, mask) {
    const playerIndex = Math.min(3, Math.max(0, (Number(player) || 1) - 1));
    playerMasks[playerIndex] = mask;
    simulateMask(playerIndex, mask);
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
      case 'c':
      case 'C':
      case 'h':
      case 'H':
        return 128;
      case 'v':
      case 'V':
      case 'r':
      case 'R':
        return 256;
      case 'b':
      case 'B':
      case 't':
      case 'T':
        return 512;
      case 'n':
      case 'N':
      case 'y':
      case 'Y':
        return 1024;
      case 'm':
      case 'M':
      case 'u':
      case 'U':
        return 2048;
      case 'Enter':
      case '1':
      case '2':
        return 64;
      case 'Shift':
      case '5':
      case '6':
        return 4096;
      default:
        return 0;
    }
  }

  function handleKeyInput(player, key, action) {
    const bit = keyToMaskBit(key);
    if (!bit) return;

    const playerIndex = Math.min(3, Math.max(0, (Number(player) || 1) - 1));
    const current = playerMasks[playerIndex] || 0;
    const next = action === 'down' ? current | bit : current & ~bit;
    setMask(player, next);
  }

  function clearGameContainer() {
    stopScoreFileWatch();
    try {
      window.EJS_emulator?.gameManager?.clearEJSResetTimer?.();
      window.EJS_emulator?.gamepad?.terminate?.();
    } catch {}

    gameContainer.innerHTML = '';
    window.EJS_emulator = null;
    playerMasks.fill(0);
    lastSimulatedMasks = [0, 0, 0, 0];
    if (loaderScript) {
      loaderScript.remove();
      loaderScript = null;
    }
  }

  function configureEmulator(fileName, romFile) {
    const saveDirectory = currentMameSaveDirectory();
    window.EJS_DEBUG_XX = true;
    window.EJS_player = '#mame-container';
    window.EJS_core = 'mame2003_plus';
    window.EJS_gameName = fileName;
    window.EJS_gameUrl = romFile;
    window.EJS_pathtodata = '/emulatorjs/data/';
    window.EJS_paths = {
      'emulator.js': '/emulatorjs/data/src/emulator.js',
      'emulator.css': '/emulatorjs/data/emulator.css',
      'cache.js': '/emulatorjs/data/src/cache.js',
      'compression.js': '/emulatorjs/data/src/compression.js',
      'consts.js': '/emulatorjs/data/src/consts.js',
      'GameManager.js': '/emulatorjs/data/src/GameManager.js?v=2026-08-03-3',
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
    window.EJS_saveDirectory = saveDirectory;
    window.EJS_defaultOptions = {
      'mame2003-plus_autosave_hiscore': 'recursively',
    };
    window.EJS_rawFiles = {};
    currentSampleFiles.forEach((sample) => {
      if (!sample?.fileName || !sample?.bytes?.length) return;
      const safeName = String(sample.fileName).split(/[\\/]/).pop();
      if (!/\.zip$/i.test(safeName)) return;
      window.EJS_rawFiles[`/home/web_user/retroarch/system/mame2003-plus/samples/${safeName}`] = sample.bytes;
    });
    if (currentHiTemplate?.length) {
      const romKey = normaliseRomKey(fileName);
      window.EJS_rawFiles[`${saveDirectory}/${romKey}.hi`] = currentHiTemplate.slice();
      postArcadeLog(`Loaded verified tournament .hi: ${saveDirectory}/${romKey}.hi (${currentHiTemplate.length} bytes)`);
    } else {
      loadLocalMameSaveFiles(fileName).forEach((file) => {
        window.EJS_rawFiles[file.path] = file.bytes;
      });
    }
    window.EJS_retroarchOpts = [
      {
        name: 'audio_latency',
        default: '128',
        isString: false,
      },
      {
        name: 'system_directory',
        default: '/home/web_user/retroarch/system',
        isString: true,
      },
      {
        name: 'savefile_directory',
        default: saveDirectory,
        isString: true,
      },
      {
        name: 'savestate_directory',
        default: saveDirectory,
        isString: true,
      },
    ];
    window.EJS_volume = 1;
    window.EJS_backgroundColor = '#000';
    window.EJS_color = '#2f8f76';
    window.EJS_alignStartButton = 'center';
    window.EJS_defaultControls = {
      0: {
        0: { value: 'x', value2: 'BUTTON_1' },
        1: { value: 'v', value2: 'BUTTON_4' },
        2: { value: '5', value2: 'SELECT' },
        3: { value: 'enter', value2: 'START' },
        4: { value: 'up arrow', value2: 'DPAD_UP' },
        5: { value: 'down arrow', value2: 'DPAD_DOWN' },
        6: { value: 'left arrow', value2: 'DPAD_LEFT' },
        7: { value: 'right arrow', value2: 'DPAD_RIGHT' },
        8: { value: 'z', value2: 'BUTTON_2' },
        9: { value: 'c', value2: 'BUTTON_3' },
        10: { value: 'b', value2: 'LEFT_TOP_SHOULDER' },
        11: { value: 'n', value2: 'RIGHT_TOP_SHOULDER' },
        12: { value: 'm', value2: 'LEFT_BOTTOM_SHOULDER' },
      },
      1: {
        0: { value: 'f', value2: 'BUTTON_1' },
        1: { value: 'r', value2: 'BUTTON_4' },
        2: { value: '6', value2: 'SELECT' },
        3: { value: '2', value2: 'START' },
        4: { value: 'q', value2: 'DPAD_UP' },
        5: { value: 'a', value2: 'DPAD_DOWN' },
        6: { value: 'o', value2: 'DPAD_LEFT' },
        7: { value: 'p', value2: 'DPAD_RIGHT' },
        8: { value: 'g', value2: 'BUTTON_2' },
        9: { value: 'h', value2: 'BUTTON_3' },
        10: { value: 't', value2: 'LEFT_TOP_SHOULDER' },
        11: { value: 'y', value2: 'RIGHT_TOP_SHOULDER' },
        12: { value: 'u', value2: 'LEFT_BOTTOM_SHOULDER' },
      },
      2: {
        0: { value: 'i', value2: 'BUTTON_1' },
        1: { value: 'k', value2: 'BUTTON_4' },
        2: { value: '7', value2: 'SELECT' },
        3: { value: '3', value2: 'START' },
        4: { value: 'i', value2: 'DPAD_UP' },
        5: { value: 'k', value2: 'DPAD_DOWN' },
        6: { value: 'j', value2: 'DPAD_LEFT' },
        7: { value: 'l', value2: 'DPAD_RIGHT' },
        8: { value: ',', value2: 'BUTTON_2' },
        9: { value: '.', value2: 'BUTTON_3' },
        10: { value: '/', value2: 'LEFT_TOP_SHOULDER' },
        11: { value: ';', value2: 'RIGHT_TOP_SHOULDER' },
        12: { value: "'", value2: 'LEFT_BOTTOM_SHOULDER' },
      },
      3: {
        0: { value: 'num1', value2: 'BUTTON_1' },
        1: { value: 'num4', value2: 'BUTTON_4' },
        2: { value: '8', value2: 'SELECT' },
        3: { value: '4', value2: 'START' },
        4: { value: 'num8', value2: 'DPAD_UP' },
        5: { value: 'num5', value2: 'DPAD_DOWN' },
        6: { value: 'num4', value2: 'DPAD_LEFT' },
        7: { value: 'num6', value2: 'DPAD_RIGHT' },
        8: { value: 'num2', value2: 'BUTTON_2' },
        9: { value: 'num3', value2: 'BUTTON_3' },
        10: { value: 'num7', value2: 'LEFT_TOP_SHOULDER' },
        11: { value: 'num9', value2: 'RIGHT_TOP_SHOULDER' },
        12: { value: 'num0', value2: 'LEFT_BOTTOM_SHOULDER' },
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
      console.log('Old Style Gaming Arcade: EmulatorJS ready');
      postArcadeLog('MAME 2003-Plus EmulatorJS ready');
    };
    window.EJS_onGameStart = () => {
      console.log('Old Style Gaming Arcade: game started');
      postArcadeLog(`MAME game started: ${fileName}`);
      statusText = '';
      screen.style.display = 'none';
      startScoreFileWatch();
    };
    window.EJS_onExit = () => {
      drawStatus('MAME stopped', fileName);
    };
  }

  async function loadCurrentRom() {
    if (!currentRom) {
      drawStatus('MAME 2003-Plus ready', 'Load a compatible arcade ROM archive from the room');
      return;
    }

    ensureAudio()?.resume?.().catch(() => {});
    drawStatus('Checking MAME runtime', currentRom.fileName);
    try {
      await preflightEmulatorJs();
    } catch (error) {
      drawStatus('MAME runtime missing', error.message);
      return;
    }

    clearGameContainer();
    romStartedAt = Date.now();
    const gameType = currentRom.fileName.toLowerCase().endsWith('.7z') ? 'application/x-7z-compressed' : 'application/zip';
    const gameFile = new File([currentRom.bytes], currentRom.fileName, { type: gameType });
    configureEmulator(currentRom.fileName, gameFile);
    drawStatus('Loading MAME', currentSampleFiles.length ? `${currentRom.fileName} with samples` : currentRom.fileName);

    loaderScript = document.createElement('script');
    loaderScript.src = `/emulatorjs/data/loader.js?v=${Date.now()}`;
    loaderScript.async = true;
    loaderScript.onerror = () => drawStatus('MAME failed to load', 'Could not load EmulatorJS');
    document.body.appendChild(loaderScript);
  }

  async function preflightEmulatorJs() {
    const required = [
      '/emulatorjs/data/loader.js',
      '/emulatorjs/data/src/emulator.js',
      '/emulatorjs/data/src/compression.js',
      '/emulatorjs/data/compression/extractzip.js',
      '/emulatorjs/data/compression/extract7z.js',
      '/emulatorjs/data/cores/mame2003_plus-wasm.data',
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
    console.error('Old Style Gaming Arcade error:', event.error || event.message, event.filename);
    drawStatus('MAME error', message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('Old Style Gaming Arcade promise error:', event.reason);
    drawStatus('MAME error', event.reason?.message || 'Check browser console');
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;

    const message = event.data || {};
    if (message.type === 'arcade_start') {
      window.getArcadeAudioStream();
      return;
    }

    if (message.type === 'arcade_autoload') {
      currentSaveNamespace = String(message.saveNamespace || '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 64);
      try {
        currentHiTemplate = message.hiTemplate ? base64ToBytes(message.hiTemplate) : null;
      } catch (error) {
        currentHiTemplate = null;
        postArcadeLog(`Tournament .hi template could not be decoded: ${error.message}`, 'error');
      }
      currentRom = {
        fileName: message.fileName || 'game.zip',
        bytes: new Uint8Array(message.bytes || []),
      };
      currentSampleFiles = Array.isArray(message.samples)
        ? message.samples.map((sample) => ({
          fileName: sample?.fileName || '',
          bytes: new Uint8Array(sample?.bytes || []),
        }))
        : [];
      loadCurrentRom();
      return;
    }

    if (message.type === 'arcade_reset') {
      loadCurrentRom();
      return;
    }

    if (message.type === 'amstrad_audio_unlock') {
      window.getArcadeAudioStream();
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
    window.getArcadeAudioStream();
    window.focus();
  });

  drawStatus('MAME 2003-Plus ready', 'Load a compatible arcade ROM archive from the room');
})();
