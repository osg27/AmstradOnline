let audioContext = null;
let armed = false;

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

  const unlock = () => {
    const context = getAudioContext();
    context?.resume?.().catch(() => {});
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };

  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  // This is a single page-wide unlock. Keep it armed across route changes.
  return () => {};
}

export async function playRoomInviteSound() {
  const context = getAudioContext();
  if (!context) return false;

  try {
    await context.resume();
    const start = context.currentTime + 0.01;
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, start);
    master.gain.exponentialRampToValueAtTime(0.16, start + 0.015);
    master.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
    master.connect(context.destination);

    [659.25, 987.77].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = start + (index * 0.14);
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.55, noteStart + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.18);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + 0.2);
    });
    return true;
  } catch {
    return false;
  }
}
