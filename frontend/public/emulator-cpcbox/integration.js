(function () {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;
  let audioDestination = null;
  let audioGain = null;
  let audioScheduledAt = 0;
  let emulatorVolume = 1;
  let emulatorPaused = false;

  function ensureAudio() {
    if (!AudioContextClass) return null;
    if (!audioContext) {
      audioContext = new AudioContextClass();
      audioDestination = audioContext.createMediaStreamDestination();
      audioGain = audioContext.createGain();
      audioGain.gain.value = emulatorVolume;
      audioGain.connect(audioContext.destination);
      audioGain.connect(audioDestination);
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
      source.connect(audioGain || context.destination);
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
  const heldRemoteKeyCodes = new Set();
  const CURSOR_KEY_CODES = new Set([37, 38, 39, 40]);
  let pendingDisk = null;
  let ready = false;

  function keyCodeFor(key) {
    if (typeof key !== 'string') return null;
    if (KEY_CODES[key] !== undefined) return KEY_CODES[key];
    if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
    return KEY_CODES[key] ?? null;
  }

  function keyStrokeFor(character) {
    if (character === '"') return { code: 50, shift: true };
    if (character === '!') return { code: 49, shift: true };
    if (character === '$') return { code: 52, shift: true };
    if (character === '%') return { code: 53, shift: true };
    if (character === '&') return { code: 55, shift: true };
    if (character === '(') return { code: 57, shift: true };
    if (character === ')') return { code: 48, shift: true };

    const code = keyCodeFor(character);
    return code === null ? null : { code, shift: false };
  }

  function matrixKeyFor(code, joystickMode) {
    if (!window.pT?.iQ) return null;
    if (!window.oU || typeof joystickMode !== 'boolean') return window.pT.iQ(code);

    const previous = window.oU.g;
    window.oU.g = joystickMode;
    const matrixKey = window.pT.iQ(code);
    window.oU.g = previous;
    return matrixKey;
  }

  function applyMatrixKey(code, action, options = {}) {
    const matrixKey = matrixKeyFor(code, options.forceKeyboard ? false : undefined);
    if (!matrixKey || !window.pT?.hj) return false;

    const [row, bit] = matrixKey;
    window.pT.hj[row] = action === 'down'
      ? window.pT.hj[row] & ~bit & 255
      : window.pT.hj[row] | bit;
    return true;
  }

  function dispatchKey(code, action, options = {}) {
    if (code === null) return;
    document.dispatchEvent(new KeyboardEvent(action === 'down' ? 'keydown' : 'keyup', {
      bubbles: true,
      cancelable: true,
      keyCode: code,
      which: code,
    }));

    applyMatrixKey(code, action, options);
  }

  function releaseAllInput() {
    heldRemoteKeyCodes.forEach((code) => dispatchKey(code, 'up'));
    heldRemoteKeyCodes.clear();
    applyJoystickMask(0);
  }

  function setEmulatorVolume(volume) {
    emulatorVolume = Math.min(1, Math.max(0, Number(volume) || 0));
    ensureAudio();
    if (audioGain && audioContext) {
      audioGain.gain.setValueAtTime(emulatorVolume, audioContext.currentTime);
    }
  }

  function setEmulatorPaused(paused) {
    emulatorPaused = Boolean(paused);
    releaseAllInput();
    if (audioContext && audioGain) {
      audioGain.gain.setValueAtTime(emulatorPaused ? 0 : emulatorVolume, audioContext.currentTime);
    }

    const runButton = document.getElementById('button-run');
    if (runButton) {
      const saysResume = /resume/i.test(runButton.textContent || '');
      if ((emulatorPaused && !saysResume) || (!emulatorPaused && saysResume)) {
        runButton.click();
      }
    }
  }

  function tapKey(code, duration = 55) {
    dispatchKey(code, 'down');
    setTimeout(() => dispatchKey(code, 'up'), duration);
  }

  function tapStroke(stroke, duration = 55) {
    if (!stroke) return;
    if (stroke.shift) {
      dispatchKey(16, 'down');
      setTimeout(() => dispatchKey(stroke.code, 'down'), 8);
      setTimeout(() => dispatchKey(stroke.code, 'up'), duration);
      setTimeout(() => dispatchKey(16, 'up'), duration + 12);
      return;
    }
    tapKey(stroke.code, duration);
  }

  function setJoystickMode(enabled) {
    if (window.oU) window.oU.g = Boolean(enabled);

    const joystickButton = document.getElementById('checkbox-joystick');
    if (joystickButton) {
      joystickButton.setAttribute('title', enabled ? 'Disable CPC joystick' : 'Enable CPC joystick');
      joystickButton.style.backgroundPosition = enabled ? '0px -36px' : '0px 0px';
    }
  }

  function typeText(text, delay = 90, startDelay = 900) {
    [...text].forEach((character, index) => {
      const stroke = keyStrokeFor(character);
      if (stroke) {
        setTimeout(() => tapStroke(stroke), startDelay + index * delay);
      }
    });
    setTimeout(() => tapKey(13), startDelay + text.length * delay + 120);
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
    setJoystickMode(true);
    return true;
  }

  function insertDisk(fileName, bytes, autoloadCommand) {
    const input = document.getElementById('drivea-input');
    if (!input || !window.DataTransfer) return false;

    const file = new File([bytes], fileName, { type: 'application/octet-stream' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    typeText('cat', 90, 900);
    if (typeof autoloadCommand === 'string' && autoloadCommand.trim()) {
      typeText(autoloadCommand.trim(), 90, 2800);
    }
    return true;
  }

  function loadDisk(fileName, bytes, autoloadCommand) {
    pendingDisk = { fileName, bytes, autoloadCommand };
    if (!ready) return;

    boot6128();
    setTimeout(() => {
      if (pendingDisk && insertDisk(pendingDisk.fileName, pendingDisk.bytes, pendingDisk.autoloadCommand)) {
        pendingDisk = null;
      }
    }, 300);
  }

  function applyJoystickMask(mask) {
    setJoystickMode(true);
    const next = new Set();
    if (mask & 1) next.add(38);
    if (mask & 2) next.add(40);
    if (mask & 4) next.add(37);
    if (mask & 8) next.add(39);
    if (mask & 16) next.add(17);
    if (mask & 32) next.add(18);
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

  function handlePhysicalKey(event) {
    if (!event.isTrusted) return;

    const code = event.keyCode || event.which;
    const action = event.type === 'keydown' ? 'down' : 'up';

    if (CURSOR_KEY_CODES.has(code) && window.oU?.g) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyMatrixKey(code, action, { forceKeyboard: true });
    }

    window.parent.postMessage({ type: 'amstrad_input', key: event.key, action }, location.origin);
  }

  document.addEventListener('keydown', handlePhysicalKey, true);
  document.addEventListener('keyup', handlePhysicalKey, true);

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || !event.data) return;
    const data = event.data;

    if (data.type === 'amstrad_autoload' && data.fileName && data.bytes) {
      loadDisk(data.fileName, new Uint8Array(data.bytes), data.autoloadCommand);
    } else if (data.type === 'amstrad_reset') {
      boot6128();
    } else if (data.type === 'amstrad_audio_unlock') {
      ensureAudio();
    } else if (data.type === 'emulator_set_volume') {
      setEmulatorVolume(data.volume);
    } else if (data.type === 'emulator_set_paused') {
      setEmulatorPaused(data.paused);
    } else if (data.type === 'amstrad_remote_input' || data.type === 'amstrad_remote_control') {
      const code = keyCodeFor(data.key);
      dispatchKey(code, data.action, { forceKeyboard: CURSOR_KEY_CODES.has(code) });
      if (code !== null) {
        if (data.action === 'down') heldRemoteKeyCodes.add(code);
        else heldRemoteKeyCodes.delete(code);
      }
    } else if (data.type === 'amstrad_remote_joystick') {
      applyJoystickMask(Number(data.mask) || 0);
    } else if (data.type === 'amstrad_release_all') {
      releaseAllInput();
    }
  });

  window.addEventListener('blur', releaseAllInput);

  const readinessTimer = setInterval(() => {
    const canvas = document.getElementById('screen');
    if (typeof window.qH !== 'object' || !canvas) return;
    ready = true;
    clearInterval(readinessTimer);
    boot6128();
    if (pendingDisk) loadDisk(pendingDisk.fileName, pendingDisk.bytes, pendingDisk.autoloadCommand);
  }, 50);

  window.getAmstradAudioStream = () => {
    ensureAudio();
    return audioDestination?.stream || null;
  };
}());
