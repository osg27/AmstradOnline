export const RECORDING_DURATIONS = [15, 30, 60, 120, 300, null];
export const RECORDING_COUNTDOWNS = [0, 3, 5];
export const RECORDING_QUALITIES = {
  standard: { label: 'Standard', videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 160_000 },
  high: { label: 'High', videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 },
};

export function selectRecordingMimeType(MediaRecorderClass = globalThis.MediaRecorder) {
  if (!MediaRecorderClass) return '';
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((type) => MediaRecorderClass.isTypeSupported?.(type)) || '';
}

export function sanitizeRecordingPart(value, fallback = 'Gameplay') {
  const clean = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return clean || fallback;
}

export function createRecordingFilename({ gameTitle, system, date = new Date(), extension = 'webm' } = {}) {
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${sanitizeRecordingPart(system, 'Game')}-${sanitizeRecordingPart(gameTitle)}-${stamp}.${extension}`;
}

const INITIAL_STATE = {
  status: 'idle', countdownRemaining: 0, elapsedSeconds: 0, remainingSeconds: null,
  durationSeconds: 30, blob: null, downloadUrl: '', filename: '', mimeType: '', error: '',
};

export class GameRecorder {
  constructor({ sourceFactory, MediaRecorderClass = globalThis.MediaRecorder, MediaStreamClass = globalThis.MediaStream, URLApi = globalThis.URL, now = () => Date.now() } = {}) {
    this.sourceFactory = sourceFactory;
    this.MediaRecorderClass = MediaRecorderClass;
    this.MediaStreamClass = MediaStreamClass;
    this.URLApi = URLApi;
    this.now = now;
    this.state = { ...INITIAL_STATE };
    this.listeners = new Set();
    this.destroyed = false;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }

  clearTimers() {
    clearInterval(this.countdownTimer);
    clearInterval(this.elapsedTimer);
    clearTimeout(this.stopTimer);
    this.countdownTimer = null;
    this.elapsedTimer = null;
    this.stopTimer = null;
  }

  releaseResult() {
    if (this.state.downloadUrl) this.URLApi?.revokeObjectURL?.(this.state.downloadUrl);
  }

  async start({ durationSeconds = 30, countdownSeconds = 3, quality = 'standard', gameTitle, system } = {}) {
    if (!this.MediaRecorderClass) {
      this.setState({ status: 'error', error: 'MediaRecorder is not supported by this browser.' });
      return false;
    }
    const mimeType = selectRecordingMimeType(this.MediaRecorderClass);
    if (!mimeType) {
      this.setState({ status: 'error', error: 'This browser has no supported WebM recording format.' });
      return false;
    }
    this.reset();
    this.pendingOptions = { durationSeconds, quality, gameTitle, system, mimeType };
    if (countdownSeconds > 0) {
      const countdownEndsAt = this.now() + countdownSeconds * 1000;
      this.setState({ status: 'countdown', countdownRemaining: countdownSeconds, durationSeconds, mimeType });
      this.countdownTimer = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((countdownEndsAt - this.now()) / 1000));
        this.setState({ countdownRemaining: remaining });
        if (!remaining) {
          clearInterval(this.countdownTimer);
          this.countdownTimer = null;
          this.beginRecording().catch((error) => this.fail(error));
        }
      }, 100);
      return true;
    }
    await this.beginRecording();
    return this.state.status === 'recording';
  }

  async beginRecording() {
    const options = this.pendingOptions;
    if (!options || this.destroyed) return;
    const source = await this.sourceFactory?.();
    const videoTracks = source?.videoStream?.getVideoTracks?.() || [];
    const audioTracks = source?.audioStream?.getAudioTracks?.() || [];
    if (!videoTracks.length || !audioTracks.length) throw new Error('Recording requires both emulator video and game audio.');
    this.source = source;
    this.combinedStream = new this.MediaStreamClass([...videoTracks, ...audioTracks]);
    const quality = RECORDING_QUALITIES[options.quality] || RECORDING_QUALITIES.standard;
    this.chunks = [];
    this.recorder = new this.MediaRecorderClass(this.combinedStream, { mimeType: options.mimeType, ...quality });
    this.recorder.ondataavailable = (event) => {
      if (event.data?.size) this.chunks.push(event.data);
    };
    this.recorder.onerror = (event) => this.fail(event.error || new Error('MediaRecorder failed.'));
    this.recorder.onstop = () => this.finish();
    this.startedAt = this.now();
    this.setState({ status: 'recording', countdownRemaining: 0, elapsedSeconds: 0, remainingSeconds: options.durationSeconds, error: '' });
    this.recorder.start(1000);
    this.elapsedTimer = setInterval(() => this.updateElapsed(), 250);
    if (options.durationSeconds != null) {
      this.stopTimer = setTimeout(() => this.stop(), options.durationSeconds * 1000);
    }
  }

  updateElapsed() {
    const elapsedSeconds = Math.max(0, Math.floor((this.now() - this.startedAt) / 1000));
    const duration = this.pendingOptions?.durationSeconds;
    this.setState({ elapsedSeconds, remainingSeconds: duration == null ? null : Math.max(0, duration - elapsedSeconds) });
  }

  stop() {
    if (this.state.status === 'countdown') {
      this.clearTimers();
      this.setState({ ...INITIAL_STATE });
      return;
    }
    if (this.recorder?.state === 'recording' || this.recorder?.state === 'paused') {
      this.updateElapsed();
      this.clearTimers();
      this.recorder.stop();
    }
  }

  finish() {
    this.clearTimers();
    this.source?.cleanup?.();
    this.source = null;
    if (this.destroyed) return;
    const mimeType = this.recorder?.mimeType || this.pendingOptions?.mimeType || 'video/webm';
    const blob = new Blob(this.chunks || [], { type: mimeType });
    const downloadUrl = this.URLApi?.createObjectURL?.(blob) || '';
    const filename = createRecordingFilename({ gameTitle: this.pendingOptions?.gameTitle, system: this.pendingOptions?.system });
    this.setState({ status: 'ready', blob, downloadUrl, filename, mimeType, remainingSeconds: 0 });
  }

  fail(error) {
    this.clearTimers();
    this.source?.cleanup?.();
    this.source = null;
    this.setState({ status: 'error', error: error?.message || String(error || 'Recording failed.') });
  }

  reset() {
    this.clearTimers();
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.source?.cleanup?.();
    this.source = null;
    this.releaseResult();
    this.setState({ ...INITIAL_STATE });
  }

  destroy() {
    this.destroyed = true;
    this.clearTimers();
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.source?.cleanup?.();
    this.source = null;
    this.releaseResult();
    this.listeners.clear();
  }
}
