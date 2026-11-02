import { apiFetch } from '../../api/client';
import { readPreviewGamepad } from './mamePreviewControls';
import { MAME_PREVIEW_GAMES } from './mamePreviewGames';
import { inspectCps1Rom } from './cps1Rom';

const assets = '/experiments/mame-ra/';
const assetFile = name => `${assets}${name}?v=cps1-1`;
const scripts = new Map();
function loadScript(name) {
  if (!scripts.has(name)) scripts.set(name, new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = assetFile(name);
    script.onload = resolve;
    script.onerror = () => { scripts.delete(name); script.remove(); reject(new Error('Could not load the preview runtime.')); };
    document.head.append(script);
  }));
  return scripts.get(name);
}

export function readPacmanMemory(core, address, length) {
  if (!Number.isInteger(length) || length < 1 || length > 1024) return null;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const value = core._probe_ra_byte(address + i);
    if (value < 0) return null;
    bytes[i] = value;
  }
  return bytes;
}

export function createMamePreview({ canvas, status, snapshot, hit, controller = () => {}, submitted = () => {}, romInfo = () => {}, softcore = false, game = 'pacman' }) {
  const profile = MAME_PREVIEW_GAMES[game];
  if (!profile) throw new Error('Unsupported Arcade experiment.');
  let disposed = false, core, client, timer, audio, audioTime = 0, mask = 0, paused = false, tracking = false;
  let gameReady = !softcore;
  const abort = new AbortController();
  const post = (path, data) => apiFetch(`/auth/retroachievements/mame-preview/${profile.apiPath}${softcore ? 'softcore/' : ''}${path}`, {
    method: 'POST', body: JSON.stringify(data), signal: abort.signal,
  });
  const reply = (callback, userdata, code, data) => {
    if (disposed) return;
    const text = JSON.stringify(data), pointer = client._malloc(client.lengthBytesUTF8(text) + 1);
    try { client.stringToUTF8(text, pointer, client.lengthBytesUTF8(text) + 1); client._ra_reply(callback, userdata, code, pointer, client.lengthBytesUTF8(text)); }
    finally { client._free(pointer); }
  };
  const stop = () => {
    if (disposed) return;
    disposed = true; clearInterval(timer); abort.abort(); mask = 0;
    client?._ra_unload(); client?._ra_logout(); audio?.close().catch(() => {});
  };
  return {
    stop,
    input(bit, down) { mask = down ? mask | (1 << bit) : mask & ~(1 << bit); audio?.resume(); },
    release() { mask = 0; },
    pause(value) { paused = value; mask = 0; },
    reset() { core?._probe_reset(); client?._ra_reset(); mask = 0; },
    async start(file) {
      if (file.name.toLowerCase() !== profile.filename || file.size > profile.maxBytes) throw new Error(`Choose your complete MAME set named ${profile.filename} (up to ${profile.maxBytes / 1024 / 1024} MB).`);
      status(`Loading the isolated ${profile.title} test…`);
      // Create audio during the file-selection gesture. Browsers may require a control click to resume.
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (Audio) audio = new Audio();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const revision = game === 'sf2ce' ? await inspectCps1Rom(bytes, softcore) : null;
      if (disposed) return;
      romInfo(revision?.description || '');
      await Promise.all([loadScript(profile.coreFile), loadScript('rc-client.js')]);
      if (disposed) return;
      core = await window[profile.coreFactory]({ locateFile: assetFile, print() {}, printErr() {},
        onAudio(samples, rate) {
          if (disposed || paused || !audio || audio.state !== 'running') return;
          if (audioTime > audio.currentTime + 0.15) return;
          const buffer = audio.createBuffer(2, samples.length / 2, rate);
          for (let ch = 0; ch < 2; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < data.length; i++) data[i] = samples[i * 2 + ch] / 32768;
          }
          const source = audio.createBufferSource(); source.buffer = buffer; source.connect(audio.destination);
          audioTime = Math.max(audioTime, audio.currentTime + 0.015); source.start(audioTime); audioTime += buffer.duration;
        },
      });
      if (disposed) return;
      core.FS.mkdir('/roms'); core.FS.mkdir('/saves');
      core.FS.writeFile(`/roms/${revision?.legacy ? 'sf2ceold.zip' : profile.filename}`, bytes);
      if (disposed) return;
      if (!(revision?.legacy ? core._probe_load_legacy() : core._probe_load())) throw new Error(`MAME could not load ${profile.filename}. Check that the archive contains the required ROM files.`);
      let ticks = 0, controllerName;
      timer = setInterval(() => {
        if (disposed || paused || document.hidden) return;
        const pad = readPreviewGamepad(navigator.getGamepads?.(), profile.sixButtons);
        if (pad.name !== controllerName) { controllerName = pad.name; controller(pad.name); }
        const padMask = document.activeElement === canvas ? pad.mask : 0;
        if (padMask && audio?.state === 'suspended') audio.resume().catch(() => {});
        // No gameplay before a new softcore session has loaded its unlock history.
        core._probe_step(gameReady ? mask | padMask : 0);
        if (tracking) client._ra_frame();
        const width = core._probe_width(), height = core._probe_height();
        if (width && height) {
          if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
          const pixels = new Uint8ClampedArray(core.HEAPU8.buffer, core._probe_pixels(), width * height * 4);
          canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
        }
        if (++ticks % 60 === 0 && tracking) client._ra_snapshot();
      }, 1000 / core._probe_fps());
      status(`${profile.title} loaded. Connecting RetroAchievements…`);
      client = await window.OSGMameRA({ locateFile: assetFile,
        readMemory: (address, length) => readPacmanMemory(core, address, length),
        onSnapshot: value => { if (!disposed) snapshot(value); },
        onEvent(event) {
          if (disposed) return;
          if (event.kind === 'login') {
            if (event.result !== 0) { status('RetroAchievements sign-in failed. Reconnect in Profile.'); return; }
            if (!client[profile.loadFunction]()) status(`Could not identify ${profile.title}.`);
          } else if (event.kind === 'game') {
            tracking = event.result === 0 && event.id === profile.id;
            if (tracking && softcore) { core._probe_reset(); mask = 0; gameReady = true; }
            status(tracking ? `${event.title}: ${event.points} achievement${event.points === 1 ? '' : 's'} loaded. ${softcore ? 'Softcore submissions enabled. Game restarted for this new session.' : 'Local preview only — nothing is submitted.'}` : `${profile.title} achievements could not load.`);
            if (!tracking) client._ra_unload();
          } else if (event.kind === 'unlock') hit(event);
          else if (event.kind === 'pending') status('An unlock is waiting to sync. Keep this page open.');
          else if (event.kind === 'synced') status('Pending unlocks have synced to RetroAchievements.');
          else if (event.kind === 'error') {
            tracking = false;
            status('RetroAchievements reported an error. Tracking has stopped; reload to retry.');
          }
        },
        async serverCall(url, body, callback, userdata) {
          try {
            const response = await post('request', { post_data: body });
            const result = JSON.parse(response.body);
            const params = new URLSearchParams(body);
            if (!disposed && softcore && params.get('r') === 'awardachievement' && response.status === 200 && result.Success === true) {
              submitted(Number(params.get('a')));
            }
            reply(callback, userdata, response.status, result);
          }
          catch { reply(callback, userdata, 502, { Success: false, Error: 'Preview request failed. Reconnect in Profile or reload to retry.' }); }
        }, print() {}, printErr() {},
      });
      if (disposed) { client._ra_logout(); return; }
      if (!client._ra_pacman_softcore(softcore ? 1 : 0)) throw new Error('Could not start a fresh achievement session.');
      const connection = await post('session', {});
      if (disposed) return;
      client.cwrap('ra_login_token', null, ['string', 'string'])(connection.username, connection.token);
    },
  };
}
