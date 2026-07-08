(function () {
  const CANVAS_WIDTH = 640;
  const CANVAS_HEIGHT = 480;
  const SOUND_FREQUENCY = 44100;
  const SAMPLING_PER_FPS = 736;
  const GAMEPAD_API_INDEX = 64;
  const GAMEPAD_API_STRIDE = 32;
  const NTSC_FPS = 60;
  const SOUND_DELAY_FRAME = 8;
  const isMasterSystem = new URLSearchParams(window.location.search).get('system') === 'mastersystem';
  const systemName = isMasterSystem ? 'Master System' : 'Mega Drive';

  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(CANVAS_WIDTH, CANVAS_HEIGHT);

  let gens = null;
  let wasmReady = false;
  let romReady = false;
  let pendingStart = false;
  let started = false;
  let looping = false;
  let romName = '';
  let vram = null;
  let input = null;
  let audioL = null;
  let audioR = null;
  let audioContext = null;
  let audioDestination = null;
  let audioMasterGain = null;
  let audioKeepAlive = null;
  let audioKeepAliveGain = null;
  let emulatorVolume = 1;
  let emulatorPaused = false;
  let soundShedTime = 0;
  let then = Date.now();
  let targetFps = NTSC_FPS;
  let interval = 1000 / targetFps;
  let fps = targetFps;
  let frame = targetFps;
  let fpsStartedAt = Date.now();
  let localMask = 0;
  let remoteMask = 0;
  const pressedKeys = new Set();
  const remotePressedKeys = new Set();

  const soundDelayTime = (SAMPLING_PER_FPS * SOUND_DELAY_FRAME) / SOUND_FREQUENCY;

  function drawStatus(title, subtitle) {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 12);
    if (subtitle) {
      ctx.fillStyle = '#b7c2d0';
      ctx.font = '18px Arial, sans-serif';
      ctx.fillText(subtitle, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 24);
    }
  }

  function ensureAudio() {
    if (audioContext) {
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }
      return;
    }

    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;

    audioContext = new AudioCtor({ sampleRate: SOUND_FREQUENCY });
    audioDestination = audioContext.createMediaStreamDestination();
    audioMasterGain = audioContext.createGain();
    audioMasterGain.gain.value = emulatorVolume;
    audioMasterGain.connect(audioContext.destination);
    audioMasterGain.connect(audioDestination);
    audioKeepAlive = audioContext.createOscillator();
    audioKeepAliveGain = audioContext.createGain();
    audioKeepAlive.frequency.value = 20;
    audioKeepAliveGain.gain.value = 0.00001;
    audioKeepAlive.connect(audioKeepAliveGain);
    audioKeepAliveGain.connect(audioMasterGain);
    audioKeepAlive.start();

    const silence = audioContext.createBuffer(2, SAMPLING_PER_FPS, SOUND_FREQUENCY);
    playAudioBuffer(silence);
  }

  function playAudioBuffer(audioBuffer) {
    if (!audioContext) return;

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    source.connect(audioMasterGain || audioContext.destination);

    const currentSoundTime = audioContext.currentTime;
    if (currentSoundTime < soundShedTime) {
      source.start(soundShedTime);
      soundShedTime += audioBuffer.duration;
    } else {
      source.start(currentSoundTime);
      soundShedTime = currentSoundTime + audioBuffer.duration + soundDelayTime;
    }
  }

  function getAxis(mask, negativeBit, positiveBit) {
    if (mask & negativeBit) return -1;
    if (mask & positiveBit) return 1;
    return 0;
  }

  function keyMask(keys) {
    let mask = 0;
    if (keys.has('ArrowUp')) mask |= 1;
    if (keys.has('ArrowDown')) mask |= 2;
    if (keys.has('ArrowLeft')) mask |= 4;
    if (keys.has('ArrowRight')) mask |= 8;
    if (keys.has('z') || keys.has('Z')) mask |= 16;
    if (keys.has('x') || keys.has('X')) mask |= 32;
    if (keys.has('Enter')) mask |= 64;
    if (keys.has('c') || keys.has('C')) mask |= 128;
    return mask;
  }

  function writePadInput(offset, mask) {
    input[offset + 6] = getAxis(mask, 4, 8);
    input[offset + 7] = getAxis(mask, 1, 2);
    input[offset + 8 + 2] = !isMasterSystem && mask & 16 ? 1 : 0; // A
    input[offset + 8 + 3] = mask & (isMasterSystem ? 16 : 32) ? 1 : 0; // B / Button 1
    input[offset + 8 + 1] = mask & (isMasterSystem ? 32 : 128) ? 1 : 0; // C / Button 2
    input[offset + 8 + 7] = mask & 64 ? 1 : 0; // Start
  }

  function updateInput() {
    if (!input) return;

    const playerOneMask = keyMask(pressedKeys) | localMask;
    const playerTwoMask = keyMask(remotePressedKeys) | remoteMask;
    input.fill(0);
    writePadInput(0, playerOneMask);
    writePadInput(GAMEPAD_API_STRIDE, playerTwoMask);
  }

  function bindViews() {
    vram = new Uint8ClampedArray(
      gens.HEAPU8.buffer,
      gens._get_frame_buffer_ref(),
      CANVAS_WIDTH * CANVAS_HEIGHT * 4,
    );
    audioL = new Float32Array(gens.HEAPF32.buffer, gens._get_web_audio_l_ref(), SAMPLING_PER_FPS);
    audioR = new Float32Array(gens.HEAPF32.buffer, gens._get_web_audio_r_ref(), SAMPLING_PER_FPS);
    input = new Float32Array(gens.HEAPF32.buffer, gens._get_input_buffer_ref(), GAMEPAD_API_INDEX);
  }

  function startEmulator() {
    pendingStart = true;
    ensureAudio();

    if (!wasmReady) {
      drawStatus(`Starting ${systemName}`, 'Checking genplus runtime...');
      return;
    }

    if (!romReady) {
      drawStatus(`${systemName} ready`, 'Load a ROM file');
      return;
    }

    try {
      console.info(`${systemName}: starting ${romName}`);
      gens._start();
      targetFps = gens._is_pal() ? 50 : NTSC_FPS;
      interval = 1000 / targetFps;
      bindViews();
      started = true;
      emulatorPaused = false;
      pendingStart = false;
      then = Date.now();
      console.info(`${systemName}: emulator started at ${targetFps} FPS`);
    } catch (error) {
      started = false;
      pendingStart = false;
      drawStatus(`${systemName} failed`, error.message || String(error));
      console.error(`${systemName}: failed to start`, error);
      return;
    }

    if (!looping) {
      looping = true;
      requestAnimationFrame(loop);
    }
  }

  function resetEmulator() {
    localMask = 0;
    remoteMask = 0;
    pressedKeys.clear();
    remotePressedKeys.clear();

    if (!wasmReady || !romReady) {
      drawStatus(`${systemName} ready`, romName || 'Load a ROM file');
      return;
    }

    gens._start();
    targetFps = gens._is_pal() ? 50 : NTSC_FPS;
    interval = 1000 / targetFps;
    bindViews();
    started = true;
    emulatorPaused = false;
    pendingStart = false;
    then = Date.now();

    if (!looping) {
      looping = true;
      requestAnimationFrame(loop);
    }
  }

  function loadRom(fileName, bytes) {
    romName = fileName || 'game.bin';
    console.info(`${systemName}: received ${romName}`);

    if (!wasmReady) {
      drawStatus('Loading ROM', romName);
      window.__pendingMegaDriveRom = { fileName, bytes };
      return;
    }

    const romBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const romBuffer = new Uint8Array(
      gens.HEAPU8.buffer,
      gens._get_rom_buffer_ref(romBytes.byteLength),
      romBytes.byteLength,
    );
    romBuffer.set(romBytes);
    romReady = true;
    drawStatus(`${systemName} ready`, romName);
    startEmulator();
  }

  function loop() {
    requestAnimationFrame(loop);
    if (!started || emulatorPaused) return;

    const now = Date.now();
    const delta = now - then;
    if (delta <= interval) return;

    updateInput();
    gens._tick();
    then = now - (delta % interval);

    imageData.data.set(vram);
    for (let index = 3; index < imageData.data.length; index += 4) {
      imageData.data[index] = 255;
    }
    removeScanlines(imageData.data);
    ctx.putImageData(imageData, 0, 0);

    frame += 1;
    if (Date.now() - fpsStartedAt >= 1000) {
      fps = frame;
      frame = 0;
      fpsStartedAt = Date.now();
    }

    const sampleCount = gens._sound();
    if (!audioContext || sampleCount <= 0) return;

    if (fps < targetFps) {
      soundShedTime = 0;
      return;
    }

    const audioBuffer = audioContext.createBuffer(2, Math.min(sampleCount, SAMPLING_PER_FPS), SOUND_FREQUENCY);
    audioBuffer.getChannelData(0).set(audioL.slice(0, audioBuffer.length));
    audioBuffer.getChannelData(1).set(audioR.slice(0, audioBuffer.length));
    playAudioBuffer(audioBuffer);
  }

  function removeScanlines(pixels) {
    const stride = CANVAS_WIDTH * 4;

    for (let y = 0; y < CANVAS_HEIGHT - 1; y += 2) {
      const top = y * stride;
      const bottom = top + stride;
      let topLight = 0;
      let bottomLight = 0;

      for (let x = 0; x < stride; x += 16) {
        topLight += pixels[top + x] + pixels[top + x + 1] + pixels[top + x + 2];
        bottomLight += pixels[bottom + x] + pixels[bottom + x + 1] + pixels[bottom + x + 2];
      }

      const source = topLight >= bottomLight ? top : bottom;
      const target = source === top ? bottom : top;

      if (Math.max(topLight, bottomLight) > Math.min(topLight, bottomLight) * 1.2) {
        pixels.copyWithin(target, source, source + stride);
      }
    }
  }

  function setKey(payload) {
    const key = payload.key || payload.code;
    if (!key) return;

    const keys = payload.player === 2 ? remotePressedKeys : pressedKeys;

    if (payload.action === 'down') {
      keys.add(key);
    } else if (payload.action === 'up') {
      keys.delete(key);
    }
  }

  function setEmulatorVolume(volume) {
    emulatorVolume = Math.min(1, Math.max(0, Number(volume) || 0));
    ensureAudio();
    if (audioMasterGain && audioContext) {
      audioMasterGain.gain.setValueAtTime(emulatorPaused ? 0 : emulatorVolume, audioContext.currentTime);
    }
  }

  function setEmulatorPaused(paused) {
    emulatorPaused = Boolean(paused);
    pressedKeys.clear();
    remotePressedKeys.clear();
    localMask = 0;
    remoteMask = 0;
    updateInput();
    if (audioMasterGain && audioContext) {
      audioMasterGain.gain.setValueAtTime(emulatorPaused ? 0 : emulatorVolume, audioContext.currentTime);
    }
    then = Date.now();
    soundShedTime = 0;
  }

  window.getMegaDriveAudioStream = function () {
    ensureAudio();
    return audioDestination?.stream || null;
  };

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;

    const payload = event.data || {};
    if (payload.type === 'megadrive_start') {
      startEmulator();
    }

    if (payload.type === 'megadrive_autoload') {
      loadRom(payload.fileName, payload.bytes);
    }

    if (payload.type === 'megadrive_reset') {
      resetEmulator();
    }

    if (payload.type === 'amstrad_audio_unlock') {
      ensureAudio();
    }

    if (payload.type === 'emulator_set_volume') {
      setEmulatorVolume(payload.volume);
    }

    if (payload.type === 'emulator_set_paused') {
      setEmulatorPaused(payload.paused);
    }

    if (payload.type === 'amstrad_remote_joystick') {
      if (payload.player === 1) {
        localMask = payload.mask | 0;
      } else {
        remoteMask = payload.mask | 0;
      }
    }

    if (payload.type === 'amstrad_remote_input' || payload.type === 'amstrad_remote_control') {
      setKey(payload);
    }
  });

  window.addEventListener('keydown', (event) => {
    setKey({ key: event.key, code: event.code, action: 'down' });
  });

  window.addEventListener('keyup', (event) => {
    setKey({ key: event.key, code: event.code, action: 'up' });
  });

  canvas.addEventListener('pointerdown', () => {
    ensureAudio();
    if (!started) startEmulator();
  });

  drawStatus(`Starting ${systemName}`, 'Checking genplus runtime...');

  window.Module().then((module) => {
    gens = module;
    gens._init();
    gens._set_system(isMasterSystem ? 1 : 0);
    wasmReady = true;
    console.info(`${systemName}: WASM ready in ${isMasterSystem ? 'Master System II' : 'Mega Drive'} mode`);
    drawStatus(`${systemName} ready`, 'Load a ROM file');

    const pendingRom = window.__pendingMegaDriveRom;
    if (pendingRom) {
      window.__pendingMegaDriveRom = null;
      loadRom(pendingRom.fileName, pendingRom.bytes);
    }

    if (pendingStart) {
      startEmulator();
    }
  }).catch((error) => {
    drawStatus(`${systemName} failed`, error.message);
    console.error(error);
  });
}());
