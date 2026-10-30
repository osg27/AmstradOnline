import { readMegaDriveMemory } from './memory';

export function createRetroAchievements({ getCore }) {
  let client;
  let loading;
  let enabled = false;
  let loggedIn = false;
  let rom;
  let running = false;
  let sequence = 0;
  let generation = 0;
  const pending = new Map();

  const notify = (event) => window.parent.postMessage({ type: 'ra_status', event }, location.origin);
  function reply(callback, userdata, status, body) {
    const bytes = new TextEncoder().encode(body || '{}');
    const pointer = client._malloc(bytes.length + 1);
    client.HEAPU8.set(bytes, pointer);
    client.HEAPU8[pointer + bytes.length] = 0;
    try { client._ra_reply(callback, userdata, status, pointer, bytes.length); }
    finally { client._free(pointer); }
  }

  async function ensureClient() {
    if (!loading) loading = window.RACreateClient({
      locateFile: (file) => `/retroachievements/${file}?v=2026-10-30-1`,
      readMemory: (address, length) => readMegaDriveMemory(getCore(), address, length),
      serverCall: (url, postData, callback, userdata) => {
        if (!enabled) { reply(callback, userdata, -1, '{}'); return; }
        const id = ++sequence;
        const timer = setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reply(callback, userdata, 503, '{}');
        }, 20000);
        pending.set(id, { callback, userdata, timer });
        window.parent.postMessage({ type: 'ra_request', id, url, postData }, location.origin);
      },
      onEvent: (event) => {
        if (event.kind === 'login') {
          loggedIn = enabled && event.result === 0;
          if (loggedIn) loadGame();
        }
        if (enabled) notify(event);
      },
      print: () => {},
      printErr: () => {},
    }).then((module) => {
      client = module;
      client._ra_init();
      return client;
    }).catch((error) => { loading = null; throw error; });
    return loading;
  }

  function loadGame() {
    if (!enabled || !loggedIn || !running || !rom || !client) return;
    const pointer = client._malloc(rom.length);
    client.HEAPU8.set(rom, pointer);
    try {
      if (!client._ra_load(pointer, rom.length)) notify({ kind: 'error', message: 'This ROM could not be identified for achievements.' });
    } finally { client._free(pointer); }
  }

  function logout() {
    generation += 1;
    loggedIn = false;
    client?._ra_unload();
    client?._ra_logout();
    for (const [id, request] of [...pending]) {
      clearTimeout(request.timer); pending.delete(id);
      reply(request.callback, request.userdata, -1, '{}');
    }
    notify({ kind: 'logout' });
  }

  window.addEventListener('message', async (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    const message = event.data || {};
    if (message.type === 'ra_configure') {
      enabled = Boolean(message.enabled);
      if (!enabled) logout();
    } else if (message.type === 'ra_probe') {
      window.parent.postMessage({ type: 'ra_ready' }, location.origin);
    } else if (message.type === 'ra_response') {
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      reply(request.callback, request.userdata, enabled ? message.status : -1, message.body);
    } else if (message.type === 'ra_logout') {
      logout();
    } else if (message.type === 'ra_login' && enabled) {
      const attempt = generation;
      try {
        await ensureClient();
        if (!enabled || attempt !== generation) return;
        client.cwrap('ra_login', null, ['string', 'string'])(message.username, message.password);
      } catch {
        notify({ kind: 'error', message: 'The achievements runtime could not start. Try reloading the room.' });
      }
    }
  });

  setInterval(() => { if (enabled && loggedIn && client) client._ra_idle(); }, 250);
  window.parent.postMessage({ type: 'ra_ready' }, location.origin);
  return {
    romLoaded(bytes) { client?._ra_unload(); rom = new Uint8Array(bytes); running = false; },
    started() { running = true; if (loggedIn) { client?._ra_reset(); loadGame(); } },
    reset() { client?._ra_reset(); },
    frame() {
      if (!enabled || !loggedIn || !client) return;
      try { client._ra_frame(); }
      catch { logout(); notify({ kind: 'error', message: 'Achievement tracking stopped. The game can continue; sign in again to retry.' }); }
    },
  };
}

window.OSGRetroAchievements = { create: createRetroAchievements };
