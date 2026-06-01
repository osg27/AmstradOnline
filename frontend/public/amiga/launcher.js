const playerRoot = document.getElementById("amiga-player");
const placeholderCanvas = document.getElementById("placeholder-canvas");
const placeholderContext = placeholderCanvas.getContext("2d");
const runtimeVersion = "2026-06-01-2";
let runtimeReady = false;
let emulatorStarted = false;
let startRequested = false;
let pendingFile = null;
let pendingFileLoadId = 0;
let sentFileLoadId = 0;
let customKickstartRom = null;
let sentKickstartRom = null;
let audioContext = null;
let audioDestination = null;
let amigaAudioSource = null;
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

function ensureAudioDestination() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();
    audioDestination = audioContext.createMediaStreamDestination();

    const silence = audioContext.createConstantSource();
    const silenceGain = audioContext.createGain();
    silenceGain.gain.value = 0;
    silence.connect(silenceGain);
    silenceGain.connect(audioDestination);
    silence.start();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  return audioDestination;
}

function connectNestedAmigaAudio() {
  const destination = ensureAudioDestination();
  const nestedStream = getVAmigaFrame()?.contentWindow?.getVAmigaAudioStream?.();
  const nestedAudioTrack = nestedStream?.getAudioTracks?.()[0];

  if (!nestedAudioTrack || amigaAudioSource) return;

  amigaAudioSource = audioContext.createMediaStreamSource(nestedStream);
  amigaAudioSource.connect(destination);
}

function getAmigaAudioStream() {
  const destination = ensureAudioDestination();
  connectNestedAmigaAudio();
  return destination.stream;
}

window.getAmigaAudioStream = getAmigaAudioStream;

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
  if (customKickstartRom && sentKickstartRom !== customKickstartRom) return;
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

function setPendingFile(fileName, bytes) {
  pendingFile = {
    name: fileName || "game.adf",
    bin: bytes,
  };
  pendingFileLoadId += 1;
  sentFileLoadId = 0;
}

function sendKickstartToEmulator() {
  if (!customKickstartRom || !runtimeReady || !emulatorStarted) return;
  if (sentKickstartRom === customKickstartRom) return;

  sentKickstartRom = customKickstartRom;

  postToEmulator({
    cmd: "load",
    kickstart_rom: customKickstartRom,
  });

  sentFileLoadId = 0;
  window.setTimeout(sendPendingFileToEmulator, 600);
}

function startEmulator() {
  startRequested = true;
  if (!runtimeReady || emulatorStarted) return;

  emulatorStarted = true;
  placeholderCanvas.remove();
  playerRoot.innerHTML = '<div id="amiga-preview"></div>';

  window.vAmigaWeb_player.vAmigaWeb_url = "./";
  window.vAmigaWeb_player.samesite_file = null;

  const config = {
    AROS: !customKickstartRom,
    navbar: false,
    wide: true,
    border: 0.3,
    mouse: true,
  };

  window.vAmigaWeb_player.load(
    document.getElementById("amiga-preview"),
    `?v=${encodeURIComponent(runtimeVersion)}`,
    encodeURIComponent(JSON.stringify(config)),
  );

  window.setTimeout(sendKickstartToEmulator, 800);
  window.setTimeout(sendPendingFileToEmulator, 1000);
  window.setInterval(connectNestedAmigaAudio, 1000);
}

function loadAmigaFile(fileName, bytes) {
  setPendingFile(fileName, bytes);

  if (!runtimeReady) return;
  if (!emulatorStarted) {
    startEmulator();
    return;
  }

  resetAmiga();
  window.setTimeout(sendPendingFileToEmulator, 600);
}

function swapAmigaDisk(fileName, bytes) {
  setPendingFile(fileName, bytes);

  if (!runtimeReady) return;
  if (!emulatorStarted) {
    startEmulator();
    return;
  }

  sendPendingFileToEmulator();
}

function resetAmiga() {
  if (!runtimeReady || !emulatorStarted) return;

  if (window.vAmigaWeb_player && typeof window.vAmigaWeb_player.reset === "function") {
    window.vAmigaWeb_player.reset();
  }
}

