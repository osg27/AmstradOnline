const root = document.getElementById("speccy");
let speccy = null;
let ready = false;
let pendingFile = null;
const previousJoystickMasks = new Map();
const heldKeyCounts = new Map();
let audioContext = null;
let audioDestination = null;
let audioKeepAlive = null;

function ensureAudioBridgeForContext(context) {
  if (!context || audioDestination) return audioDestination;

  audioContext = context;
  audioDestination = context.createMediaStreamDestination();

  try {
    audioKeepAlive = context.createOscillator();
    const gain = context.createGain();
    audioKeepAlive.frequency.value = 20;
    gain.gain.value = 0.00001;
    audioKeepAlive.connect(gain);
    gain.connect(audioDestination);
    audioKeepAlive.start();
  } catch {
    // Keep the bridge optional if a browser blocks oscillator startup.
  }

  return audioDestination;
}

function installAudioBridge() {
  const audioNodePrototype = window.AudioNode?.prototype;
  const audioDestinationPrototype = window.AudioDestinationNode?.prototype;

  if (!audioNodePrototype || !audioDestinationPrototype || audioNodePrototype.__osgSpectrumBridge) return;

  const originalConnect = audioNodePrototype.connect;
  audioNodePrototype.connect = function connectWithSpectrumBridge(destination, ...args) {
    const result = originalConnect.call(this, destination, ...args);

    if (audioDestinationPrototype.isPrototypeOf(destination)) {
      const bridge = ensureAudioBridgeForContext(this.context);
      if (bridge) {
        try {
          originalConnect.call(this, bridge);
        } catch {
          // Some nodes cannot be connected twice; normal audio should still work.
        }
      }
    }

    return result;
  };

  audioNodePrototype.__osgSpectrumBridge = true;
}

function resumeSpectrumAudio() {
  audioContext?.resume?.().catch(() => {});
}

window.getSpectrumAudioStream = function getSpectrumAudioStream() {
  resumeSpectrumAudio();
  return audioDestination?.stream || null;
};

const SINCLAIR_KEYS = {
  1: {
    up: "9",
    down: "8",
    left: "6",
    right: "7",
    fire: "0",
    extra: "n",
  },
  2: {
    up: "4",
    down: "3",
    left: "1",
    right: "2",
    fire: "5",
    extra: "n",
  },
};

const CURSOR_KEYS = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  fire: "0",
  extra: "n",
};

function getKeyName(key) {
  if (key === " ") return "Space";
  if (key === "ArrowUp") return "ArrowUp";
  if (key === "ArrowDown") return "ArrowDown";
  if (key === "ArrowLeft") return "ArrowLeft";
  if (key === "ArrowRight") return "ArrowRight";
  if (key === "Enter") return "Enter";
  if (key === "Shift") return "Shift";
  if (key === "Control") return "Control";
  return typeof key === "string" && key.length === 1 ? key.toLowerCase() : key;
}

function uniqueKeys(keys) {
  return [...new Set(keys.filter(Boolean))];
}

function getJoystickKeys(player) {
  return SINCLAIR_KEYS[player === 2 ? 2 : 1];
}

function getQaopKeys(player) {
  if (player === 2) {
    return {
      up: null,
      down: null,
      left: null,
      right: null,
      fire: null,
      extra: null,
    };
  }

  return {
    up: "q",
    down: "a",
    left: "o",
    right: "p",
    fire: "m",
    extra: null,
  };
}

function getLiveJoystickKeys(player) {
  if (player === 2) {
    return getJoystickKeys(2);
  }

  return CURSOR_KEYS;
}

