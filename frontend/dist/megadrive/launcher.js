(function () {
  const CANVAS_WIDTH = 640;
  const CANVAS_HEIGHT = 480;
  const SOUND_FREQUENCY = 44100;
  const SAMPLING_PER_FPS = 736;
  const GAMEPAD_API_INDEX = 32;
  const FPS = 60;
  const INTERVAL = 1000 / FPS;
  const SOUND_DELAY_FRAME = 8;

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
  let soundShedTime = 0;
  let then = Date.now();
  let fps = FPS;
  let frame = FPS;
  let fpsStartedAt = Date.now();
  let localMask = 0;
  let remoteMask = 0;
  const pressedKeys = new Set();

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

    const silence = audioContext.createBuffer(2, SAMPLING_PER_FPS, SOUND_FREQUENCY);
    playAudioBuffer(silence);
  }

  function playAudioBuffer(audioBuffer) {
    if (!audioContext) return;

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    if (audioDestination) {
      source.connect(audioDestination);
    }
    source.connect(audioContext.destination);

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

  function keyMask() {
    let mask = 0;
    if (pressedKeys.has('ArrowUp')) mask |= 1;
    if (pressedKeys.has('ArrowDown')) mask |= 2;
    if (pressedKeys.has('ArrowLeft')) mask |= 4;
    if (pressedKeys.has('ArrowRight')) mask |= 8;
    if (pressedKeys.has('z') || pressedKeys.has('Z')) mask |= 16;
    if (pressedKeys.has('x') || pressedKeys.has('X')) mask |= 32;
    if (pressedKeys.has('Enter')) mask |= 64;
    if (pressedKeys.has('c') || pressedKeys.has('C')) mask |= 128;
    return mask;
  }

  function updateInput() {
    if (!input) return;

    const mask = keyMask() | localMask | remoteMask;
    input.fill(0);
    input[6] = getAxis(mask, 4, 8);
    input[7] = getAxis(mask, 1, 2);
    input[8 + 2] = mask & 16 ? 1 : 0; // A
    input[8 + 3] = mask & 32 ? 1 : 0; // B
    input[8 + 1] = mask & 128 ? 1 : 0; // C
    input[8 + 7] = mask & 64 ? 1 : 0; // Start
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
      drawStatus('Starting Mega Drive', 'Checking genplus runtime...');
      return;
    }

    if (!romReady) {
      drawStatus('Mega Drive ready', 'Load a ROM file');
      return;
    }

    gens._start();
    bindViews();
    started = true;
    pendingStart = false;
    then = Date.now();

    if (!looping) {
      looping = true;
      requestAnimationFrame(loop);
    }
  }

  function loadRom(fileName, bytes) {
    romName = fileName || 'game.bin';

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
    drawStatus('Mega Drive ready', romName);

    if (started || pendingStart) {
      startEmulator();
    }
  }

  function loop() {
    requestAnimationFrame(loop);
    if (!started) return;

    const now = Date.now();
    const delta = now - then;
    if (delta <= INTERVAL) return;

    updateInput();
    gens._tick();
    then = now - (delta % INTERVAL);

    imageData.data.set(vram);
    ctx.putImageData(imageData, 0, 0);

    frame += 1;
    if (Date.now() - fpsStartedAt >= 1000) {
      fps = frame;
      frame = 0;
      fpsStartedAt = Date.now();
    }

    const sampleCount = gens._sound();
    if (!audioContext || sampleCount <= 0) return;

    if (fps < FPS) {
      soundShedTime = 0;
      return;
    }

    const audioBuffer = audioContext.createBuffer(2, Math.min(sampleCount, SAMPLING_PER_FPS), SOUND_FREQUENCY);
    audioBuffer.getChannelData(0).set(audioL.slice(0, audioBuffer.length));
    audioBuffer.getChannelData(1).set(audioR.slice(0, audioBuffer.length));
    playAudioBuffer(audioBuffer);
  }

  function setKey(payload) {
    const key = payload.key || payload.code;
    if (!key) return;

    if (payload.action === 'down') {
      pressedKeys.add(key);
    } else if (payload.action === 'up') {
      pressedKeys.delete(key);
    }
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

    if (payload.type === 'amstrad_audio_unlock') {
      ensureAudio();
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

  drawStatus('Starting Mega Drive', 'Checking genplus runtime...');

  window.Module().then((module) => {
    gens = module;
    gens._init();
    wasmReady = true;
    drawStatus('Mega Drive ready', 'Load a ROM file');

    const pendingRom = window.__pendingMegaDriveRom;
    if (pendingRom) {
      window.__pendingMegaDriveRom = null;
      loadRom(pendingRom.fileName, pendingRom.bytes);
    }

    if (pendingStart) {
      startEmulator();
    }
  }).catch((error) => {
    drawStatus('Mega Drive failed', error.message);
    console.error(error);
  });
}());
