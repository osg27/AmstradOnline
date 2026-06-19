(function () {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;
  let audioDestination = null;
  let audioScheduledAt = 0;

  function ensureAudio() {
    if (!AudioContextClass) return null;
    if (!audioContext) {
      audioContext = new AudioContextClass();
      audioDestination = audioContext.createMediaStreamDestination();
      audioScheduledAt = audioContext.currentTime + 0.05;
    }
    audioContext.resume().catch(() => {});
    return audioContext;
  }

  if (window.Audio?.prototype && !window.Audio.prototype.mozSetup) {
    window.Audio.prototype.mozSetup = function (channels, sampleRate) {
      this.cpcChannels = channels;
      this.cpcSampleRate = sampleRate;
      ensureAudio();
    };

    window.Audio.prototype.mozWriteAudio = function (samples) {
      const context = ensureAudio();
      const channels = this.cpcChannels || 2;
      const sourceRate = this.cpcSampleRate || 125000;
      if (!context || !samples?.length) return 0;

      const sourceFrames = Math.floor(samples.length / channels);
      const outputFrames = Math.max(1, Math.floor(sourceFrames * context.sampleRate / sourceRate));
      const buffer = context.createBuffer(channels, outputFrames, context.sampleRate);

      for (let channel = 0; channel < channels; channel += 1) {
        const output = buffer.getChannelData(channel);
        for (let frame = 0; frame < outputFrames; frame += 1) {
          const sourceFrame = Math.min(sourceFrames - 1, Math.floor(frame * sourceRate / context.sampleRate));
          output[frame] = samples[sourceFrame * channels + channel] || 0;
        }
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.connect(audioDestination);
      const startAt = Math.max(audioScheduledAt, context.currentTime + 0.005);
      source.start(startAt);
      audioScheduledAt = startAt + buffer.duration;
      if (audioScheduledAt - context.currentTime > 0.25) {
        audioScheduledAt = context.currentTime + 0.05;
      }
      return samples.length;
    };
  }

  const KEY_CODES = {
    Enter: 13,
    Backspace: 8,
    Delete: 46,
    Tab: 9,
    Escape: 27,
    Shift: 16,
    ShiftLeft: 16,
    ShiftRight: 16,
    Control: 17,
    Alt: 18,
    CapsLock: 20,
    ' ': 32,
    Space: 32,
    Spacebar: 32,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    F1: 112,
    F2: 113,
    F3: 114,
    F4: 115,
    F5: 116,
    F6: 117,
    F7: 118,
    F8: 119,
    F9: 120,
    F10: 121,
    '!': 49,
    '"': 50,
    '£': 51,
    '$': 52,
    '%': 53,
    '^': 54,
    '&': 55,
    '*': 56,
    '(': 57,
    ')': 48,
    '.': 190,
    '\\': 220,
  };

  const heldJoystickKeys = new Set();
  let pendingDisk = null;
  let ready = false;

  function keyCodeFor(key) {
    if (typeof key !== 'string') return null;
    if (KEY_CODES[key] !== undefined) return KEY_CODES[key];
    if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
    return KEY_CODES[key] ?? null;
  }

  function dispatchKey(code, action) {
    if (code === null) return;
    document.dispatchEvent(new KeyboardEvent(action === 'down' ? 'keydown' : 'keyup', {
      bubbles: true,
      cancelable: true,
      keyCode: code,
      which: code,
    }));
  }

  function tapKey(code, duration = 55) {
    dispatchKey(code, 'down');
    setTimeout(() => dispatchKey(code, 'up'), duration);
  }

  function typeText(text, delay = 90, startDelay = 900) {
    [...text].forEach((character, index) => {
      setTimeout(() => tapKey(character.toUpperCase().charCodeAt(0)), startDelay + index * delay);
    });
    setTimeout(() => tapKey(13), startDelay + text.length * delay + 100);
  }

  function boot6128() {
    if (!window.jQuery || typeof window.qH !== 'object') return false;
    const $ = window.jQuery;
    $('input[name="brand"][value="amstrad"]').prop('checked', true);
    $('input[name="firmware"][value="english"]').prop('checked', true);
    $('input[name="crtc"][value="type1"]').prop('checked', true);
    $('input[name="monitor"][value="colour"]').prop('checked', true);
    $('input[name="audio"][value="stereo"]').prop('checked', true);
    if (typeof window.oU?.y === 'function' && typeof window.oU?.w === 'function') {
      window.oU.y();
      window.oU.w();
    }
    $('#snapshot').val('boot_cpc6128');
    $('#snapshot').trigger('change');
    window.oU.g = false;
    return true;
  }

  function insertDisk(fileName, bytes) {
    const input = document.getElementById('drivea-input');
    if (!input || !window.DataTransfer) return false;

    const file = new File([bytes], fileName, { type: 'application/octet-stream' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(() => typeText('cat'), 250);
    return true;
  }

  function loadDisk(fileName, bytes) {
    pendingDisk = { fileName, bytes };
    if (!ready) return;

    boot6128();
    setTimeout(() => {
      if (pendingDisk && insertDisk(pendingDisk.fileName, pendingDisk.bytes)) {
        pendingDisk = null;
      }
    }, 300);
  }

  function applyJoystickMask(mask) {
    if (window.oU) window.oU.g = false;
    const next = new Set();
    if (mask & 1) next.add(38);
    if (mask & 2) next.add(40);
    if (mask & 4) next.add(37);
    if (mask & 8) next.add(39);
    if (mask & 16) next.add(17);
    if (mask & 32) next.add(32);
    if (mask & 64) next.add(13);

    heldJoystickKeys.forEach((code) => {
      if (!next.has(code)) dispatchKey(code, 'up');
    });
    next.forEach((code) => {
      if (!heldJoystickKeys.has(code)) dispatchKey(code, 'down');
    });

    heldJoystickKeys.clear();
    next.forEach((code) => heldJoystickKeys.add(code));
  }

  document.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return;
    window.parent.postMessage({ type: 'amstrad_input', key: event.key, action: 'down' }, location.origin);
  }, true);

  document.addEventListener('keyup', (event) => {
    if (!event.isTrusted) return;
    window.parent.postMessage({ type: 'amstrad_input', key: event.key, action: 'up' }, location.origin);
  }, true);

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || !event.data) return;
    const data = event.data;

    if (data.type === 'amstrad_autoload' && data.fileName && data.bytes) {
      loadDisk(data.fileName, new Uint8Array(data.bytes));
    } else if (data.type === 'amstrad_reset') {
      boot6128();
    } else if (data.type === 'amstrad_audio_unlock') {
      ensureAudio();
    } else if (data.type === 'amstrad_remote_input' || data.type === 'amstrad_remote_control') {
      if (window.oU) window.oU.g = false;
      dispatchKey(keyCodeFor(data.key), data.action);
    } else if (data.type === 'amstrad_remote_joystick') {
      applyJoystickMask(Number(data.mask) || 0);
    }
  });

  const readinessTimer = setInterval(() => {
    const canvas = document.getElementById('screen');
    if (typeof window.qH !== 'object' || !canvas) return;
    ready = true;
    clearInterval(readinessTimer);
    boot6128();
    if (pendingDisk) loadDisk(pendingDisk.fileName, pendingDisk.bytes);
  }, 50);

  window.getAmstradAudioStream = () => {
    ensureAudio();
    return audioDestination?.stream || null;
  };
}());
