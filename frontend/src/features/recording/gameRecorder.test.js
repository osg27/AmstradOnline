import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecordingFilename, GameRecorder, sanitizeRecordingPart, selectRecordingMimeType } from './gameRecorder';
import { getAdapterAudioStream, getEmulatorRecordingAdapter } from './emulatorRecordingAdapters';

class FakeMediaStream {
  constructor(tracks = []) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
}

class FakeMediaRecorder {
  static isTypeSupported(type) { return type.includes('vp8') || type === 'video/webm'; }
  constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; this.state = 'inactive'; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['clip']) }); this.onstop?.(); }
}

function makeRecorder(options = {}) {
  const makeTrack = (kind) => ({ kind, stop: vi.fn(), clone() { return makeTrack(kind); } });
  const videoTrack = makeTrack('video');
  const audioTrack = makeTrack('audio');
  return new GameRecorder({
    sourceFactory: vi.fn(async () => ({ videoStream: new FakeMediaStream([videoTrack]), audioStream: new FakeMediaStream([audioTrack]), cleanup: vi.fn() })),
    MediaRecorderClass: FakeMediaRecorder,
    MediaStreamClass: FakeMediaStream,
    URLApi: { createObjectURL: vi.fn(() => 'blob:recording'), revokeObjectURL: vi.fn() },
    ...options,
  });
}

afterEach(() => vi.useRealTimers());

describe('recording helpers', () => {
  it('selects the first supported reliable WebM MIME type', () => expect(selectRecordingMimeType(FakeMediaRecorder)).toBe('video/webm;codecs=vp8,opus'));
  it('sanitises useful filenames', () => {
    expect(sanitizeRecordingPart('Lotus II: R.E.C.S.')).toBe('Lotus-II-R-E-C-S');
    expect(createRecordingFilename({ gameTitle: 'Lotus II', system: 'Amiga', date: new Date(2026, 7, 25, 12, 14) })).toBe('Amiga-Lotus-II-2026-08-25-1214.webm');
  });
  it('marks genuinely unsupported adapters unavailable', () => {
    expect(getEmulatorRecordingAdapter('unknown').supported).toBe(false);
    expect(getEmulatorRecordingAdapter('atari8').supported).toBe(true);
    expect(getEmulatorRecordingAdapter('amiga').supported).toBe(true);
    expect(getAdapterAudioStream(getEmulatorRecordingAdapter('nes'), { getNesAudioStream: () => 'audio' })).toBe('audio');
  });
});

describe('GameRecorder state machine', () => {
  it('reports unsupported MediaRecorder', async () => {
    const recorder = makeRecorder({ MediaRecorderClass: null });
    await recorder.start();
    expect(recorder.state).toMatchObject({ status: 'error', error: expect.stringContaining('not supported') });
  });

  it('counts down without recording and then starts', async () => {
    vi.useFakeTimers();
    const recorder = makeRecorder({ now: () => Date.now() });
    await recorder.start({ countdownSeconds: 3 });
    expect(recorder.state.status).toBe('countdown');
    await vi.advanceTimersByTimeAsync(2999);
    expect(recorder.state.status).toBe('countdown');
    await vi.advanceTimersByTimeAsync(1);
    expect(recorder.state.status).toBe('recording');
    recorder.destroy();
  });

  it('auto-stops a real-time 30 second recording', async () => {
    vi.useFakeTimers();
    const recorder = makeRecorder({ now: () => Date.now() });
    await recorder.start({ durationSeconds: 30, countdownSeconds: 0, gameTitle: 'Game', system: 'NES' });
    expect(recorder.state.status).toBe('recording');
    const recordingTracks = recorder.combinedStream.getTracks();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(recorder.state).toMatchObject({ status: 'ready', elapsedSeconds: 30, downloadUrl: 'blob:recording' });
    expect(recorder.combinedStream).toBeNull();
    expect(recordingTracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
  });

  it('supports manual stop and cleans timers', async () => {
    vi.useFakeTimers();
    const recorder = makeRecorder({ now: () => Date.now() });
    await recorder.start({ durationSeconds: null, countdownSeconds: 0 });
    await vi.advanceTimersByTimeAsync(1_500);
    recorder.stop();
    expect(recorder.state.status).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('revokes old Blob URLs on reset and destroy', async () => {
    const URLApi = { createObjectURL: vi.fn(() => 'blob:one'), revokeObjectURL: vi.fn() };
    const recorder = makeRecorder({ URLApi });
    await recorder.start({ countdownSeconds: 0 });
    recorder.stop();
    recorder.reset();
    expect(URLApi.revokeObjectURL).toHaveBeenCalledWith('blob:one');
    recorder.destroy();
  });

  it('stops an active recorder and releases its source on unmount cleanup', async () => {
    const cleanup = vi.fn();
    const recorder = makeRecorder({
      sourceFactory: async () => ({
        videoStream: new FakeMediaStream([{ kind: 'video' }]),
        audioStream: new FakeMediaStream([{ kind: 'audio' }]),
        cleanup,
      }),
    });
    await recorder.start({ durationSeconds: null, countdownSeconds: 0 });
    const mediaRecorder = recorder.recorder;
    recorder.destroy();
    expect(mediaRecorder.state).toBe('inactive');
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
