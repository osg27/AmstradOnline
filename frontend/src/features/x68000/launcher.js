import { unzipSync } from 'fflate';
import { LibretroHost } from './vendor/webx68k/libretro-host';
import { prepareX68000Media, x68000JoyBits, x68000KeyboardJoystickBit } from './media';

const canvas = document.getElementById('pcengine-screen');
const context = canvas.getContext('2d', { alpha: false });
let firmware;
let currentGame;
let host;
let generation = 0;
let animation;
let paused = false;
let audio;
let destination;
let gain;
let nextAudioTime = 0;
const audioSources = new Set();
const keyboardMasks = [0, 0];
const controllerMasks = [0, 0];
const pressedKeys = new Set();
const state = { engine: 'WebX68k', frameCount: 0, running: false, paused: false, error: '' };
window.x68000Runtime = state;

function trace(stage, detail = '') {
  const entry = { stage, detail: String(detail), timestamp: new Date().toISOString() };
  console.log(`[WebX68k] ${stage}`, detail);
  try { localStorage.setItem('osg-px68k-last-trace', JSON.stringify(entry)); } catch { /* diagnostics are optional */ }
  window.parent.postMessage({ type: 'x68000_trace', ...entry }, location.origin);
}

function status(title, detail = '') {
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textAlign = 'center';
  context.fillStyle = '#fff';
  context.font = '24px system-ui';
  context.fillText(title, canvas.width / 2, canvas.height / 2 - 15);
  context.font = '16px system-ui';
  context.fillText(detail, canvas.width / 2, canvas.height / 2 + 20);
}

function ensureAudio() {
  if (!audio) {
    audio = new AudioContext({ sampleRate: 44100 });
    destination = audio.createMediaStreamDestination();
    gain = audio.createGain();
    gain.connect(audio.destination);
    gain.connect(destination);
  }
  return audio;
}

window.getX68000AudioStream = window.getPcEngineAudioStream = () => {
  ensureAudio().resume().catch(() => {});
  return destination.stream;
};

function stopAudio() {
  for (const source of audioSources) { try { source.stop(); } catch { /* already ended */ } }
  audioSources.clear();
  nextAudioTime = 0;
}

function pushAudio(samples) {
  if (!audio || audio.state !== 'running' || paused || nextAudioTime > audio.currentTime + 0.25) return;
  const frames = samples.length / 2;
  const buffer = audio.createBuffer(2, frames, host?.avInfo?.sampleRate || 44100);
  for (let channel = 0; channel < 2; channel++) {
    const output = buffer.getChannelData(channel);
    for (let i = 0; i < frames; i++) output[i] = samples[i * 2 + channel];
  }
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);
  source.onended = () => { audioSources.delete(source); source.disconnect(); };
  audioSources.add(source);
  nextAudioTime = Math.max(audio.currentTime + 0.02, nextAudioTime);
  source.start(nextAudioTime);
  nextAudioTime += buffer.duration;
}

function stop() {
  cancelAnimationFrame(animation);
  stopAudio();
  state.running = false;
  if (host) {
    host.unloadGame();
    host = null;
  }
}

function fail(error) {
  stop();
  state.error = error.message || String(error);
  trace('runtime-error', state.error);
  status('X68000 could not start', state.error);
}

async function start() {
  if (!currentGame) return;
  if (!firmware) { status('X68000 firmware required', 'Load iplrom.dat and cgrom.dat from the room controls'); return; }
  const token = ++generation;
  stop();
  state.error = '';
  status('Loading Sharp X68000', currentGame.fileName);
  let nextHost;
  try {
    const media = prepareX68000Media(currentGame);
    nextHost = new LibretroHost(canvas, pushAudio);
    nextHost.setCoreOption('px68k_cpuspeed', '16Mhz');
    nextHost.setCoreOption('px68k_ramsize', '2MB');
    nextHost.setCoreOption('px68k_no_wait_mode', 'enabled');
    nextHost.setCoreOption('px68k_save_fdd_path', 'disabled');
    nextHost.setCoreOption('px68k_save_hdd_path', 'disabled');
    await nextHost.init(firmware.ipl, firmware.cg, undefined, `${location.origin}/x68000/webx68k/`);
    if (token !== generation) return;
    for (const file of media.files) nextHost.writeDiskImage(file.fileName, file.bytes);
    if (!nextHost.loadGame(`/game/${media.primary}`)) throw new Error('The X68000 core rejected this game image.');
    host = nextHost;
    state.running = true;
    state.frameCount = 0;
    trace('game-loaded', `${media.primary}; ${media.files.length} media files`);
    let nextFrame = performance.now();
    function tick(now) {
      if (token !== generation) return;
      try {
        if (paused) nextFrame = now;
        else {
          const deadline = performance.now() + 8;
          const frameMs = 1000 / (host.avInfo?.fps || 59.94);
          let count = 0;
          if (now - nextFrame > 100) nextFrame = now;
          while (now >= nextFrame && count++ < 4) {
            host.runFrame();
            state.frameCount++;
            nextFrame += frameMs;
            if (performance.now() >= deadline) break;
          }
          if (state.frameCount >= 60 && !state.firstFramesVerified) {
            state.firstFramesVerified = true;
            trace('emulation-running', `${state.frameCount} frames completed`);
          }
        }
        animation = requestAnimationFrame(tick);
      } catch (error) { fail(error); }
    }
    state.firstFramesVerified = false;
    animation = requestAnimationFrame(tick);
  } catch (error) { if (token === generation) fail(error); }
}

