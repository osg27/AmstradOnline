(() => {
  // src/features/retroachievements/memory.js
  function readMegaDriveMemory(core, address, length) {
    if (!core || !Number.isInteger(address) || !Number.isInteger(length) || address < 0 || length < 1 || address + length > 131072) return null;
    const ram = core._ra_get_work_ram?.() || 0;
    const save = core._ra_get_save_ram?.() || 0;
    if (!ram) return null;
    const result = new Uint8Array(length);
    for (let index = 0; index < length; index++) {
      const offset = address + index;
      if (offset < 65536) result[index] = core.HEAPU8[ram + offset];
      else if (save) result[index] = core.HEAPU8[save + offset - 65536];
      else return index ? result.subarray(0, index) : null;
    }
    return result;
  }
  function readMasterSystemMemory(core, address, length) {
    if (!core || !Number.isInteger(address) || !Number.isInteger(length) || address < 0 || length < 1 || address + length > 40960) return null;
    const ram = core._ra_get_work_ram?.() || 0;
    const save = core._ra_get_save_ram?.() || 0;
    if (!ram) return null;
    const result = new Uint8Array(length);
    for (let index = 0; index < length; index++) {
      const offset = address + index;
      if (offset < 8192) result[index] = core.HEAPU8[ram + offset];
      else if (save) result[index] = core.HEAPU8[save + offset - 8192];
      else return index ? result.subarray(0, index) : null;
    }
    return result;
  }
  function readCpcMemory(cpc, address, length) {
    const ram = cpc?.pv?.aM;
    const size = cpc?.oU?.p ? 589824 : [2, 4].includes(cpc?.qG) ? 131072 : 65536;
    if (!ram || ram.length < size || !Number.isInteger(address) || !Number.isInteger(length) || address < 0 || length < 1 || address >= size) return null;
    const available = Math.min(length, size - address);
    return Uint8Array.from(ram.slice(address, address + available));
  }

  // src/features/retroachievements/runtime.js
  function createRetroAchievements({ getCore, system = "megadrive" }) {
    if (!["megadrive", "mastersystem", "cpc"].includes(system)) throw new Error("Unsupported achievement system");
    const consoleId = { megadrive: 1, mastersystem: 11, cpc: 37 }[system];
    const readMemory = { megadrive: readMegaDriveMemory, mastersystem: readMasterSystemMemory, cpc: readCpcMemory }[system];
    let client;
    let loading;
    let enabled = false;
    let loggedIn = false;
    let rom;
    let running = false;
    let sequence = 0;
    let generation = 0;
    const pending = /* @__PURE__ */ new Map();
    const notify = (event) => window.parent.postMessage({ type: "ra_status", event }, location.origin);
    function reply(callback, userdata, status, body) {
      const bytes = new TextEncoder().encode(body || "{}");
      const pointer = client._malloc(bytes.length + 1);
      client.HEAPU8.set(bytes, pointer);
      client.HEAPU8[pointer + bytes.length] = 0;
      try {
        client._ra_reply(callback, userdata, status, pointer, bytes.length);
      } finally {
        client._free(pointer);
      }
    }
    async function ensureClient() {
      if (!loading) loading = window.RACreateClient({
        locateFile: (file) => `/retroachievements/${file}?v=2026-10-30-4`,
        readMemory: (address, length) => readMemory(getCore(), address, length),
        serverCall: (url, postData, callback, userdata) => {
          if (!enabled) {
            reply(callback, userdata, -1, "{}");
            return;
          }
          const id = ++sequence;
          const timer = setTimeout(() => {
            if (!pending.has(id)) return;
            pending.delete(id);
            reply(callback, userdata, 503, "{}");
          }, 2e4);
          pending.set(id, { callback, userdata, timer });
          window.parent.postMessage({ type: "ra_request", id, url, postData }, location.origin);
        },
        onEvent: (event) => {
          if (event.kind === "login") {
            loggedIn = enabled && event.result === 0;
            if (loggedIn) loadGame();
          }
          if (enabled) notify(event);
          if (enabled && ["game", "unlock"].includes(event.kind)) queueMicrotask(() => client?._ra_snapshot());
        },
        onSnapshot: (snapshot) => {
          if (enabled && loggedIn) window.parent.postMessage({ type: "ra_achievements", snapshot }, location.origin);
        },
        print: () => {
        },
        printErr: () => {
        }
      }).then((module) => {
        client = module;
        client._ra_init();
        return client;
      }).catch((error) => {
        loading = null;
        throw error;
      });
      return loading;
    }
    function loadGame() {
      if (!enabled || !loggedIn || !running || !rom || !client) return;
      if (!(system === "cpc" ? getCore()?.pv?.aM : getCore()?._ra_get_work_ram)) {
        notify({ kind: "error", message: "The game is detected, but this emulator copy cannot read achievement memory. Refresh the page to load the latest emulator." });
        return;
      }
      const pointer = client._malloc(rom.length);
      client.HEAPU8.set(rom, pointer);
      try {
        if (!client._ra_load_system(pointer, rom.length, consoleId)) notify({ kind: "error", message: "This game file could not be identified for achievements." });
      } finally {
        client._free(pointer);
      }
    }
    function logout() {
      generation += 1;
      loggedIn = false;
      client?._ra_unload();
      client?._ra_logout();
      for (const [id, request] of [...pending]) {
        clearTimeout(request.timer);
        pending.delete(id);
        reply(request.callback, request.userdata, -1, "{}");
      }
      notify({ kind: "logout" });
    }
    window.addEventListener("message", async (event) => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      const message = event.data || {};
      if (message.type === "ra_configure") {
        enabled = Boolean(message.enabled);
        if (!enabled) logout();
      } else if (message.type === "ra_probe") {
        window.parent.postMessage({ type: "ra_ready" }, location.origin);
      } else if (message.type === "ra_response") {
        const request = pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(message.id);
        reply(request.callback, request.userdata, enabled ? message.status : -1, message.body);
      } else if (message.type === "ra_logout") {
        logout();
      } else if (["ra_login", "ra_login_token"].includes(message.type) && enabled) {
        const attempt = generation;
        try {
          await ensureClient();
          if (!enabled || attempt !== generation) return;
          client.cwrap(message.type, null, ["string", "string"])(message.username, message.type === "ra_login_token" ? message.token : message.password);
        } catch {
          notify({ kind: "error", message: "The achievements runtime could not start. Try reloading the room." });
        }
      }
    });
    setInterval(() => {
      if (enabled && loggedIn && client) client._ra_idle();
    }, 250);
    setInterval(() => {
      if (enabled && loggedIn && running && client) client._ra_snapshot();
    }, 3e3);
    window.parent.postMessage({ type: "ra_ready" }, location.origin);
    return {
      romLoaded(bytes) {
        client?._ra_unload();
        rom = new Uint8Array(bytes);
        running = false;
        if (enabled && loggedIn) notify({ kind: "media", message: "Loading game and matching its achievement set..." });
      },
      started() {
        running = true;
        if (loggedIn) {
          client?._ra_reset();
          loadGame();
        }
      },
      reset() {
        client?._ra_reset();
      },
      stop(message) {
        client?._ra_unload();
        rom = null;
        running = false;
        if (enabled && loggedIn) notify({ kind: "media", message });
      },
      frame() {
        if (!enabled || !loggedIn || !running || !client) return;
        try {
          client._ra_frame();
        } catch {
          logout();
          notify({ kind: "error", message: "Achievement tracking stopped. The game can continue; sign in again to retry." });
        }
      }
    };
  }
  window.OSGRetroAchievements = { create: createRetroAchievements };
})();
