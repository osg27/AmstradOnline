(function () {
  const SCREEN_WIDTH = 256;
  const SCREEN_HEIGHT = 240;
  const TARGET_FPS = 60.0988;
  const FRAME_INTERVAL = 1000 / TARGET_FPS;
  const AUDIO_BUFFER_SIZE = 8192;
  const BUTTONS = window.jsnes?.Controller;

  const canvas = document.getElementById('screen');
  const context = canvas.getContext('2d', { alpha: false });
  const imageData = context.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
  const frameBuffer = new ArrayBuffer(imageData.data.length);
  const frameBuffer8 = new Uint8ClampedArray(frameBuffer);
  const frameBuffer32 = new Uint32Array(frameBuffer);
  const buttonMap = [
    [1, BUTTONS?.BUTTON_UP],
    [2, BUTTONS?.BUTTON_DOWN],
    [4, BUTTONS?.BUTTON_LEFT],
    [8, BUTTONS?.BUTTON_RIGHT],
    [16, BUTTONS?.BUTTON_B],
    [32, BUTTONS?.BUTTON_A],
    [64, BUTTONS?.BUTTON_START],
    [128, BUTTONS?.BUTTON_SELECT],
  ];

  let nes = null;
  let currentRom = null;
  let running = false;
  let rafHandle = null;
  let lastFrameAt = 0;
  let localMask = 0;
  let remoteMask = 0;
  let audioContext = null;
  let audioNode = null;
  let audioDestination = null;
  let keepAlive = null;
  let audioReadIndex = 0;
  let audioWriteIndex = 0;
  let audioCount = 0;
  const audioLeft = new Float32Array(AUDIO_BUFFER_SIZE);
  const audioRight = new Float32Array(AUDIO_BUFFER_SIZE);

  function drawStatus(main, sub = '') {
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#fff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '700 18px system-ui, sans-serif';
    context.fillText(main, canvas.width / 2, canvas.height / 2 - 10);
    if (sub) {
      context.fillStyle = '#b8c2d0';
      context.font = '12px system-ui, sans-serif';
      wrapText(sub, canvas.width / 2, canvas.height / 2 + 16, canvas.width - 28, 16);
    }
  }

  function wrapText(text, x, y, maxWidth, lineHeight) {
    const words = String(text).split(/\s+/);
    let line = '';

    words.forEach((word) => {
      const testLine = line ? `${line} ${word}` : word;
      if (context.measureText(testLine).width > maxWidth && line) {
        context.fillText(line, x, y);
        line = word;
        y += lineHeight;
      } else {
        line = testLine;
      }
    });

    if (line) context.fillText(line, x, y);
  }

  function resetAudioBuffer() {
    audioReadIndex = 0;
    audioWriteIndex = 0;
    audioCount = 0;
  }

  function ensureAudio() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;

    if (!audioContext) {
      audioContext = new AudioCtor();
      audioDestination = audioContext.createMediaStreamDestination();
      audioNode = audioContext.createScriptProcessor(1024, 0, 2);
      audioNode.onaudioprocess = (event) => {
        const outputLeft = event.outputBuffer.getChannelData(0);
        const outputRight = event.outputBuffer.getChannelData(1);

        for (let index = 0; index < outputLeft.length; index += 1) {
          if (audioCount > 0) {
            outputLeft[index] = audioLeft[audioReadIndex];
            outputRight[index] = audioRight[audioReadIndex];
            audioReadIndex = (audioReadIndex + 1) % AUDIO_BUFFER_SIZE;
            audioCount -= 1;
          } else {
            outputLeft[index] = 0;
            outputRight[index] = 0;
          }
        }
      };
      audioNode.connect(audioContext.destination);
      audioNode.connect(audioDestination);

      keepAlive = audioContext.createOscillator();
      const gain = audioContext.createGain();
      gain.gain.value = 0;
      keepAlive.connect(gain).connect(audioDestination);
      keepAlive.start();
    }

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }

    return audioContext;
  }

  function queueAudioSample(left, right) {
    if (audioCount >= AUDIO_BUFFER_SIZE) {
      audioReadIndex = (audioReadIndex + 1) % AUDIO_BUFFER_SIZE;
      audioCount -= 1;
    }

    audioLeft[audioWriteIndex] = left;
    audioRight[audioWriteIndex] = right;
    audioWriteIndex = (audioWriteIndex + 1) % AUDIO_BUFFER_SIZE;
    audioCount += 1;
  }

  window.getNesAudioStream = function getNesAudioStream() {
    ensureAudio();
    return audioDestination?.stream || null;
  };

  function renderFrame(buffer) {
    for (let index = 0; index < buffer.length; index += 1) {
      frameBuffer32[index] = 0xff000000 | buffer[index];
    }
    imageData.data.set(frameBuffer8);
    context.putImageData(imageData, 0, 0);
  }

  function applyMask(player, mask) {
    if (!nes || !BUTTONS) return;

    buttonMap.forEach(([bit, button]) => {
      if (button === undefined) return;
      if (mask & bit) {
        nes.buttonDown(player, button);
      } else {
        nes.buttonUp(player, button);
      }
    });
  }

  function setMask(player, mask) {
    const cleanMask = Number(mask) || 0;
    if (player === 2) {
      remoteMask = cleanMask;
    } else {
      localMask = cleanMask;
    }
    applyMask(player === 2 ? 2 : 1, cleanMask);
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
      case 'z':
      case 'Z':
      case 'f':
      case 'F':
        return 16;
      case 'x':
      case 'X':
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
    const current = player === 2 ? remoteMask : localMask;
    const next = action === 'down' ? current | bit : current & ~bit;
    setMask(player, next);
  }

  function stopLoop() {
    running = false;
    if (rafHandle) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  }

  function loop(timestamp) {
    if (!running || !nes) return;

    rafHandle = requestAnimationFrame(loop);
    if (!lastFrameAt) {
      lastFrameAt = timestamp;
    }

    if (timestamp - lastFrameAt < FRAME_INTERVAL) return;
    lastFrameAt = timestamp;

    try {
      nes.frame();
    } catch (error) {
      console.error('Old Style Gaming NES error:', error);
      stopLoop();
      drawStatus('NES failed', error?.message || 'Check browser console');
    }
  }

  function startLoop() {
    if (running) return;
    running = true;
    lastFrameAt = 0;
    rafHandle = requestAnimationFrame(loop);
  }

  function loadCurrentRom() {
    if (!currentRom) return;

    if (!window.jsnes?.NES || !BUTTONS) {
      drawStatus('NES failed', 'jsnes runtime did not load');
      return;
    }

    ensureAudio();
    resetAudioBuffer();
    stopLoop();
    drawStatus('Loading NES', currentRom.fileName);

    try {
      nes = new window.jsnes.NES({
        sampleRate: ensureAudio()?.sampleRate || 44100,
        onFrame: renderFrame,
        onAudioSample: queueAudioSample,
      });
      nes.loadROM(currentRom.bytes);
      applyMask(1, localMask);
      applyMask(2, remoteMask);
      startLoop();
    } catch (error) {
      console.error('Old Style Gaming NES error:', error);
      drawStatus('NES failed', error?.message || 'Check browser console');
    }
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;

    const message = event.data || {};
    if (message.type === 'nes_start') {
      ensureAudio();
      if (currentRom && !running) loadCurrentRom();
      return;
    }

    if (message.type === 'nes_autoload') {
      currentRom = {
        fileName: message.fileName || 'game.nes',
        bytes: new Uint8Array(message.bytes || []),
      };
      loadCurrentRom();
      return;
    }

    if (message.type === 'nes_reset') {
      if (nes) {
        resetAudioBuffer();
        nes.reset();
        applyMask(1, localMask);
        applyMask(2, remoteMask);
        startLoop();
      } else {
        loadCurrentRom();
      }
      return;
    }

    if (message.type === 'amstrad_audio_unlock') {
      ensureAudio();
      return;
    }

    if (message.type === 'amstrad_remote_joystick') {
      setMask(message.player || 1, message.mask);
      return;
    }

    if (message.type === 'amstrad_remote_input' || message.type === 'amstrad_remote_control') {
      handleKeyInput(message.player || 1, message.key, message.action);
    }
  });

  window.addEventListener('keydown', (event) => {
    handleKeyInput(1, event.key, 'down');
  });

  window.addEventListener('keyup', (event) => {
    handleKeyInput(1, event.key, 'up');
  });

  canvas.addEventListener('pointerdown', () => {
    window.getNesAudioStream();
    window.focus();
    if (currentRom && !running) loadCurrentRom();
  });

  drawStatus('NES ready', 'Load a .nes ROM from the room');
}());
