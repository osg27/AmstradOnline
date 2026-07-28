(function () {
  try {
    localStorage.setItem("webretro_settings_pastFirstSave", "true");
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }

  let pendingBios = null;
  let pendingFiles = null;
  let started = false;
  let audioContext = null;
  let audioDestination = null;
  let captureGain = null;
  let volume = 1;
  let paused = false;
  const playerMasks = [0, 0];

  const NativeAudioContext = window.AudioContext || window.webkitAudioContext;

  function ensureAudioCapture() {
    if (!NativeAudioContext) return null;
    if (!audioContext) audioContext = new NativeAudioContext();
    if (!audioDestination) {
      audioDestination = audioContext.createMediaStreamDestination();
      captureGain = audioContext.createGain();
      captureGain.gain.value = paused ? 0 : volume;
      captureGain.connect(audioDestination);
    }
    return audioContext;
  }

  if (NativeAudioContext) {
    function SharedAudioContext(...args) {
      if (!audioContext) audioContext = new NativeAudioContext(...args);
      ensureAudioCapture();
      return audioContext;
    }

    SharedAudioContext.prototype = NativeAudioContext.prototype;
    window.AudioContext = SharedAudioContext;
    window.webkitAudioContext = SharedAudioContext;

    const originalConnect = window.AudioNode && window.AudioNode.prototype.connect;
    if (originalConnect) {
      window.AudioNode.prototype.connect = function oldStyleConnect(destination, ...args) {
        const result = originalConnect.call(this, destination, ...args);
        if (
          audioDestination
          && destination === audioContext?.destination
          && this !== audioDestination
          && this !== captureGain
        ) {
          try {
            originalConnect.call(this, captureGain);
          } catch {
            // Preserve webretro's normal local audio path if a node cannot fan out.
          }
        }
        return result;
      };
    }
  }

  window.getSaturnAudioStream = function getSaturnAudioStream() {
    ensureAudioCapture()?.resume?.().catch(() => {});
    return audioDestination?.stream || null;
  };

  function installBios() {
    if (!pendingBios || typeof window.FS === 'undefined') return false;
    window.FS.createPath('/', 'home/web_user/retroarch/userdata/system', true, true);
    window.FS.writeFile(
      '/home/web_user/retroarch/userdata/system/saturn_bios.bin',
      pendingBios,
    );
    window.biosReady = true;
    return true;
  }

  window.oldStylePrepareSaturnBios = function oldStylePrepareSaturnBios() {
    window.biosReady = installBios();
    if (!window.biosReady) {
      window.parent.postMessage({ type: 'webretro_saturn_bios_required' }, window.location.origin);
    }
  };

  function tryStart() {
    if (started || !pendingBios || !pendingFiles) return;
    if (typeof window.initFromFile !== 'function' || !window.romUploadsReady) {
      window.setTimeout(tryStart, 100);
      return;
    }

    installBios();
    started = true;
    window.initFromFile(pendingFiles);
  }

  const keyMaps = [
    [
      ['KeyH', 'h'], ['KeyG', 'g'], ['Space', ' '], ['Enter', 'Enter'],
      ['ArrowUp', 'ArrowUp'], ['ArrowDown', 'ArrowDown'],
      ['ArrowLeft', 'ArrowLeft'], ['ArrowRight', 'ArrowRight'],
      ['KeyY', 'y'], ['KeyT', 't'], ['KeyE', 'e'], ['KeyP', 'p'],
    ],
    [
      ['KeyF', 'f'], ['KeyD', 'd'], ['Tab', 'Tab'], ['ShiftRight', 'Shift'],
      ['KeyI', 'i'], ['KeyK', 'k'], ['KeyJ', 'j'], ['KeyL', 'l'],
      ['KeyR', 'r'], ['KeyE', 'e'], ['KeyQ', 'q'], ['KeyW', 'w'],
    ],
  ];

  function setPlayerMask(player, nextMask) {
    const index = player === 2 ? 1 : 0;
    const previousMask = playerMasks[index];
    const mapping = keyMaps[index];

    mapping.forEach(([code, key], bitIndex) => {
      const bit = 1 << bitIndex;
      if (Boolean(previousMask & bit) === Boolean(nextMask & bit)) return;
      document.dispatchEvent(new KeyboardEvent(
        nextMask & bit ? 'keydown' : 'keyup',
        { code, key, bubbles: true, cancelable: true },
      ));
    });

    playerMasks[index] = nextMask;
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const message = event.data || {};

    if (message.type === 'saturn_bios') {
      pendingBios = new Uint8Array(message.bytes || []).slice();
      installBios();
      tryStart();
      return;
    }

    if (message.type === 'saturn_autoload') {
      pendingFiles = (message.files || []).map((file) => ({
        path: file.fileName,
        data: new Uint8Array(file.bytes || []).slice().buffer,
      }));
      tryStart();
      return;
    }

    if (message.type === 'saturn_start' || message.type === 'amstrad_audio_unlock') {
      ensureAudioCapture()?.resume?.().catch(() => {});
      tryStart();
      return;
    }

    if (message.type === 'emulator_set_volume') {
      volume = Math.min(1, Math.max(0, Number(message.volume) || 0));
      if (captureGain && audioContext) {
        captureGain.gain.setValueAtTime(paused ? 0 : volume, audioContext.currentTime);
      }
      return;
    }

    if (message.type === 'emulator_set_paused') {
      paused = Boolean(message.paused);
      if (window.Module) {
        if (paused) window.Module._cmd_pause?.();
        else window.Module._cmd_unpause?.();
      }
      if (captureGain && audioContext) {
        captureGain.gain.setValueAtTime(paused ? 0 : volume, audioContext.currentTime);
      }
      return;
    }

    if (message.type === 'saturn_reset') {
      window.Module?._cmd_reset?.();
      return;
    }

    if (message.type === 'amstrad_remote_joystick') {
      setPlayerMask(message.player || 1, Number(message.mask) || 0);
    }
  });

  window.parent.postMessage({ type: 'webretro_saturn_ready' }, window.location.origin);
})();
