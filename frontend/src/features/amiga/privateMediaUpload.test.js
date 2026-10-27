import { describe, expect, it } from 'vitest';
import { validateMediaSize, uploadPrivateMedia } from './privateMediaUpload';

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
});
