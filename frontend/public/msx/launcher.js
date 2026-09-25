(function () {
  'use strict';

  const status = document.getElementById('msx-status');
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let currentMedia = [];
  let audioContext = null;
  let audioGain = null;
  let audioDestination = null;
  let volume = 1;
  let paused = false;
  let localMask = 0;
  let remoteMask = 0;
  let loadSequence = 0;
  let controlsConnected = false;

  function showStatus(message) {
    status.textContent = message;
    status.hidden = false;
  }

  function hideStatus() {
    status.hidden = true;
  }

  function initialiseAudio(context) {
    if (audioContext) return;
    audioContext = context;
    audioGain = context.createGain();
    audioDestination = context.createMediaStreamDestination();
    audioGain.gain.value = volume;
    const originalConnect = window.AudioNode.prototype.connect;
    originalConnect.call(audioGain, context.destination);
    originalConnect.call(audioGain, audioDestination);
  }

  if (AudioContextClass) {
    function SharedAudioContext(...args) {
      const context = audioContext || new AudioContextClass(...args);
      initialiseAudio(context);
      return context;
    }

    SharedAudioContext.prototype = AudioContextClass.prototype;
    window.AudioContext = SharedAudioContext;
    window.webkitAudioContext = SharedAudioContext;

    const originalConnect = window.AudioNode.prototype.connect;
    window.AudioNode.prototype.connect = function connect(destination, ...args) {
      if (audioContext && audioGain && destination === audioContext.destination && this !== audioGain) {
        return originalConnect.call(this, audioGain, ...args);
      }
      return originalConnect.call(this, destination, ...args);
    };
  }

  window.getMsxAudioStream = function getMsxAudioStream() {
    audioContext?.resume?.().catch(() => {});
    return audioDestination?.stream || null;
  };

  function setVolume(nextVolume) {
    volume = Math.min(1, Math.max(0, Number(nextVolume) || 0));
    if (audioGain && audioContext) audioGain.gain.setValueAtTime(paused ? 0 : volume, audioContext.currentTime);
  }

  function setPaused(nextPaused) {
    paused = Boolean(nextPaused);
    window.WMSX?.room?.machine?.systemPause?.(paused);
    setVolume(volume);
  }

  function sendKey(key, code, pressed) {
    const event = new KeyboardEvent(pressed ? 'keydown' : 'keyup', { key, code, bubbles: true, cancelable: true });
    const hub = window.WMSX?.room?.controllersHub;
    if (hub) (pressed ? hub.keyDown : hub.keyUp)(event);
  }

  function setMask(player, mask) {
    if (player !== 1 && player !== 2) return;
    const startWasDown = Boolean((localMask | remoteMask) & 64);
    if (player === 1) localMask = Number(mask) & 127;
    else remoteMask = Number(mask) & 127;
    const startIsDown = Boolean((localMask | remoteMask) & 64);
    if (startWasDown !== startIsDown) sendKey('Enter', 'Enter', startIsDown);
  }

  function connectControls(room) {
    if (controlsConnected) return;
    controlsConnected = true;
    const hub = room.controllersHub;
    const readPort = hub.readControllerPort.bind(hub);
    const writePin = hub.writeControllerPin8Port.bind(hub);
    const pin8 = [0, 0];
    hub.writeControllerPin8Port = (port, value) => {
      pin8[port] = value;
      writePin(port, value);
    };
    // RoomPage already resolves controller profiles and player ownership.
    // Its six joystick bits match the MSX port bits, which are active-low.
    hub.readControllerPort = (port) => {
      const mask = port === 0 ? localMask : remoteMask;
      return readPort(port) & ~(pin8[port] ? 0 : mask & 63);
    };
  }

  function waitForRoom() {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const check = () => {
        if (window.WMSX?.room?.fileLoader && !window.WMSX.room.isLoading && window.wmsx?.FileLoader?.OPEN_TYPE) return resolve(window.WMSX.room);
        if (performance.now() - started > 15000) return reject(new Error('WebMSX did not become ready'));
        setTimeout(check, 50);
      };
      check();
    });
  }

  function mediaKind(fileName) {
    const extension = fileName.split('.').pop()?.toLowerCase();
    if (extension === 'dsk') return 'disk';
    if (extension === 'cas') return 'tape';
    if (extension === 'm3u') return 'playlist';
    if (extension === 'rom' || extension === 'mx1' || extension === 'mx2') return 'cartridge';
    throw new Error(`Unsupported MSX media: .${extension || ''}`);
  }

  async function loadMedia(media) {
    const sequence = ++loadSequence;
    showStatus(`Loading ${media[0]?.fileName || media[0]?.name || 'MSX media'}`);
    const room = await waitForRoom();
    connectControls(room);
    const types = window.wmsx.FileLoader.OPEN_TYPE;
    const disks = [];
    let cartridge = null;
    let tape = null;
    let files = [];

    for (const item of media) {
      const source = item instanceof Blob ? item : item.bytes;
      const content = source instanceof Blob ? new Uint8Array(await source.arrayBuffer())
        : source instanceof Uint8Array ? source : new Uint8Array(source || []);
      const file = { name: item.fileName || item.name, content };
      if (!file.name || !content.length) throw new Error('The MSX game file is empty or has no filename');
      files.push(file);
    }
    const playlist = files.find((file) => mediaKind(file.name) === 'playlist');
    if (playlist) {
      const normalise = (name) => name.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
      const directory = normalise(playlist.name).split('/').slice(0, -1).join('/');
      files = new TextDecoder().decode(playlist.content).split(/\r?\n/)
        .map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
        .map((name) => {
          const path = normalise(directory ? `${directory}/${name}` : name);
          const match = files.find((file) => normalise(file.name) === path || normalise(file.name) === normalise(name));
          if (!match) throw new Error(`Select the playlist and its disk files together: missing ${name}`);
          return match;
        });
    }
    for (const file of files) {
      const kind = mediaKind(file.name);
      if (kind === 'disk') disks.push(file);
      else if (kind === 'cartridge' && !cartridge) cartridge = file;
      else if (kind === 'tape' && !tape) tape = file;
    }
    if (sequence !== loadSequence) return;
    if (!disks.length && !cartridge && !tape) throw new Error('No supported MSX media supplied');

    // Replace media with power off, then boot once. altPower=true suppresses
    // WebMSX's automatic reset while the complete media set is being inserted.
    room.machine.powerOff();
    room.controllersHub.releaseControllers();
    localMask = remoteMask = 0;
    for (let drive = 0; drive < 3; drive += 1) {
      if (room.diskDrive.isDiskInserted(drive)) room.diskDrive.removeStack(drive);
    }
    for (let port = 0; port < 2; port += 1) {
      if (room.cartridgeSlot.cartridgeInserted(port)) room.cartridgeSlot.removeCartridge(port, true);
    }
    room.cassetteDeck.userRemoveTape();
    if (disks.length) {
      // Explicit drive A: preserves the supplied order and never auto-detects
      // a .dsk as a cartridge or hard disk.
      const stack = room.diskDrive.loadDiskStackFromFiles(0, disks, true, false);
      if (!stack?.length || !room.diskDrive.isDiskInserted(0)) throw new Error('WebMSX rejected the floppy disk image');
      console.info('OldStyleGaming WebMSX: mounted floppy disk', disks.map((file) => file.name));
    }
    if (cartridge) {
      room.fileLoader.loadFromContent(cartridge.name, cartridge.content, types.ROM, 0, true, false);
      if (!room.cartridgeSlot.cartridgeInserted(0)) throw new Error('WebMSX rejected the cartridge');
      console.info('OldStyleGaming WebMSX: inserted cartridge', cartridge.name);
    }
    if (tape && !room.cassetteDeck.loadTapeFile(tape.name, tape.content, true)) throw new Error('WebMSX rejected the cassette image');
    room.machine.userPowerOn(false);
    if (!room.machine.powerIsOn) throw new Error('WebMSX could not power on the MSX machine');
    setPaused(paused);
    if (tape) room.cassetteDeck.userTypeCurrentAutoRunCommand();
    currentMedia = media;
    console.info('OldStyleGaming WebMSX: machine booted', window.WMSX.MACHINE);
    hideStatus();
  }

  window.oldStyleGamingWebMsxLoaded = function oldStyleGamingWebMsxLoaded() {
    window.WMSX.SCREEN_ELEMENT_ID = 'wmsx-screen';
    window.WMSX.ALLOW_URL_PARAMETERS = false;
    window.WMSX.AUTO_START = true;
    window.WMSX.AUTO_POWER_ON_DELAY = -1;
    window.WMSX.MEDIA_CHANGE_DISABLED = true;
    window.WMSX.NETPLAY_JOIN = '';
    window.WMSX.SERVER_ADDRESS = '';
    window.WMSX.SERVER_KEEPALIVE = 0;
    // Host gamepads are mapped by RoomPage, not a second set of WebMSX profiles.
    window.WMSX.JOYSTICKS_MODE = -1;
    window.WMSX.SCREEN_RESIZE_DISABLED = true;
    window.WMSX.SCREEN_FULLSCREEN_MODE = -1;
    console.info('OldStyleGaming MSX: WebMSX 6.0.8 self-hosted runtime loaded');
  };

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const message = event.data || {};
    if (message.type === 'msx_start' || message.type === 'amstrad_audio_unlock') {
      window.getMsxAudioStream();
    } else if (message.type === 'msx_autoload') {
      const media = message.media?.length ? message.media : [message];
      loadMedia(media).catch((error) => {
        console.error('OldStyleGaming WebMSX media error:', error);
        showStatus(`MSX load failed · ${error.message}`);
      });
    } else if (message.type === 'msx_reset') {
      if (currentMedia.length) loadMedia(currentMedia).catch((error) => showStatus(`MSX reset failed · ${error.message}`));
    } else if (message.type === 'emulator_set_volume') {
      setVolume(message.volume);
    } else if (message.type === 'emulator_set_paused') {
      setPaused(message.paused);
    } else if (message.type === 'amstrad_remote_joystick') {
      setMask(message.player || 1, message.mask);
    } else if (message.type === 'amstrad_remote_control' || message.type === 'amstrad_remote_input') {
      const bits = { ArrowUp: 1, q: 1, ArrowDown: 2, a: 2, ArrowLeft: 4, o: 4, ArrowRight: 8, p: 8, x: 16, f: 16, z: 32, g: 32, Enter: 64 };
      const bit = bits[message.key] || bits[message.key?.toLowerCase()];
      if (bit) {
        const player = message.player || 1;
        const mask = player === 1 ? localMask : remoteMask;
        setMask(player, message.action === 'up' ? mask & ~bit : mask | bit);
      }
    } else if (message.type === 'msx_keyboard') {
      sendKey(message.key || '', message.code || '', message.action !== 'up');
    }
  });

  window.addEventListener('error', (event) => console.error('OldStyleGaming WebMSX error:', event.error || event.message));
})();
