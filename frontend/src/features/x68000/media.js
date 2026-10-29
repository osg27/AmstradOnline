import { unzipSync } from 'fflate';

const MEDIA = /\.(dim|img|d88|88d|hdm|dup|2hd|xdf|hdf|cmd|m3u)$/i;

export function prepareX68000Media(message) {
  const bytes = new Uint8Array(message.bytes || []);
  let files = /\.zip$/i.test(message.fileName || '')
    ? Object.entries(unzipSync(bytes)).map(([fileName, data]) => ({ fileName, bytes: data }))
    : message.files?.length ? message.files : [{ fileName: message.fileName, bytes }];
  files = files.map((file) => {
    const fileName = String(file.fileName || '').replaceAll('\\', '/');
    if (fileName.startsWith('/') || fileName.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error('The game contains an unsafe disk path.');
    }
    return { fileName, bytes: new Uint8Array(file.bytes || []) };
  }).filter((file) => MEDIA.test(file.fileName) && file.bytes.length);
  if (!files.length) throw new Error('No supported X68000 disk images found.');
  const selected = files.find((file) => /\.(m3u|cmd)$/i.test(file.fileName))
    || files.find((file) => /\.hdf$/i.test(file.fileName));
  if (selected || files.length === 1) return { files, primary: (selected || files[0]).fileName };
  const playlist = 'osg-disks.m3u';
  return {
    files: [...files, { fileName: playlist, bytes: new TextEncoder().encode(files.map((file) => file.fileName).join('\n')) }],
    primary: playlist,
  };
}

export function x68000JoyBits(mask) {
  return [[1, 4], [2, 5], [4, 6], [8, 7], [16, 8], [32, 0], [64, 3], [128, 2]]
    .reduce((bits, [source, target]) => bits | (mask & source ? 1 << target : 0), 0);
}

export function x68000KeyboardJoystickBit(key) {
  const keys = { ArrowUp: 1, q: 1, ArrowDown: 2, a: 2, ArrowLeft: 4, o: 4, ArrowRight: 8, p: 8, x: 16, f: 16, z: 32, g: 32, Enter: 64, c: 128 };
  return keys[key] || keys[String(key).toLowerCase()] || 0;
}