const keyCodes = { Enter: 13, Escape: 27, Backspace: 8, Tab: 9, ' ': 32, ArrowUp: 273, ArrowDown: 274, ArrowRight: 275, ArrowLeft: 276, Insert: 277, Home: 278, End: 279, PageUp: 280, PageDown: 281, Delete: 127, CapsLock: 301, Shift: 304, Control: 306, Alt: 308 };
function updateJoystick(port) {
  host?.setJoyState(port, x68000JoyBits(keyboardMasks[port] | controllerMasks[port]));
}
function clearInputs() {
  for (const key of pressedKeys) host?.setKey(key, false);
  pressedKeys.clear();
  keyboardMasks.fill(0);
  controllerMasks.fill(0);
  updateJoystick(0);
  updateJoystick(1);
  host?.clearMouseState();
}
function keyInput(key, down, player = 1) {
  const code = keyCodes[key] ?? (/^F(?:[1-9]|1[0-2])$/.test(key) ? 281 + Number(key.slice(1)) : key?.length === 1 ? key.toLowerCase().charCodeAt(0) : null);
  if (code != null) {
    if (down) pressedKeys.add(code); else pressedKeys.delete(code);
    host?.setKey(code, down);
  }
  const bit = x68000KeyboardJoystickBit(key);
  const port = player === 2 ? 1 : 0;
  keyboardMasks[port] = down ? keyboardMasks[port] | bit : keyboardMasks[port] & ~bit;
  updateJoystick(port);
}

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || (event.source !== window.parent && event.source !== window)) return;
  const message = event.data || {};
  try {
    if (message.type === 'x68000_firmware') {
      // RoomPage normalizes names; ZIP fallback also accepts older saved payloads.
      const files = message.files?.length ? message.files : Object.entries(unzipSync(new Uint8Array(message.bytes))).map(([fileName, bytes]) => ({ fileName, bytes }));
      const find = (name) => files.find((file) => file.fileName.replaceAll('\\', '/').split('/').pop().toLowerCase() === name)?.bytes;
      const ipl = new Uint8Array(find('iplrom.dat') || []);
      const cg = new Uint8Array(find('cgrom.dat') || []);
      if (![131072, 262144].includes(ipl.length) || cg.length !== 786432) throw new Error('X68000 needs a 128/256 KB IPL ROM and 768 KB CG ROM.');
      if (firmware && firmware.ipl.length === ipl.length && firmware.ipl.every((v, i) => v === ipl[i]) && firmware.cg.every((v, i) => v === cg[i])) return;
      firmware = { ipl, cg };
      trace('firmware-ready');
      start();
    } else if (message.type === 'x68000_autoload') {
      currentGame = message;
      start();
    } else if (message.type === 'x68000_start' || message.type === 'amstrad_audio_unlock') {
      window.getX68000AudioStream();
    } else if (message.type === 'x68000_reset') {
      start();
    } else if (message.type === 'emulator_set_volume') {
      ensureAudio();
      gain.gain.value = Math.max(0, Math.min(1, Number(message.volume) || 0));
    } else if (message.type === 'emulator_set_paused') {
      paused = Boolean(message.paused);
      state.paused = paused;
      clearInputs();
      stopAudio();
    } else if (message.type === 'amstrad_remote_joystick') {
      const port = message.player === 2 ? 1 : 0;
      controllerMasks[port] = Number(message.mask) || 0;
      updateJoystick(port);
    } else if (message.type === 'amstrad_remote_input' || message.type === 'amstrad_remote_control') {
      keyInput(message.key, message.action === 'down', message.player);
    } else if (message.type === 'amiga_mouse_move') {
      host?.addMouseDelta(Number(message.movementX) || 0, Number(message.movementY) || 0);
    } else if (message.type === 'amiga_mouse_button') {
      host?.setMouseButton(message.button === 3 ? 'right' : 'left', message.action === 'down');
    }
  } catch (error) { fail(error); }
});
window.addEventListener('keydown', (event) => { keyInput(event.key, true); event.preventDefault(); });
window.addEventListener('keyup', (event) => { keyInput(event.key, false); event.preventDefault(); });
window.addEventListener('blur', clearInputs);
canvas.addEventListener('pointerdown', () => window.getX68000AudioStream());
status('Sharp X68000 ready', 'Load a game from the room');
trace('launcher-ready', 'WebX68k runtime');
