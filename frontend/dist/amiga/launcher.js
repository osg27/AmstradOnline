const playerRoot = document.getElementById("amiga-player");
const placeholderCanvas = document.getElementById("placeholder-canvas");
const placeholderContext = placeholderCanvas.getContext("2d");
const runtimeVersion = "2026-05-30-1";
let runtimeReady = false;
let emulatorStarted = false;
let pendingFile = null;
let pendingFileLoadId = 0;
let sentFileLoadId = 0;
const previousJoystickMasks = new Map();

function drawStatus(title, detail) {
  if (placeholderContext) {
    placeholderContext.fillStyle = "#000";
    placeholderContext.fillRect(0, 0, placeholderCanvas.width, placeholderCanvas.height);
    placeholderContext.fillStyle = "#f6f1e7";
    placeholderContext.font = "bold 24px sans-serif";
    placeholderContext.textAlign = "center";
    placeholderContext.fillText(title, placeholderCanvas.width / 2, placeholderCanvas.height / 2 - 10);
    placeholderContext.fillStyle = "#b9b2a4";
    placeholderContext.font = "16px sans-serif";
    placeholderContext.fillText(detail, placeholderCanvas.width / 2, placeholderCanvas.height / 2 + 20);
  }
}

function showStatus(title, detail) {
  drawStatus(title, detail);
  playerRoot.innerHTML = `
    <div class="amiga-status">
      <div>
        <strong>${title}</strong>
        <p>${detail}</p>
      </div>
    </div>
  `;
}

function runtimeUrl(path) {
  return `${path}?v=${encodeURIComponent(runtimeVersion)}`;
}

async function fileExists(path) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(runtimeUrl(path), {
      cache: "no-store",
      method: "HEAD",
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error.name || "fetch failed" };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function checkRuntime() {
  const requiredFiles = ["index.html", "vAmiga.js", "vAmiga.wasm"];

  for (const fileName of requiredFiles) {
    showStatus("Starting Amiga", `Checking ${fileName}...`);
    const result = await fileExists(fileName);

    if (!result.ok) {
      const reason = result.status ? `HTTP ${result.status}` : result.error;
      showStatus("Amiga runtime blocked", `${fileName} could not be loaded (${reason}). Redeploy or hard refresh.`);
      return false;
    }
  }

  runtimeReady = true;
  return true;
}

function getVAmigaFrame() {
  return document.getElementById("vAmigaWeb");
}

function postToEmulator(message) {
  const frame = getVAmigaFrame();
  frame?.contentWindow?.postMessage(message, "*");
}

function insertPendingFileIntoDf0(loadId) {
  window.setTimeout(() => {
    if (loadId !== pendingFileLoadId) return;

    runScript(`
      if (typeof show_drive_select === 'function') {
        show_drive_select(false);
      }
      if (typeof insert_file === 'function') {
        insert_file(0);
      }
    `);
  }, 300);
}

function sendPendingFileToEmulator() {
  if (!pendingFile || !runtimeReady || !emulatorStarted) return;
  if (sentFileLoadId === pendingFileLoadId) return;

  const loadId = pendingFileLoadId;
  sentFileLoadId = loadId;

  postToEmulator({
    cmd: "load",
    file_name: pendingFile.name,
    file: pendingFile.bin,
  });
  insertPendingFileIntoDf0(loadId);
}

function startEmulator() {
  if (!runtimeReady || emulatorStarted) return;

  emulatorStarted = true;
  placeholderCanvas.remove();
  playerRoot.innerHTML = '<div id="amiga-preview"></div>';

  window.vAmigaWeb_player.vAmigaWeb_url = "./";
  window.vAmigaWeb_player.samesite_file = null;

  const config = {
    AROS: true,
    navbar: false,
    wide: true,
    border: 0.3,
    port1: true,
    port2: true,
  };

  window.vAmigaWeb_player.load(
    document.getElementById("amiga-preview"),
    `?v=${encodeURIComponent(runtimeVersion)}`,
    encodeURIComponent(JSON.stringify(config)),
  );

  window.setTimeout(sendPendingFileToEmulator, 800);
}

function loadAmigaFile(fileName, bytes) {
  pendingFile = {
    name: fileName || "game.adf",
    bin: bytes,
  };
  pendingFileLoadId += 1;
  sentFileLoadId = 0;

  if (!runtimeReady) return;
  if (!emulatorStarted) {
    startEmulator();
    return;
  }

  sendPendingFileToEmulator();
}

function runScript(script) {
  postToEmulator({ cmd: "script", script });
}

function joystickPortForPlayer(player) {
  return player === 2 ? "1" : "2";
}

function joystickCommandsForBit(bit, active) {
  if (bit === 1) return [active ? "PULL_UP" : "RELEASE_Y"];
  if (bit === 2) return [active ? "PULL_DOWN" : "RELEASE_Y"];
  if (bit === 4) return [active ? "PULL_LEFT" : "RELEASE_X"];
  if (bit === 8) return [active ? "PULL_RIGHT" : "RELEASE_X"];
  if (bit === 16) return [active ? "PRESS_FIRE" : "RELEASE_FIRE"];
  if (bit === 32) return [active ? "PRESS_FIRE2" : "RELEASE_FIRE2"];
  return [];
}

function applyJoystickMask(mask, player) {
  if (!runtimeReady || !emulatorStarted) return;

  const joystickPlayer = player === 2 ? 2 : 1;
  const port = joystickPortForPlayer(joystickPlayer);
  const nextMask = Number(mask) || 0;
  const previousMask = previousJoystickMasks.get(joystickPlayer) || 0;

  [1, 2, 4, 8, 16, 32].forEach((bit) => {
    const active = Boolean(nextMask & bit);
    const wasActive = Boolean(previousMask & bit);

    if (active === wasActive) return;
    joystickCommandsForBit(bit, active).forEach((command) => {
      runScript(`emit_joystick_cmd('${port}${command}')`);
    });
  });

  previousJoystickMasks.set(joystickPlayer, nextMask);
}

function keyboardKeyToMask(key) {
  switch (key) {
    case "ArrowUp":
    case "q":
    case "Q":
      return 1;
    case "ArrowDown":
    case "a":
    case "A":
      return 2;
    case "ArrowLeft":
    case "o":
    case "O":
      return 4;
    case "ArrowRight":
    case "p":
    case "P":
      return 8;
    case "x":
    case "X":
    case "f":
    case "F":
      return 16;
    case "z":
    case "Z":
    case "g":
    case "G":
      return 32;
    default:
      return 0;
  }
}

function applyKeyInput(key, action, player) {
  const bit = keyboardKeyToMask(key);
  if (!bit) return;

  const joystickPlayer = player === 2 ? 2 : 1;
  const previousMask = previousJoystickMasks.get(joystickPlayer) || 0;
  const nextMask = action === "down" ? previousMask | bit : previousMask & ~bit;
  applyJoystickMask(nextMask, joystickPlayer);
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.msg === "render_run_state") {
    sendPendingFileToEmulator();
    return;
  }

  if (data.type === "amiga_autoload") {
    loadAmigaFile(data.fileName, data.bytes);
    return;
  }

  if (data.type === "amstrad_remote_joystick") {
    applyJoystickMask(data.mask, data.player);
    return;
  }

  if (data.type === "amstrad_remote_input" || data.type === "amstrad_remote_control") {
    applyKeyInput(data.key, data.action, data.player);
  }
});

drawStatus("Starting Amiga", "Checking vAmigaWeb runtime...");
checkRuntime().then((ready) => {
  if (ready) startEmulator();
});
