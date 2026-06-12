(function () {
  let screen = document.getElementById('c64-screen');
  let context = screen.getContext('2d', { alpha: false });
  const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;

  function prepareCanvas(canvas) {
    // VICE 2.4's SDL layer calls these before Emscripten installs its wrappers.
    canvas.requestPointerLock ||= () => {};
    canvas.exitPointerLock ||= () => document.exitPointerLock?.();
  }

  prepareCanvas(screen);

  let runtimeReady = false;
  let runtimePromise = null;
  let runtimeResolve = null;
  let currentGamePath = null;
  let sharedAudioContext = null;
  let audioDestination = null;
  let keepAlive = null;
  const joystickMasks = [0, 0, 0];
  const viceLogs = [];

  window.__viceLogs = viceLogs;

  function logVice(message, warn = false) {
    const text = String(message);
    viceLogs.push(text);
    if (viceLogs.length > 100) viceLogs.shift();
    (warn ? console.warn : console.log)(`VICE: ${text}`);
  }

  window.addEventListener('error', (event) => {
    logVice(event.error?.stack || event.message, true);
  });
  window.addEventListener('unhandledrejection', (event) => {
    logVice(event.reason?.stack || event.reason, true);
  });

  if (window.self === window.top) {
    document.body.innerHTML = '';
    return;
  }

  function drawStatus(main, sub = '') {
    if (runtimeReady) return;
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
    if (originalConnect) {
      window.AudioNode.prototype.connect = function patchedConnect(destination, ...args) {
        const result = originalConnect.call(this, destination, ...args);
        if (audioDestination && destination === sharedAudioContext?.destination && this !== audioDestination) {
          try {
            originalConnect.call(this, audioDestination);
          } catch {
            // The normal browser audio output remains connected.
          }
        }
        return result;
      };
    }
  }

  window.getC64AudioStream = function getC64AudioStream() {
    const audioContext = ensureAudio();
    audioContext?.resume?.().catch(() => {});
    return audioDestination?.stream || null;
  };

  function startVice() {
    if (runtimePromise) return runtimePromise;

    drawStatus('Starting Commodore 64', 'Loading standalone VICE');
    runtimePromise = new Promise((resolve) => {
      runtimeResolve = resolve;
    });

    // Drawing the loading message creates a 2D context. VICE needs a fresh
    // canvas so SDL can create its WebGL context.
    const viceScreen = screen.cloneNode();
    screen.replaceWith(viceScreen);
    screen = viceScreen;
    context = null;
    prepareCanvas(screen);

    window.Module = {
      arguments: [
        '-directory',
        '/bin/C64:/bin/DRIVES',
        '+VICIIhwscale',
        '-soundsync',
        '0',
        '-soundrate',
        '22050',
        '-soundfragsize',
        '2',
      ],
      canvas: screen,
      locateFile(path) {
        return `/c64/${path}`;
      },
      onRuntimeInitialized() {
        window.setTimeout(() => {
          runtimeReady = true;
          runtimeResolve?.();
          console.log('Old Style Gaming C64: standalone VICE WASM ready');
        }, 500);
      },
      print(message) {
        logVice(message);
      },
      printErr(message) {
        logVice(message, true);
      },
    };

    const runtimeScript = document.createElement('script');
    runtimeScript.src = `/c64/vice.js?v=2026-06-12-1`;
    runtimeScript.async = true;
    runtimeScript.onerror = () => drawStatus('Commodore 64 failed to load', 'Standalone VICE runtime is missing');
    document.body.appendChild(runtimeScript);
    return runtimePromise;
  }

  function safeFileName(fileName) {
    return String(fileName || 'game.d64').replace(/[^a-zA-Z0-9._ -]/g, '_');
  }

  async function autoload(fileName, bytes) {
    await startVice();
    const fs = window.Module.FS;
    const name = safeFileName(fileName);
    const nextPath = `/games/${name}`;

    try {
      fs.mkdir('/games');
    } catch {
      // Directory already exists.
    }

    if (currentGamePath) {
      try {
        fs.unlink(currentGamePath);
      } catch {
        // The previous file may already have been removed.
      }
    }

    fs.writeFile(nextPath, new Uint8Array(bytes || []));
    currentGamePath = nextPath;
    const result = window.Module.ccall(
      'autostart_autodetect',
      'number',
      ['string', 'number', 'number', 'number'],
      [nextPath, 0, 0, 0],
    );
    if (result < 0) {
      throw new Error(`VICE could not autostart ${name}`);
    }
  }

  function resetVice() {
    if (!runtimeReady) return;
    window.Module.ccall('machine_trigger_reset', null, ['number'], [1]);
  }

  function setMask(player, nextMask) {
    if (!runtimeReady) return;

    const playerIndex = player === 2 ? 2 : 1;
    const joyport = playerIndex === 1 ? 2 : 1;
    const mask = Number(nextMask) & 0x1f;
    const previous = joystickMasks[playerIndex];
    const released = previous & ~mask;
    const pressed = mask & ~previous;

    if (released) {
      window.Module.ccall('joystick_set_value_and', null, ['number', 'number'], [joyport, 0xff ^ released]);
    }
    if (pressed) {
      window.Module.ccall('joystick_set_value_or', null, ['number', 'number'], [joyport, pressed]);
    }
    joystickMasks[playerIndex] = mask;
  }

  function keyCode(key) {
    const named = {
      ArrowUp: 273,
      ArrowDown: 274,
      ArrowRight: 275,
      ArrowLeft: 276,
      Enter: 13,
      Escape: 27,
      Backspace: 8,
      Tab: 9,
      ' ': 32,
    };
    return named[key] || (String(key || '').length === 1 ? String(key).toLowerCase().charCodeAt(0) : 0);
  }

  function sendKey(key, action) {
    if (!runtimeReady) return;
    const code = keyCode(key);
    if (!code) return;
    window.Module.ccall(
      action === 'down' ? 'keyboard_key_pressed' : 'keyboard_key_released',
      null,
      ['number'],
      [code],
    );
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const message = event.data || {};

    if (message.type === 'c64_start' || message.type === 'amstrad_audio_unlock') {
      window.getC64AudioStream();
      startVice();
      return;
    }
    if (message.type === 'c64_autoload') {
      window.getC64AudioStream();
      autoload(message.fileName, message.bytes).catch((error) => {
        console.error(error);
        drawStatus('Could not load C64 game', error.message);
      });
      return;
    }
    if (message.type === 'c64_reset') {
      resetVice();
      return;
    }
    if (message.type === 'amstrad_remote_joystick') {
      setMask(message.player, message.mask);
      return;
    }
    if (message.type === 'amstrad_remote_input' || message.type === 'amstrad_remote_control') {
      sendKey(message.key, message.action);
    }
  });

  screen.addEventListener('pointerdown', () => {
    window.getC64AudioStream();
    window.focus();
  });

  window.addEventListener('error', (event) => {
    console.error('Old Style Gaming C64 error:', event.error || event.message);
    drawStatus('Commodore 64 error', event.message || 'Check browser console');
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('Old Style Gaming C64 promise error:', event.reason);
    drawStatus('Commodore 64 error', event.reason?.message || 'Check browser console');
  });

  drawStatus('Commodore 64 ready', 'Load a C64 game from the room');
})();
