const root = document.getElementById("speccy");
let speccy = null;
let ready = false;
let pendingFile = null;
let previousJoystickMask = 0;
const heldKeyCounts = new Map();

const JOYSTICK_KEYS = [
  { bit: 1, keys: ["q", "9"] },
  { bit: 2, keys: ["a", "8"] },
  { bit: 4, keys: ["o", "6"] },
  { bit: 8, keys: ["p", "7"] },
  { bit: 16, keys: ["m", "0", "Space", " "] },
  { bit: 32, keys: ["n"] },
];

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

function getInputKeys(key) {
  const keyName = getKeyName(key);
  if (!keyName) return [];

  switch (keyName) {
    case "ArrowUp":
    case "q":
      return ["q", "9"];
    case "ArrowDown":
    case "a":
      return ["a", "8"];
    case "ArrowLeft":
    case "o":
      return ["o", "6"];
    case "ArrowRight":
    case "p":
      return ["p", "7"];
    case "x":
    case "f":
      return ["m", "0", "Space", " "];
    case "z":
    case "g":
      return ["n"];
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

function applyInput(key, action) {
  if (!speccy || !ready) return;

  if (action !== "down" && action !== "up") return;

  applyKeys(getInputKeys(key), action);
}

function applyJoystickMask(mask) {
  if (!speccy || !ready) return;

  const nextMask = Number(mask) || 0;

  JOYSTICK_KEYS.forEach(({ bit, keys }) => {
    const active = Boolean(nextMask & bit);
    const wasActive = Boolean(previousJoystickMask & bit);

    if (active === wasActive) return;
    applyKeys(keys, active ? "down" : "up");
  });

  previousJoystickMask = nextMask;
}

function boot() {
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

  if (data.type === "amstrad_remote_input" || data.type === "amstrad_remote_control") {
    applyInput(data.key, data.action);
  }

  if (data.type === "amstrad_remote_joystick") {
    applyJoystickMask(data.mask);
  }
});

boot();
