const canvas = document.getElementById('screen');
const context = canvas.getContext('2d', { alpha: false });
const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
const SUPPORTED_MAPPERS = new Set([0, 1, 2, 3, 7, 66]);
const MAPPER_NAMES = {
  0: 'NROM',
  1: 'MMC1',
  2: 'UxROM',
  3: 'CNROM / mapper 003',
  4: 'MMC3',
  7: 'AxROM',
  66: 'GxROM',
};

let Nes = null;
let Button = null;
let emulator = null;
let currentRom = null;
let loading = false;
let localMask = 0;
let remoteMask = 0;
let sharedAudioContext = null;
let audioDestination = null;
let keepAlive = null;

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

  if (line) {
    context.fillText(line, x, y);
  }
}

function getRomMapper(bytes) {
  if (!bytes || bytes.length < 16) {
    throw new Error('Not a valid .nes file');
  }

  if (bytes[0] !== 0x4e || bytes[1] !== 0x45 || bytes[2] !== 0x53 || bytes[3] !== 0x1a) {
    throw new Error('Not an iNES ROM');
  }

  return ((bytes[6] >> 4) | (bytes[7] & 0xf0)) & 0xff;
}

function describeMapper(mapper) {
  return MAPPER_NAMES[mapper] ? `${mapper} (${MAPPER_NAMES[mapper]})` : String(mapper);
}

function ensureAudio() {
  if (!OriginalAudioContext) return null;
  if (!sharedAudioContext) {
    sharedAudioContext = new OriginalAudioContext();
  }
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(() => {});
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
  if (originalConnect && !window.__oldStyleNesAudioPatched) {
    window.__oldStyleNesAudioPatched = true;
    window.AudioNode.prototype.connect = function patchedConnect(destination, ...args) {
      const result = originalConnect.call(this, destination, ...args);
      if (audioDestination && destination === sharedAudioContext?.destination) {
        try {
          originalConnect.call(this, audioDestination);
        } catch {}
      }
      return result;
    };
  }
}

window.getNesAudioStream = function getNesAudioStream() {
  ensureAudio();
  return audioDestination?.stream || null;
};

function maskToButtons(mask) {
  return [
    [Button.Up, Boolean(mask & 1)],
    [Button.Down, Boolean(mask & 2)],
    [Button.Left, Boolean(mask & 4)],
    [Button.Right, Boolean(mask & 8)],
    [Button.B, Boolean(mask & 16)],
    [Button.A, Boolean(mask & 32)],
    [Button.Start, Boolean(mask & 64)],
    [Button.Select, Boolean(mask & 128)],
  ];
}

function applyMask(player, mask) {
  if (!emulator || !Button) return;
  maskToButtons(mask).forEach(([button, pressed]) => {
    emulator.input(player, button, pressed);
  });
}

function setMask(player, mask) {
  const cleanMask = Number(mask) || 0;
  if (player === 2) {
    remoteMask = cleanMask;
  } else {
    localMask = cleanMask;
  }
  applyMask(player === 2 ? 1 : 0, cleanMask);
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

async function ensureRuntime() {
  if (Nes && Button) return;
  const module = await import(`./wasm-nes.js?v=2026-06-18-1`);
  Nes = module.Nes;
  Button = module.Button;
}

async function loadCurrentRom() {
  if (!currentRom || loading) return;
  loading = true;
  ensureAudio();
  drawStatus('Loading NES', currentRom.fileName);

  try {
    const mapper = getRomMapper(currentRom.bytes);
    if (!SUPPORTED_MAPPERS.has(mapper)) {
      drawStatus('NES mapper not supported', `${currentRom.fileName} uses mapper ${describeMapper(mapper)}. This wasm-nes build supports 0, 1, 2, 3, 7 and 66.`);
      return;
    }

    await ensureRuntime();
    if (emulator) {
      emulator.stop();
    }
    emulator = await Nes.new(currentRom.bytes);
    emulator.canvas = canvas;
    applyMask(0, localMask);
    applyMask(1, remoteMask);
    emulator.start();
  } catch (error) {
    console.error('Old Style Gaming NES error:', error);
    drawStatus('NES failed', error?.message || 'Check browser console');
  } finally {
    loading = false;
  }
}

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;

  const message = event.data || {};
  if (message.type === 'nes_start') {
    ensureAudio();
    if (currentRom && !emulator) loadCurrentRom();
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
    if (emulator) {
      emulator.reset();
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
  if (currentRom && !emulator) loadCurrentRom();
});

drawStatus('NES ready', 'Load a .nes ROM from the room');
