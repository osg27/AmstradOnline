let audioContext = null;
let armed = false;
let pendingInvite = false;

function getAudioContext() {
  if (audioContext) return audioContext;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  audioContext = new AudioContextClass();
  return audioContext;
}

export function armNotificationSound() {
  if (armed || typeof window === 'undefined') return () => {};
  armed = true;

  const unlock = async () => {
    const context = getAudioContext();
    try {
      await context?.resume?.();
      if (pendingInvite && context?.state === 'running') {
        pendingInvite = false;
        playTone(context);
      }
    } catch {
      // Keep the listeners and pending alert so the next gesture can retry.
      return;
    }
    if (context?.state === 'running') {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    }
  };

  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  // This is a single page-wide unlock. Keep it armed across route changes.
  return () => {};
}

function playTone(context) {
  const start = context.currentTime + 0.01;
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  master.gain.setValueAtTime(0.72, start);
  compressor.threshold.value = -18;
  compressor.knee.value = 10;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.15;
  master.connect(compressor);
  compressor.connect(context.destination);

  // A bright metal drop followed by the heavier coin-mech clunk.
  [1840, 2470].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const noteStart = start + (index * 0.035);
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, noteStart);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.78, noteStart + 0.22);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(index ? 0.18 : 0.28, noteStart + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.28);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + 0.3);
  });

  [0, 0.105].forEach((offset, index) => {
    const clunkStart = start + 0.12 + offset;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(index ? 105 : 155, clunkStart);
    oscillator.frequency.exponentialRampToValueAtTime(62, clunkStart + 0.085);
    gain.gain.setValueAtTime(0.0001, clunkStart);
    gain.gain.exponentialRampToValueAtTime(index ? 0.22 : 0.34, clunkStart + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, clunkStart + 0.11);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(clunkStart);
    oscillator.stop(clunkStart + 0.12);
  });

  const noiseLength = Math.floor(context.sampleRate * 0.34);
  const noiseBuffer = context.createBuffer(1, noiseLength, context.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let index = 0; index < noiseLength; index += 1) {
    const decay = Math.exp(-index / (context.sampleRate * 0.055));
    noiseData[index] = (Math.random() * 2 - 1) * decay;
  }
  const noise = context.createBufferSource();
  const noiseFilter = context.createBiquadFilter();
  const noiseGain = context.createGain();
  noise.buffer = noiseBuffer;
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 3200;
  noiseFilter.Q.value = 0.8;
  noiseGain.gain.value = 0.26;
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(master);
  noise.start(start + 0.015);
}

export async function playRoomInviteSound() {
  const context = getAudioContext();
  if (!context) return false;

  try {
    await context.resume();
    if (context.state !== 'running') {
      pendingInvite = true;
      return true;
    }
    pendingInvite = false;
    playTone(context);
    return true;
  } catch {
    pendingInvite = true;
    return true;
  }
}
