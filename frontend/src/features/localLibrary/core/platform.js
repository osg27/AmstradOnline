export const LOCAL_LIBRARY_PLATFORM = 'amiga';

const EXTENSIONS = {
  amiga: new Set(['adf', 'adz', 'dms', 'ipf', 'hdf', 'lha', 'slave', 'zip']),
  c64: new Set(['d64', 'g64', 'f64', 't64', 'p00', 'p01', 'prg', 'crt', 'tap', 'zip']),
  spectrum: new Set(['tap', 'tzx', 'z80', 'sna', 'zip']),
  amstrad: new Set(['dsk', 'cdt', 'zip']),
  x68000: new Set(['dim', 'img', 'd88', '88d', 'hdm', 'dup', '2hd', 'xdf', 'hdf', 'cmd', 'm3u', 'zip']),
};

export function isSupportedExtension(extension, platform = LOCAL_LIBRARY_PLATFORM) {
  return EXTENSIONS[platform]?.has(String(extension).toLowerCase()) || false;
}

export function detectPlatform(extension, requestedPlatform) {
  if (requestedPlatform && EXTENSIONS[requestedPlatform]) return requestedPlatform;
  const normalized = String(extension).toLowerCase();
  if (normalized === 'zip') return 'unknown';
  return Object.entries(EXTENSIONS).find(([, extensions]) => extensions.has(normalized))?.[0] || 'unknown';
}