function getInputKeys(key, player) {
  const keyName = getKeyName(key);
  if (!keyName) return [];

  const joystickKeys = getJoystickKeys(player);
  const qaopKeys = getQaopKeys(player);

  switch (keyName) {
    case "ArrowUp":
    case "q":
      return [qaopKeys.up, joystickKeys.up];
    case "ArrowDown":
    case "a":
      return [qaopKeys.down, joystickKeys.down];
    case "ArrowLeft":
    case "o":
      return [qaopKeys.left, joystickKeys.left];
    case "ArrowRight":
    case "p":
      return [qaopKeys.right, joystickKeys.right];
    case "m":
    case "f":
      return [qaopKeys.fire, joystickKeys.fire];
    case "z":
    case "g":
      return [qaopKeys.extra, joystickKeys.extra];
    default:
      return [keyName];
  }
}

function setKeyHeld(keyName, held) {
  const count = heldKeyCounts.get(keyName) || 0;

  if (held) {
    if (count > 0) return;
    if (speccy.pressKey(keyName) === false) return;
    heldKeyCounts.set(keyName, 1);
    return;
  }

  speccy.releaseKey(keyName);
  heldKeyCounts.delete(keyName);
}

function applyKeys(keys, action) {
  const held = action === "down";
  uniqueKeys(keys).forEach((keyName) => setKeyHeld(keyName, held));
}

async function loadSpectrumFile(fileName, bytes) {
  if (!speccy || !ready) {
    pendingFile = { fileName, bytes };
    return;
  }

  const file = new File([bytes], fileName || "game.tap");
  await speccy.openFile(file);
  speccy.focus();
}

function resetSpectrum() {
  if (!speccy || !ready) return;

  previousJoystickMasks.clear();
  heldKeyCounts.forEach((_count, keyName) => {
    speccy.releaseKey(keyName);
  });
  heldKeyCounts.clear();
  speccy.reset();
  speccy.focus();
}

function applyInput(key, action, player) {
  if (!speccy || !ready) return;

  if (action !== "down" && action !== "up") return;

  applyKeys(getInputKeys(key, player), action);
}

function getJoystickMaskKeys(player) {
  const joystickKeys = getLiveJoystickKeys(player);

  return [
    { bit: 1, keys: [joystickKeys.up] },
    { bit: 2, keys: [joystickKeys.down] },
    { bit: 4, keys: [joystickKeys.left] },
    { bit: 8, keys: [joystickKeys.right] },
    { bit: 16, keys: [joystickKeys.fire, "m"] },
    { bit: 32, keys: [joystickKeys.extra] },
  ];
}

function applyJoystickMask(mask, player) {
  if (!speccy || !ready) return;

  const nextMask = Number(mask) || 0;
  const joystickPlayer = player === 2 ? 2 : 1;
  const previousMask = previousJoystickMasks.get(joystickPlayer) || 0;

  getJoystickMaskKeys(joystickPlayer).forEach(({ bit, keys }) => {
    const active = Boolean(nextMask & bit);
    const wasActive = Boolean(previousMask & bit);

    if (active === wasActive) return;
    applyKeys(keys, active ? "down" : "up");
  });

  previousJoystickMasks.set(joystickPlayer, nextMask);
}

function boot() {
  installAudioBridge();

  speccy = window.JSSpeccy(root, {
    autoStart: true,
    autoLoadTapes: true,
    tapeTrapsEnabled: true,
    machine: 128,
    sandbox: true,
    uiEnabled: false,
    keyboardEnabled: true,
    zoom: 2,
  });

  speccy.onReady(() => {
    ready = true;
    speccy.focus();

    if (pendingFile) {
      const file = pendingFile;
      pendingFile = null;
      loadSpectrumFile(file.fileName, file.bytes);
    }
  });
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "spectrum_autoload") {
    loadSpectrumFile(data.fileName, data.bytes).catch((error) => {
      console.error("Spectrum load failed", error);
    });
    return;
  }

  if (data.type === "spectrum_reset") {
    resetSpectrum();
    return;
  }

  if (data.type === "amstrad_audio_unlock") {
    resumeSpectrumAudio();
    return;
  }

  if (data.type === "amstrad_remote_input" || data.type === "amstrad_remote_control") {
    applyInput(data.key, data.action, data.player);
  }

  if (data.type === "amstrad_remote_joystick") {
    applyJoystickMask(data.mask, data.player);
  }
});

boot();
