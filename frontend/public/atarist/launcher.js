(function () {
  const screen = document.getElementById("atarist-screen");
  const gameContainer = document.getElementById("game");
  const context = screen.getContext("2d", { alpha: false });

  let currentMedia = [];
  let loaderScript = null;
  let gameUrl = null;
  let customTos = null;
  let sharedAudioContext = null;
  let audioDestination = null;
  let keepAlive = null;
  let localMask = 0;
  let remoteMask = 0;
  let lastSimulatedMasks = [0, 0];
  let joystickPortsSwapped = false;
  let soloMode = false;
  let warpEnabled = false;
  let statusText = "Atari ST ready";

  const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;

  function drawStatus(main, sub = "") {
    statusText = main;
    context.fillStyle = "#000";
    context.fillRect(0, 0, screen.width, screen.height);
    context.fillStyle = "#fff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "700 34px system-ui, sans-serif";
    context.fillText(main, screen.width / 2, screen.height / 2 - 18);
    if (sub) {
      context.fillStyle = "#bcc4cf";
      context.font = "22px system-ui, sans-serif";
      context.fillText(sub, screen.width / 2, screen.height / 2 + 24);
    }
  }

  function ensureAudio() {
    if (!OriginalAudioContext) return null;
    if (sharedAudioContext?.state === "closed") {
      sharedAudioContext = null;
      audioDestination = null;
      keepAlive = null;
    }
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
    if (originalConnect && !window.__oldStyleAtariStAudioPatched) {
      window.__oldStyleAtariStAudioPatched = true;
      window.AudioNode.prototype.connect = function patchedConnect(
        destination,
        ...args
      ) {
        const result = originalConnect.call(this, destination, ...args);
        if (
          audioDestination &&
          destination === sharedAudioContext?.destination &&
          this !== audioDestination
        ) {
          try {
            originalConnect.call(this, audioDestination);
          } catch {
            // Some nodes only allow one output. The main audio path should keep working.
          }
        }
        return result;
      };
    }
  }

  window.getAtariStAudioStream = function getAtariStAudioStream() {
    const audioContext = ensureAudio();
    audioContext?.resume?.().catch(() => {});
    return audioDestination?.stream || null;
  };

  function maskToButtons(mask) {
    const buttons = new Array(16).fill(false);
    buttons[12] = Boolean(mask & 1);
    buttons[13] = Boolean(mask & 2);
    buttons[14] = Boolean(mask & 4);
    buttons[15] = Boolean(mask & 8);
    buttons[0] = Boolean(mask & 16); // B
    buttons[1] = Boolean(mask & 32); // Y
    buttons[9] = Boolean(mask & 64); // Start
    buttons[8] = Boolean(mask & 128); // A
    return buttons;
  }

  function buildPad(index, mask) {
    const pressedButtons = maskToButtons(mask);
    return {
      id: `Old Style Atari ST Pad ${index + 1}`,
      index,
      connected: true,
      mapping: "standard",
      timestamp: performance.now(),
      axes: [0, 0, 0, 0],
      buttons: pressedButtons.map((pressed) => ({
        pressed,
        touched: pressed,
        value: pressed ? 1 : 0,
      })),
    };
  }

  const originalGetGamepads = navigator.getGamepads?.bind(navigator);
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value() {
      const nativePads = originalGetGamepads
        ? Array.from(originalGetGamepads())
        : [];
      nativePads[0] = buildPad(0, localMask);
      nativePads[1] = buildPad(1, remoteMask);
      return nativePads;
    },
  });

  function simulateMask(playerIndex, nextMask) {
    const emulator = window.EJS_emulator;
    const manager = emulator?.gameManager;

    if (!emulator?.started || !manager?.simulateInput) return false;

    const previous = lastSimulatedMasks[playerIndex] || 0;
    const mappings = [
      [1, 4],
      [2, 5],
      [4, 6],
      [8, 7],
      [16, 0],
      [32, 1],
      [64, 3],
      [128, 8],
    ];

    mappings.forEach(([bit, button]) => {
      const wasPressed = Boolean(previous & bit);
      const isPressed = Boolean(nextMask & bit);
      if (wasPressed !== isPressed) {
        manager.simulateInput(playerIndex, button, isPressed ? 1 : 0);
      }
    });

    lastSimulatedMasks[playerIndex] = nextMask;
    return true;
  }

  function setMask(player, mask) {
    if (player === 1) {
      localMask = mask;
      simulateMask(joystickPortsSwapped ? 1 : 0, mask);
    } else {
      remoteMask = mask;
      simulateMask(joystickPortsSwapped ? 0 : 1, mask);
    }
  }

  function swapJoystickPorts() {
    simulateMask(0, 0);
    simulateMask(1, 0);
    joystickPortsSwapped = !joystickPortsSwapped;
    lastSimulatedMasks = [0, 0];
    setMask(1, localMask);
    setMask(2, soloMode ? 0 : remoteMask);
    console.log(
      `Old Style Gaming Atari ST: P1 joystick using port ${joystickPortsSwapped ? "1" : "2"}`,
    );
  }

  function postMediaStatus(message = "") {
    const manager = window.EJS_emulator?.gameManager;
    const count = manager ? manager.getDiskCount?.() || 0 : currentMedia.length;
    const current = count ? manager?.getCurrentDisk?.() || 0 : 0;
    window.parent.postMessage(
      {
        type: "atarist_media_status",
        count,
        current,
        fileName:
          currentMedia[current]?.fileName || currentMedia[0]?.fileName || "",
        message,
      },
      window.location.origin,
    );
  }

  function nextMedia() {
    const manager = window.EJS_emulator?.gameManager;
    const count = manager?.getDiskCount?.() || 0;

    if (count < 2) {
      postMediaStatus("Only one Atari ST disk or tape is mounted");
      return;
    }

    const next = ((manager.getCurrentDisk?.() || 0) + 1) % count;
    manager.setCurrentDisk(next);
    setTimeout(
      () =>
        postMediaStatus(`Switched to Atari ST media ${next + 1} of ${count}`),
      50,
    );
  }

  function setWarp(enabled) {
    warpEnabled = Boolean(enabled);
    const manager = window.EJS_emulator?.gameManager;

    if (manager) {
      manager.setFastForwardRatio(0);
      manager.toggleFastForward(warpEnabled);
    }
    console.log(
      `Old Style Gaming Atari ST: warp ${warpEnabled ? "enabled" : "disabled"}`,
    );
  }

  function keyToMaskBit(key) {
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
      case "Enter":
        return 64;
      case "c":
      case "C":
        return 128;
      default:
        return 0;
    }
  }

  function handleKeyInput(player, key, action) {
    const bit = keyToMaskBit(key);
    const isDown = action === "down" || action === "keydown";

    if (bit) {
      const current = player === 1 ? localMask : remoteMask;
      const next = isDown ? current | bit : current & ~bit;
      setMask(player, next);
    }

    dispatchKeyboardInput(key, isDown);
  }

  function keyboardCodeFor(key) {
    if (key === " ") return "Space";
    if (key.length === 1 && /[a-z]/i.test(key))
      return `Key${key.toUpperCase()}`;
    if (key.length === 1 && /[0-9]/.test(key)) return `Digit${key}`;
    return key;
  }

  function keyboardKeyCodeFor(key) {
    const named = {
      Backspace: 8,
      Tab: 9,
      Enter: 13,
      Shift: 16,
      Control: 17,
      Alt: 18,
      CapsLock: 20,
      Escape: 27,
      " ": 32,
      PageUp: 33,
      PageDown: 34,
      End: 35,
      Home: 36,
      ArrowLeft: 37,
      ArrowUp: 38,
      ArrowRight: 39,
      ArrowDown: 40,
      Delete: 46,
    };

    if (named[key]) return named[key];
    if (/^F([1-9]|1[0-2])$/.test(key)) return 111 + Number(key.slice(1));
    return key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
  }

  function dispatchKeyboardInput(key, isDown) {
    const target = window.EJS_emulator?.elements?.parent || gameContainer;
    const keyCode = keyboardKeyCodeFor(key);
    const event = new KeyboardEvent(isDown ? "keydown" : "keyup", {
      key,
      code: keyboardCodeFor(key),
      bubbles: true,
      cancelable: true,
    });

    Object.defineProperties(event, {
      keyCode: { get: () => keyCode },
      which: { get: () => keyCode },
    });
    target.dispatchEvent(event);
  }

  function emulatorPointerTarget() {
    return (
      gameContainer.querySelector("canvas") ||
      window.EJS_emulator?.elements?.game ||
      window.EJS_emulator?.elements?.parent ||
      gameContainer
    );
  }

  function dispatchMouseMove(dx, dy) {
    const movementX = Math.max(-80, Math.min(80, Number(dx) || 0));
    const movementY = Math.max(-80, Math.min(80, Number(dy) || 0));
    if (!movementX && !movementY) return;

    const target = emulatorPointerTarget();
    const event = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: target.clientWidth / 2,
      clientY: target.clientHeight / 2,
    });
    Object.defineProperties(event, {
      movementX: { get: () => movementX },
      movementY: { get: () => movementY },
    });
    target.dispatchEvent(event);
  }

  function dispatchMouseButton(button, action) {
    const target = emulatorPointerTarget();
    const browserButton = Number(button) === 3 ? 2 : 0;
    const isDown = action === "down" || action === "mousedown";
    target.dispatchEvent(
      new MouseEvent(isDown ? "mousedown" : "mouseup", {
        bubbles: true,
        cancelable: true,
        view: window,
        button: browserButton,
        buttons: isDown ? (browserButton === 2 ? 2 : 1) : 0,
        clientX: target.clientWidth / 2,
        clientY: target.clientHeight / 2,
      }),
    );
  }

  function clearGameContainer() {
    try {
      window.EJS_emulator?.gameManager?.clearEJSResetTimer?.();
      window.EJS_emulator?.gamepad?.terminate?.();
    } catch {}

    gameContainer.innerHTML = "";
    window.EJS_emulator = null;
    lastSimulatedMasks = [0, 0];
    if (loaderScript) {
      loaderScript.remove();
      loaderScript = null;
    }
    if (typeof gameUrl === "string" && gameUrl.startsWith("blob:")) {
      URL.revokeObjectURL(gameUrl);
    }
    gameUrl = null;
  }

  function configureEmulator(fileName, romUrl) {
    const customTosName = customTos?.fileName?.toLowerCase() || "";
    const needsSte =
      customTos?.bytes?.length === 262144 || /tos\s*2[._-]?0[5-6]/.test(customTosName);

    window.EJS_DEBUG_XX = true;
    window.EJS_player = "#game";
    window.EJS_core = "atarist";
    // Keep this URL free of a query string: EmulatorJS uses the final path
    // segment as the firmware filename, and Hatari requires exactly /tos.img.
    window.EJS_biosUrl = customTos
      ? new File([customTos.bytes], "tos.img", {
          type: "application/octet-stream",
        })
      : "/atarist/tos.img";
    window.EJS_gameName = fileName;
    window.EJS_gameUrl = romUrl;
    window.EJS_pathtodata = "/emulatorjs/data/";
    window.EJS_paths = {
      "emulator.js": "/emulatorjs/data/src/emulator.js",
      "emulator.css": "/emulatorjs/data/emulator.css",
      "cache.js": "/emulatorjs/data/src/cache.js",
      "compression.js": "/emulatorjs/data/src/compression.js",
      "consts.js": "/emulatorjs/data/src/consts.js",
      "GameManager.js": "/emulatorjs/data/src/GameManager.js",
      "gamepad.js": "/emulatorjs/data/src/gamepad.js",
      "license.js": "/emulatorjs/data/src/license.js",
      "netplay.js": "/emulatorjs/data/src/netplay.js",
      "setup.js": "/emulatorjs/data/src/setup.js",
      "shaders.js": "/emulatorjs/data/src/shaders.js",
      "storage.js": "/emulatorjs/data/src/storage.js",
      "utils.js": "/emulatorjs/data/src/utils.js",
      "nipplejs.js": "/emulatorjs/data/src/vendor/nipplejs.js",
      "socket.io.min.js": "/emulatorjs/data/src/vendor/socket.io.min.js",
      "hatari-wasm.data":
        "/emulatorjs/data/cores/hatari-wasm.data?v=atarist-2026-06-21-4",
      "hatari-legacy-wasm.data":
        "/emulatorjs/data/cores/hatari-legacy-wasm.data?v=atarist-2026-06-21-4",
    };
    window.EJS_startOnLoaded = true;
    window.EJS_threads = false;
    window.EJS_forceLegacyCores = false;
    window.EJS_disableAutoLang = false;
    window.EJS_disableLocalStorage = true;
    window.EJS_cacheConfig = {
      enabled: false,
      cacheMaxSizeMB: 50,
      cacheMaxAgeMins: 60,
    };
    window.EJS_volume = 1;
    window.EJS_backgroundColor = "#000";
    window.EJS_color = "#2f8f76";
    window.EJS_alignStartButton = "center";
    window.EJS_defaultControls = {
      0: {
        0: { value: "x", value2: "BUTTON_1" },
        1: { value: "z", value2: "BUTTON_2" },
        3: { value: "enter", value2: "START" },
        4: { value: "up arrow", value2: "DPAD_UP" },
        5: { value: "down arrow", value2: "DPAD_DOWN" },
        6: { value: "left arrow", value2: "DPAD_LEFT" },
        7: { value: "right arrow", value2: "DPAD_RIGHT" },
        8: { value: "c", value2: "SELECT" },
      },
      1: {
        0: { value: "f", value2: "BUTTON_1" },
        1: { value: "g", value2: "BUTTON_2" },
        3: { value: "enter", value2: "START" },
        4: { value: "q", value2: "DPAD_UP" },
        5: { value: "a", value2: "DPAD_DOWN" },
        6: { value: "o", value2: "DPAD_LEFT" },
        7: { value: "p", value2: "DPAD_RIGHT" },
      },
    };
    window.EJS_defaultOptions = {
      keyboardInput: "enabled",
      altKeyboardInput: "enabled",
      hatari_machinetype: needsSte ? "ste" : "st",
      hatari_ramsize: "1",
      hatari_fastboot: "true",
      hatari_start_in_mouse_mode: "false",
      hatari_twojoy: "true",
      hatari_nokeys: "false",
      hatari_fastfdc: "false",
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
      // Match the capture canvas before RetroArch creates its WebGL context.
      // The browser default (300x150) causes a lossy scale followed by a
      // second scale in mirrorEmulatorCanvas().
      window.EJS_emulator.canvas.width = screen.width;
      window.EJS_emulator.canvas.height = screen.height;
      console.log("Old Style Gaming Atari ST: EmulatorJS ready");
    };
    window.EJS_onGameStart = () => {
      console.log("Old Style Gaming Atari ST: game started");
      statusText = "";
      window.EJS_emulator?.gameManager?.setKeyboardEnabled?.(true);
      window.EJS_emulator?.gameManager?.setControllerPortDevice?.(0, 1);
      window.EJS_emulator?.gameManager?.setControllerPortDevice?.(1, 1);
      lastSimulatedMasks = [0, 0];
      setMask(1, localMask);
      setMask(2, soloMode ? 0 : remoteMask);
      setWarp(warpEnabled);
      postMediaStatus(
        currentMedia.length > 1
          ? `${currentMedia.length} Atari ST media files mounted`
          : "",
      );
      window.EJS_emulator?.elements?.parent?.focus?.();
    };
    window.EJS_onExit = () => {
      drawStatus("Atari ST stopped", fileName);
    };
  }

  async function loadCurrentRom() {
    if (!currentMedia.length) {
      drawStatus("Atari ST ready", "Load a Atari ST ROM from the room");
      return;
    }

    ensureAudio()
      ?.resume?.()
      .catch(() => {});
    drawStatus("Checking Atari ST runtime", currentMedia[0].fileName);

    try {
      await preflightEmulatorJs();
    } catch (error) {
      drawStatus("Atari ST runtime missing", error.message);
      return;
    }

    clearGameContainer();
    const gameName =
      currentMedia.length > 1
        ? "old-style-atarist-media.zip"
        : currentMedia[0].fileName;
    const gameBlob =
      currentMedia.length > 1
        ? createMediaBundle(currentMedia)
        : new Blob([currentMedia[0].bytes], {
            type: "application/octet-stream",
          });
    gameUrl = new File([gameBlob], gameName, {
      type: "application/octet-stream",
    });
    configureEmulator(gameName, gameUrl);
    drawStatus(
      "Loading Atari ST",
      currentMedia.length > 1
        ? `${currentMedia.length} media files`
        : currentMedia[0].fileName,
    );

    loaderScript = document.createElement("script");
    loaderScript.src = `/emulatorjs/data/loader.js?v=${Date.now()}`;
    loaderScript.async = true;
    loaderScript.onerror = () =>
      drawStatus("Atari ST failed to load", "Could not load EmulatorJS");
    document.body.appendChild(loaderScript);
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function createMediaBundle(media) {
    const encoder = new TextEncoder();
    const usedNames = new Set();
    const entries = media.map((item, index) => {
      let name =
        item.fileName.replace(/[\\/:*?"<>|]/g, "_") || `disk-${index + 1}.st`;
      while (usedNames.has(name.toLowerCase())) name = `${index + 1}-${name}`;
      usedNames.add(name.toLowerCase());
      return { name, bytes: item.bytes };
    });
    entries.push({
      name: "old-style-atarist.m3u",
      bytes: encoder.encode(entries.map((entry) => entry.name).join("\n")),
    });

    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const write16 = (view, position, value) =>
      view.setUint16(position, value, true);
    const write32 = (view, position, value) =>
      view.setUint32(position, value, true);

    entries.forEach((entry) => {
      const name = encoder.encode(entry.name);
      const checksum = crc32(entry.bytes);
      const local = new Uint8Array(30 + name.length);
      const localView = new DataView(local.buffer);
      write32(localView, 0, 0x04034b50);
      write16(localView, 4, 20);
      write16(localView, 6, 0x0800);
      write32(localView, 14, checksum);
      write32(localView, 18, entry.bytes.length);
      write32(localView, 22, entry.bytes.length);
      write16(localView, 26, name.length);
      local.set(name, 30);
      localParts.push(local, entry.bytes);

      const central = new Uint8Array(46 + name.length);
      const centralView = new DataView(central.buffer);
      write32(centralView, 0, 0x02014b50);
      write16(centralView, 4, 20);
      write16(centralView, 6, 20);
      write16(centralView, 8, 0x0800);
      write32(centralView, 16, checksum);
      write32(centralView, 20, entry.bytes.length);
      write32(centralView, 24, entry.bytes.length);
      write16(centralView, 28, name.length);
      write32(centralView, 42, offset);
      central.set(name, 46);
      centralParts.push(central);
      offset += local.length + entry.bytes.length;
    });

    const centralSize = centralParts.reduce(
      (sum, part) => sum + part.length,
      0,
    );
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    write32(endView, 0, 0x06054b50);
    write16(endView, 8, entries.length);
    write16(endView, 10, entries.length);
    write32(endView, 12, centralSize);
    write32(endView, 16, offset);
    return new Blob([...localParts, ...centralParts, end], {
      type: "application/zip",
    });
  }

  async function preflightEmulatorJs() {
    const required = [
      "/emulatorjs/data/loader.js",
      "/emulatorjs/data/src/emulator.js",
      "/emulatorjs/data/src/compression.js",
      "/emulatorjs/data/compression/extractzip.js",
      "/emulatorjs/data/cores/hatari-wasm.data",
      "/emulatorjs/data/cores/hatari-legacy-wasm.data",
      "/atarist/tos.img",
    ];

    for (const path of required) {
      const response = await fetch(`${path}?v=${Date.now()}`, {
        cache: "no-store",
      });
      const contentType = response.headers.get("content-type") || "";

      if (!response.ok || contentType.includes("text/html")) {
        throw new Error(`${path} returned ${response.status || "HTML"}`);
      }
    }
  }

  window.addEventListener("error", (event) => {
    const where = event.filename
      ? `${event.filename.split("/").slice(-3).join("/")} ${event.lineno || ""}`.trim()
      : "";
    const message = [event.message || "Check browser console", where]
      .filter(Boolean)
      .join(" - ");
    console.error(
      "Old Style Gaming Atari ST error:",
      event.error || event.message,
      event.filename,
    );
    drawStatus("Atari ST error", message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("Old Style Gaming Atari ST promise error:", event.reason);
    drawStatus(
      "Atari ST error",
      event.reason?.message || "Check browser console",
    );
  });

  function mirrorEmulatorCanvas() {
    const gameCanvas = gameContainer.querySelector("canvas");

    if (gameCanvas && gameCanvas.width && gameCanvas.height) {
      context.fillStyle = "#000";
      context.fillRect(0, 0, screen.width, screen.height);

      const scale = Math.min(
        screen.width / gameCanvas.width,
        screen.height / gameCanvas.height,
      );
      const width = gameCanvas.width * scale;
      const height = gameCanvas.height * scale;
      const x = (screen.width - width) / 2;
      const y = (screen.height - height) / 2;

      context.imageSmoothingEnabled = false;
      context.drawImage(gameCanvas, x, y, width, height);
    } else if (statusText) {
      // Keep the last status frame visible until the core creates its own canvas.
    }

    requestAnimationFrame(mirrorEmulatorCanvas);
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;

    const message = event.data || {};
    if (message.type === "atarist_start") {
      soloMode = Boolean(message.soloMode);
      window.getAtariStAudioStream();
      return;
    }

    if (message.type === "atarist_autoload") {
      currentMedia = (message.media?.length ? message.media : [message]).map(
        (item) => ({
          fileName: item.fileName || "game.st",
          bytes: new Uint8Array(item.bytes || []),
        }),
      );
      loadCurrentRom();
      return;
    }

    if (message.type === "atarist_tos") {
      customTos = {
        fileName: message.fileName || "tos.img",
        bytes: new Uint8Array(message.bytes || []),
      };
      drawStatus("Atari TOS ready", customTos.fileName);
      return;
    }

    if (message.type === "atarist_next_media") {
      nextMedia();
      return;
    }

    if (message.type === "atarist_swap_joystick_ports") {
      soloMode = Boolean(message.soloMode);
      swapJoystickPorts();
      return;
    }

    if (message.type === "atarist_set_warp") {
      setWarp(message.enabled);
      return;
    }

    if (message.type === "atarist_reset") {
      window.EJS_emulator?.gameManager?.restart?.();
      return;
    }

    if (message.type === "amiga_mouse_move") {
      dispatchMouseMove(message.movementX, message.movementY);
      return;
    }

    if (message.type === "amiga_mouse_button") {
      dispatchMouseButton(message.button, message.action);
      return;
    }

    if (message.type === "amstrad_audio_unlock") {
      window.getAtariStAudioStream();
      return;
    }

    if (message.type === "amstrad_remote_joystick") {
      setMask(message.player || 1, Number(message.mask) || 0);
      return;
    }

    if (
      message.type === "amstrad_remote_input" ||
      message.type === "amstrad_remote_control"
    ) {
      handleKeyInput(message.player || 1, message.key, message.action);
    }
  });

  screen.addEventListener("pointerdown", () => {
    window.getAtariStAudioStream();
    window.focus();
  });

  drawStatus("Atari ST ready", "Load an Atari ST disk from the room");
  mirrorEmulatorCanvas();
})();
