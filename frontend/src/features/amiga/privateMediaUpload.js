export const HDF_UPLOAD_BYTES = 1024 * 1024 * 1024;
export const MEDIA_UPLOAD_BYTES = 128 * 1024 * 1024;
export const SESSION_MEDIA_BYTES = 1152 * 1024 * 1024;
export const LOCAL_FOLDER_BYTES = 512 * 1024 * 1024;
export const LOCAL_FOLDER_FILES = 20000;

export function validateMediaSize(file, kind) {
  const limit = kind === 'hdf' ? HDF_UPLOAD_BYTES : MEDIA_UPLOAD_BYTES;
  if (!file.size || file.size > limit) {
    throw new Error(`${file.name || 'Selected file'} is ${(file.size / 1024 / 1024).toFixed(1)} MiB. ${kind.toUpperCase()} imports must be between 1 byte and ${limit / 1024 / 1024} MiB.`);
  }
}

export function uploadPrivateMedia({ url, token, file, onProgress, onRequest, createRequest = () => new XMLHttpRequest() }) {
  return new Promise((resolve, reject) => {
    const request = createRequest();
    request.open('POST', url);
    request.timeout = 15 * 60 * 1000;
    request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100));
    };
    request.onerror = () => reject(new Error('Upload failed: connection lost. Check your connection and try again.'));
    request.onabort = () => reject(new Error('Upload cancelled.'));
    request.ontimeout = () => reject(new Error('Upload timed out. Try Use Local HDF to load the file without uploading.'));
    request.onload = () => {
      let data;
      try { data = JSON.parse(request.responseText); } catch { /* A proxy may return HTML. */ }
      if (request.status < 200 || request.status >= 300) {
        const message = request.status === 413
          ? 'The server rejected this upload as too large (HTTP 413). HDF uploads support 1 GiB in the application; the reverse proxy must also allow that size. For nginx, set client_max_body_size 1100m for /auth/admin/amiga/.'
          : request.status === 401 ? 'Your login expired. Sign in again, then retry the import.'
            : `Upload failed (HTTP ${request.status}).`;
        reject(new Error(typeof data?.detail === 'string' ? data.detail : message));
      } else if (!data?.id) {
        reject(new Error('The upload did not reach the media API. Check the /auth/admin/amiga/ reverse proxy route.'));
      } else {
        resolve(data);
      }
    };
    onRequest?.(request);
    request.send(file);
  });
}

export async function inspectLocalHdf(file) {
  validateMediaSize(file, 'hdf');
  // Read just the disk header here. The full HDF is read only when starting PUAE.
  const header = new Uint8Array(await file.slice(0, 16 * 512).arrayBuffer());
  let rdb = false;
  for (let offset = 0; offset + 4 <= header.length; offset += 512) {
    if (header[offset] === 82 && header[offset + 1] === 68 && header[offset + 2] === 83 && header[offset + 3] === 75) rdb = true;
  }
  return { source: 'local', local_name: file.name, local_size: file.size,
    geometry: rdb ? 'rdb' : 'manual', mode: 'ro', sectors: 32, surfaces: 1, reserved: 2, block_size: 512 };
}

export function inspectLocalFolder(files) {
  if (!files.length || files.length > LOCAL_FOLDER_FILES) throw new Error(`Choose a folder with 1 to ${LOCAL_FOLDER_FILES} files.`);
  const name = files[0].webkitRelativePath?.split('/')[0];
  if (!name) throw new Error('Choose a folder using the directory selector.');
  const aliases = new Map();
  const seen = new Set();
  let total = 0;
  const entries = files.map(file => {
    const parts = (file.webkitRelativePath || '').split('/');
    if (parts.shift() !== name || !parts.length || parts.join('/').length > 512 || parts.some(part => !part || part === '.' || part === '..' || /[\\:"\x00-\x1f]/.test(part))) {
      throw new Error('The folder contains an invalid Amiga filename or relative path.');
    }
    const path = parts.join('/');
    if (seen.has(path.toLowerCase())) throw new Error('Folder filenames collide ignoring case.');
    seen.add(path.toLowerCase());
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');
      const folded = prefix.toLowerCase();
      if (aliases.has(folded) && aliases.get(folded) !== prefix) throw new Error('Folder filenames collide ignoring case.');
      aliases.set(folded, prefix);
    }
    total += file.size;
    if (total > LOCAL_FOLDER_BYTES) throw new Error('Local folder exceeds 512 MiB. Choose a smaller software subfolder.');
    return { path, file };
  });
  return { name, entries, size: total, metadata: { source: 'local', local_kind: 'folder', local_name: name, local_size: total, local_count: entries.length, mode: 'ro' } };
}