function loadKickstartRom(bytes) {
  customKickstartRom = bytes;
  sentKickstartRom = null;
  sentFileLoadId = 0;

  if (!runtimeReady) return;
  if (!emulatorStarted) return;

  sendKickstartToEmulator();
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

function applyAmigaKeyboardInput(code, key, action) {
  if (!runtimeReady || !emulatorStarted || !code) return;

  const isDown = action === "down";
  runScript(`
    (function () {
      if (typeof translateKey2 !== 'function' || typeof wasm_schedule_key !== 'function') return;
      var keyCode = translateKey2(${JSON.stringify(code)}, ${JSON.stringify(key || "")});
      if (keyCode === undefined || keyCode.raw_key === undefined || keyCode.raw_key[0] === undefined) return;
      wasm_schedule_key(keyCode.raw_key[0], keyCode.raw_key[1], ${isDown ? 1 : 0}, ${isDown ? 0 : 1});
      if (keyCode.modifier != null) {
        wasm_schedule_key(keyCode.modifier[0], keyCode.modifier[1], ${isDown ? 1 : 0}, ${isDown ? 0 : 1});
      }
    })();
  `);
}

function applyAmigaMouseButton(button, action) {
  if (!runtimeReady || !emulatorStarted) return;

  const amigaButton = button === 3 ? 3 : 1;
  if (action !== "down") return;

  postToEmulator({
    cmd: "osg_mouse_button",
    button: amigaButton,
    state: 1,
  });

  window.setTimeout(() => {
    postToEmulator({
      cmd: "osg_mouse_button",
      button: amigaButton,
      state: 0,
    });
  }, 140);

  runScript(`
    (function () {
      function mouseButton(port, button, state) {
        if (typeof Module !== 'undefined' && typeof Module._wasm_mouse_button === 'function') {
          Module._wasm_mouse_button(port, button, state);
        } else if (typeof wasm_mouse_button === 'function') {
          wasm_mouse_button(port, button, state);
        }
      }

      function dispatchMouse(button, type) {
        var canvas = document.getElementById('canvas');
        var target = canvas || document;
        var makeEvent = function () {
          return new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            button: button === 3 ? 2 : 0,
            buttons: type === 'mouseup' ? 0 : button === 3 ? 2 : 1,
            which: button,
            clientX: window.innerWidth / 2,
            clientY: window.innerHeight / 2
          });
        };
        target.dispatchEvent(makeEvent());
        if (target !== document) {
          document.dispatchEvent(makeEvent());
        }
      }

      for (var port = 1; port <= 2; port += 1) {
        mouseButton(port, ${amigaButton}, 1);
      }
      dispatchMouse(${amigaButton}, 'mousedown');

      if (${amigaButton} === 1 && typeof emit_joystick_cmd === 'function') {
        emit_joystick_cmd('1PRESS_FIRE');
        emit_joystick_cmd('2PRESS_FIRE');
      }

      setTimeout(function () {
        for (var port = 1; port <= 2; port += 1) {
          mouseButton(port, ${amigaButton}, 0);
        }
        dispatchMouse(${amigaButton}, 'mouseup');
        dispatchMouse(${amigaButton}, 'click');

        if (${amigaButton} === 1 && typeof emit_joystick_cmd === 'function') {
          emit_joystick_cmd('1RELEASE_FIRE');
          emit_joystick_cmd('2RELEASE_FIRE');
        }
      }, 140);
    })();
  `);
}

function applyAmigaMouseMove(dx, dy) {
  if (!runtimeReady || !emulatorStarted) return;

  const movementX = Math.max(-80, Math.min(80, Number(dx) || 0));
  const movementY = Math.max(-80, Math.min(80, Number(dy) || 0));
  if (!movementX && !movementY) return;

  runScript(`
    if (typeof Module !== 'undefined' && typeof Module._wasm_mouse === 'function') {
      Module._wasm_mouse(1, ${movementX}, ${movementY});
    } else if (typeof wasm_mouse === 'function') {
      wasm_mouse(1, ${movementX}, ${movementY});
    }
  `);
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.msg === "render_run_state") {
    if (customKickstartRom) {
      sendKickstartToEmulator();
    } else {
      sendPendingFileToEmulator();
    }
    connectNestedAmigaAudio();
    return;
  }

  if (data.type === "amiga_start") {
    startEmulator();
    return;
  }

  if (data.type === "amiga_autoload") {
    loadAmigaFile(data.fileName, data.bytes);
    return;
  }

  if (data.type === "amiga_swap_disk") {
    swapAmigaDisk(data.fileName, data.bytes);
    return;
  }

  if (data.type === "amiga_reset") {
    resetAmiga();
    return;
  }

  if (data.type === "amiga_kickstart") {
    loadKickstartRom(data.bytes);
    return;
  }

  if (data.type === "amstrad_remote_joystick") {
    applyJoystickMask(data.mask, data.player);
    return;
  }

  if (data.type === "amiga_keyboard") {
    applyAmigaKeyboardInput(data.code, data.key, data.action);
    connectNestedAmigaAudio();
    return;
  }

  if (data.type === "amiga_mouse_button") {
    applyAmigaMouseButton(data.button, data.action);
    connectNestedAmigaAudio();
    return;
  }

  if (data.type === "amiga_mouse_move") {
    applyAmigaMouseMove(data.movementX, data.movementY);
    return;
  }

  if (data.type === "amstrad_audio_unlock") {
    ensureAudioDestination();
    connectNestedAmigaAudio();
    return;
  }

  if (data.type === "amstrad_remote_input" || data.type === "amstrad_remote_control") {
    applyKeyInput(data.key, data.action, data.player);
  }
});

drawStatus("Starting Amiga", "Checking vAmigaWeb runtime...");
checkRuntime().then((ready) => {
  if (!ready) return;
  if (startRequested) {
    startEmulator();
  } else {
    showStatus("Amiga ready", "Load Kickstart first or start with AROS.");
  }
});
