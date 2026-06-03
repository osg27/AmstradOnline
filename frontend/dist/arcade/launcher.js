(function () {
  const screen = document.getElementById('arcade-screen');
  const container = document.getElementById('mame-container');
  const context = screen.getContext('2d', { alpha: false });

  let currentRom = null;
  let currentMame = null;
  let loaderScript = null;
  let gameUrl = null;
  let statusText = 'MAME ready';
  let localMask = 0;
  let remoteMask = 0;
  let sharedAudioContext = null;
  let audioDestination = null;
  let keepAlive = null;

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

  window.getArcadeAudioStream = function getArcadeAudioStream() {
    const audioContext = ensureAudio();
    audioContext?.resume?.().catch(() => {});
    return audioDestination?.stream || null;
  };

  function driverFromFileName(fileName) {
    return String(fileName || 'game.zip')
      .replace(/\.[^.]+$/, '')
      .trim()
      .toLowerCase();
  }

  function clearMame() {
    container.innerHTML = '';
    currentMame = null;
    if (loaderScript) {
      loaderScript.remove();
      loaderScript = null;
    }
    if (gameUrl) {
      URL.revokeObjectURL(gameUrl);
      gameUrl = null;
    }
  }

  async function preflightMame() {
    const required = [
      '/arcade/mamejs.js',
      '/arcade/mame/mame.js',
    ];

    for (const path of required) {
      const response = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
      const contentType = response.headers.get('content-type') || '';

      if (!response.ok || contentType.includes('text/html')) {
        throw new Error(`${path} missing`);
      }
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${src}?v=${Date.now()}`;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.body.appendChild(script);
      loaderScript = script;
    });
  }

  async function loadCurrentRom() {
    if (!currentRom) {
      drawStatus('MAME ready', 'Load a MAME ROM zip from the room');
      return;
    }

    ensureAudio()?.resume?.().catch(() => {});
    drawStatus('Checking MAME runtime', currentRom.fileName);

    try {
      await preflightMame();
    } catch (error) {
      drawStatus('MAME runtime missing', error.message);
      return;
    }

    clearMame();
    const gameBlob = new Blob([currentRom.bytes], { type: 'application/zip' });
    gameUrl = URL.createObjectURL(gameBlob);
    const driver = driverFromFileName(currentRom.fileName);

    drawStatus('Loading MAME', `${driver} from ${currentRom.fileName}`);
    await loadScript('/arcade/mamejs.js');

    if (!window.mamejs?.load) {
      drawStatus('MAME loader missing', 'mamejs.js did not expose window.mamejs');
      return;
    }

    currentMame = await window.mamejs.load('/arcade/mame/mame.js', container, {
      print: (text) => console.log('MAME:', text),
      printErr: (text) => console.warn('MAME:', text),
    });
    await currentMame.loadRoms({ [currentRom.fileName]: gameUrl });
    statusText = '';
    await currentMame.runGame(driver, { width: 640, height: 480 });
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

    const target = container.querySelector('iframe')?.contentDocument?.querySelector('canvas')
      || container.querySelector('canvas')
      || window;
    const eventType = action === 'down' ? 'keydown' : 'keyup';
    const event = new KeyboardEvent(eventType, {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      bubbles: true,
      cancelable: true,
    });

    target.dispatchEvent(event);
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

  function mirrorMameCanvas() {
    const mameCanvas = container.querySelector('iframe')?.contentDocument?.querySelector('canvas')
      || container.querySelector('canvas');

    if (mameCanvas && mameCanvas.width && mameCanvas.height) {
      context.fillStyle = '#000';
      context.fillRect(0, 0, screen.width, screen.height);

      const scale = Math.min(screen.width / mameCanvas.width, screen.height / mameCanvas.height);
      const width = mameCanvas.width * scale;
      const height = mameCanvas.height * scale;
      const x = (screen.width - width) / 2;
      const y = (screen.height - height) / 2;

      context.imageSmoothingEnabled = false;
      context.drawImage(mameCanvas, x, y, width, height);
    } else if (statusText) {
      // Keep the drawn status frame visible.
    }

    requestAnimationFrame(mirrorMameCanvas);
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;

    const message = event.data || {};
    if (message.type === 'arcade_start') {
      window.getArcadeAudioStream();
      return;
    }

    if (message.type === 'arcade_autoload') {
      currentRom = {
        fileName: message.fileName || 'game.zip',
        bytes: new Uint8Array(message.bytes || []),
      };
      loadCurrentRom().catch((error) => {
        console.error('Old Style Gaming MAME error:', error);
        drawStatus('MAME error', error.message || 'Check browser console');
      });
      return;
    }

    if (message.type === 'arcade_reset') {
      loadCurrentRom().catch((error) => {
        console.error('Old Style Gaming MAME reset error:', error);
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
    drawStatus('MAME error', message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('Old Style Gaming MAME promise error:', event.reason);
    drawStatus('MAME error', event.reason?.message || 'Check browser console');
  });

  screen.addEventListener('pointerdown', () => {
    window.getArcadeAudioStream();
    window.focus();
  });

  drawStatus('MAME ready', 'Load a MAME ROM zip from the room');
  mirrorMameCanvas();
})();
