import { apiFetch } from '../../api/client';
import { readPreviewGamepad } from './mamePreviewControls';

const assets = '/experiments/mame-ra/';
const scripts = new Map();
function loadScript(name) {
  if (!scripts.has(name)) scripts.set(name, new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = assets + name;
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

export function createMamePreview({ canvas, status, snapshot, hit, controller = () => {} }) {
  let disposed = false, core, client, timer, audio, audioTime = 0, mask = 0, paused = false, tracking = false;
  const abort = new AbortController();
  const post = (path, data) => apiFetch(`/auth/retroachievements/mame-preview/${path}`, {
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
      if (file.name.toLowerCase() !== 'pacman.zip' || file.size > 4 * 1024 * 1024) throw new Error('Choose your MAME Pac-Man set named pacman.zip (up to 4 MB).');
      status('Loading the isolated Pac-Man preview…');
      // Create audio during the file-selection gesture. Browsers may require a control click to resume.
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (Audio) audio = new Audio();
      await Promise.all([loadScript('mame-pacman.js'), loadScript('rc-client.js')]);
      if (disposed) return;
      core = await window.OSGMamePacman({ locateFile: name => assets + name, print() {}, printErr() {},
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
      core.FS.writeFile('/roms/pacman.zip', new Uint8Array(await file.arrayBuffer()));
      if (disposed) return;
      if (!core._probe_load()) throw new Error('MAME could not load this Pac-Man set. Check that the archive contains the required ROM files.');
      let ticks = 0, controllerName;
      timer = setInterval(() => {
        if (disposed || paused || document.hidden) return;
        const pad = readPreviewGamepad(navigator.getGamepads?.());
        if (pad.name !== controllerName) { controllerName = pad.name; controller(pad.name); }
        const padMask = document.activeElement === canvas ? pad.mask : 0;
        if (padMask && audio?.state === 'suspended') audio.resume().catch(() => {});
        core._probe_step(mask | padMask);
        if (tracking) client._ra_frame();
        const width = core._probe_width(), height = core._probe_height();
        if (width && height) {
          if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
          const pixels = new Uint8ClampedArray(core.HEAPU8.buffer, core._probe_pixels(), width * height * 4);
          canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
        }
        if (++ticks % 60 === 0 && tracking) client._ra_snapshot();
      }, 1000 / core._probe_fps());
      status('Pac-Man loaded. Connecting the read-only achievement preview…');
      client = await window.OSGMameRA({ locateFile: name => assets + name,
        readMemory: (address, length) => readPacmanMemory(core, address, length),
        onSnapshot: value => { if (!disposed) snapshot(value); },
        onEvent(event) {
          if (disposed) return;
          if (event.kind === 'login') {
            if (event.result !== 0) { status('RetroAchievements sign-in failed. Reconnect in Profile.'); return; }
            if (!client._ra_load_pacman()) status('Could not identify Pac-Man.');
          } else if (event.kind === 'game') {
            tracking = event.result === 0 && event.id === 12192;
            status(tracking ? `${event.title}: ${event.points} achievement${event.points === 1 ? '' : 's'} loaded. Local preview only — nothing is submitted.` : 'Pac-Man achievements could not load.');
            if (!tracking) client._ra_unload();
          } else if (event.kind === 'unlock') hit(event.title);
          else if (event.kind === 'error') {
            tracking = false;
            status('Achievement preview stopped after a connection error. Reload to retry.');
          }
        },
        async serverCall(url, body, callback, userdata) {
          try {
            const response = await post('request', { post_data: body });
            reply(callback, userdata, response.status, JSON.parse(response.body));
          }
          catch { reply(callback, userdata, 502, { Success: false, Error: 'Preview request failed. Reconnect in Profile or reload to retry.' }); }
        }, print() {}, printErr() {},
      });
      if (disposed) { client._ra_logout(); return; }
      const connection = await post('session', {});
      if (disposed) return;
      client.cwrap('ra_login_token', null, ['string', 'string'])(connection.username, connection.token);
    },
  };
}
