export const AMIGA_ROM_SOURCE = Object.freeze({
  ORIGINAL: 'original',
  AROS: 'aros',
});

const AROS_FLOPPY_EXTENSIONS = /\.(adf|adz|dms)$/i;

export function isExperimentalArosEnabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

export function resolveAmigaRomSource({ featureEnabled = false, requestedSource = '', media = [] } = {}) {
  if (!featureEnabled || String(requestedSource).toLowerCase() !== AMIGA_ROM_SOURCE.AROS) {
    return { source: AMIGA_ROM_SOURCE.ORIGINAL, reason: 'default' };
  }

  const fileNames = media.map((item) => String(item?.fileName || item?.name || ''));
  if (!fileNames.length || !fileNames.every((fileName) => AROS_FLOPPY_EXTENSIONS.test(fileName))) {
    return { source: AMIGA_ROM_SOURCE.ORIGINAL, reason: 'unsupported-media' };
  }

  return { source: AMIGA_ROM_SOURCE.AROS, reason: 'explicit-experimental-selection' };
}
