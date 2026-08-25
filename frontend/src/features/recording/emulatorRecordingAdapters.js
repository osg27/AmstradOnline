const ADAPTERS = {
  amiga: { label: 'Amiga', fps: 50, audioGetter: 'getAmigaAgaAudioStream' },
  amiga_aga: { label: 'Amiga AGA', fps: 50, audioGetter: 'getAmigaAgaAudioStream' },
  amiga_link: { label: 'Amiga', fps: 50, audioGetter: 'getAmigaAudioStream' },
  cpc: { label: 'Amstrad CPC', fps: 50, audioGetter: 'getAmstradAudioStream' },
  cpc_party: { label: 'Amstrad CPC', fps: 50, audioGetter: 'getAmstradAudioStream' },
  c64: { label: 'Commodore 64', fps: 50, audioGetter: 'getC64AudioStream' },
  spectrum: { label: 'ZX Spectrum', fps: 50, audioGetter: 'getSpectrumAudioStream' },
  mastersystem: { label: 'Master System', fps: 60, audioGetter: 'getMegaDriveAudioStream' },
  megadrive: { label: 'Mega Drive', fps: 60, audioGetter: 'getMegaDriveAudioStream' },
  nes: { label: 'NES', fps: 60, audioGetter: 'getNesAudioStream' },
  snes: { label: 'SNES', fps: 60, audioGetter: 'getSnesAudioStream' },
  pcengine: { label: 'PC Engine', fps: 60, audioGetter: 'getPcEngineAudioStream' },
  x68000: { label: 'X68000', fps: 60, audioGetter: 'getX68000AudioStream', fallbackAudioGetter: 'getPcEngineAudioStream' },
  atarist: { label: 'Atari ST', fps: 50, audioGetter: 'getAtariStAudioStream' },
  playstation: { label: 'PlayStation', fps: 60, audioGetter: 'getPlayStationAudioStream' },
  saturn: { label: 'Saturn', fps: 60, audioGetter: 'getSaturnAudioStream' },
  arcade: { label: 'Arcade', fps: 60, audioGetter: 'getArcadeAudioStream' },
  atari8: { label: 'Atari 8-bit', fps: 60, audioGetter: 'getRecordingAudioStream' },
  saturn_beetle: { label: 'Saturn (Webretro)', fps: 60, audioGetter: 'getRecordingAudioStream' },
};

export function getEmulatorRecordingAdapter(system) {
  const adapter = ADAPTERS[system];
  if (!adapter) return { system, label: system || 'Unknown', supported: false, reason: 'No recording adapter is registered for this emulator.' };
  return { system, supported: adapter.supported !== false, ...adapter };
}

export function getAdapterAudioStream(adapter, frameWindow) {
  if (!adapter?.supported || !frameWindow) return null;
  const getter = frameWindow[adapter.audioGetter] || frameWindow[adapter.fallbackAudioGetter];
  return typeof getter === 'function' ? getter.call(frameWindow) : null;
}

export const EMULATOR_RECORDING_ADAPTERS = ADAPTERS;
