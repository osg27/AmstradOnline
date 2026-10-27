import { describe, expect, it } from 'vitest';
import { validateMediaSize, uploadPrivateMedia, inspectLocalHdf, inspectLocalFolder } from './privateMediaUpload';

describe('private Amiga media imports', () => {
  it('accepts the 512000 KiB Workbench image without increasing folder limits', () => {
    const image = { name: 'System_P96.hdf', size: 512000 * 1024 };
    expect(() => validateMediaSize(image, 'hdf')).not.toThrow();
    expect(() => validateMediaSize(image, 'folder')).toThrow('128 MiB');
    expect(() => validateMediaSize({ ...image, size: 1024 ** 3 + 1 }, 'hdf')).toThrow('1024 MiB');
  });

  function upload(status, responseText, onProgress) {
    const headers = {};
    const request = { upload: {}, status, responseText,
      open(method, url) { expect(method).toBe('POST'); expect(url).toBe('/private-assets'); },
      setRequestHeader(key, value) { headers[key] = value; },
      send() {
        request.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
        request.onload();
      },
    };
    return { headers, result: uploadPrivateMedia({ url: '/private-assets', token: 'private-token',
      file: {}, onProgress, createRequest: () => request }) };
  }

  it('reports upload progress and returns only a confirmed private asset', async () => {
    const progress = [];
    const { result, headers } = upload(200, '{"id":"asset-id","name":"System_P96.hdf"}', value => progress.push(value));
    await expect(result).resolves.toMatchObject({ id: 'asset-id' });
    expect(progress).toEqual([50]);
    expect(headers.Authorization).toBe('Bearer private-token');
  });

  it('explains a proxy HTML rejection instead of silently losing the upload', async () => {
    await expect(upload(413, '<html>Request Entity Too Large</html>').result).rejects.toThrow('client_max_body_size 1100m');
  });

  it('reports an API rejection and a misrouted successful HTML response', async () => {
    await expect(upload(413, '{"detail":"Storage quota exceeded"}').result).rejects.toThrow('Storage quota exceeded');
    await expect(upload(200, '<html>App shell</html>').result).rejects.toThrow('did not reach the media API');
  });

  it('inspects a local HDF header without reading or uploading the full disk', async () => {
    const reads = [];
    const file = { name: 'System_P96.hdf', size: 512000 * 1024,
      slice(start, end) {
        reads.push([start, end]);
        const bytes = new Uint8Array(8192);
        bytes.set(new TextEncoder().encode('RDSK'), 512);
        return { arrayBuffer: async () => bytes.buffer };
      },
    };
    expect(await inspectLocalHdf(file)).toMatchObject({ source: 'local', local_name: 'System_P96.hdf', local_size: file.size, geometry: 'rdb', mode: 'ro' });
    expect(reads).toEqual([[0, 8192]]);
    expect((await inspectLocalHdf(new File(['DOS\x01'], 'Workbench.hdf'))).geometry).toBe('manual');
  });

  it('allows cancelling a pending upload and reports timeout', async () => {
    let pending;
    const createRequest = () => ({ upload: {}, open() {}, setRequestHeader() {}, send() {}, abort() { this.onabort(); } });
    const cancelled = uploadPrivateMedia({ url: '/private-assets', file: {}, createRequest, onRequest: request => { pending = request; } });
    pending.abort();
    await expect(cancelled).rejects.toThrow('Upload cancelled');
    const timedOut = uploadPrivateMedia({ url: '/private-assets', file: {}, createRequest, onRequest: request => { pending = request; } });
    pending.ontimeout();
    await expect(timedOut).rejects.toThrow('Use Local HDF');
  });

  it('selects a local software folder without reading contents or creating an upload', () => {
    const files = [
      { webkitRelativePath: 'Software/Moonstone/Game/Data', size: 10 },
      { webkitRelativePath: 'Software/Moonstone.info', size: 2 },
    ];
    const folder = inspectLocalFolder(files);
    expect(folder.entries.map(entry => entry.path)).toEqual(['Moonstone/Game/Data', 'Moonstone.info']);
    expect(folder.entries[0].file).toBe(files[0]);
    expect(folder.metadata).toMatchObject({ source: 'local', local_kind: 'folder', local_name: 'Software', local_size: 12, local_count: 2, mode: 'ro' });
    expect(JSON.stringify(folder.metadata)).not.toContain('Moonstone');
  });

  it('rejects local folder traversal and case aliases including parent directories', () => {
    expect(() => inspectLocalFolder([{ webkitRelativePath: 'Software/../secret', size: 1 }])).toThrow('invalid');
    expect(() => inspectLocalFolder([
      { webkitRelativePath: 'Software/Game/Data', size: 1 },
      { webkitRelativePath: 'Software/game/Icon', size: 1 },
    ])).toThrow('collide');
  });

  it('checks local folder resource limits before reading any file', () => {
    expect(() => inspectLocalFolder([{ webkitRelativePath: 'Software/Data', size: 513 * 1024 * 1024 }])).toThrow('512 MiB');
    expect(() => inspectLocalFolder(new Array(20001).fill({}))).toThrow('20000');
    expect(inspectLocalFolder([{ webkitRelativePath: 'Software/EmptyFile', size: 0 }]).size).toBe(0);
  });
});
