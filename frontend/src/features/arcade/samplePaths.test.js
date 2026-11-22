import { describe, expect, it } from 'vitest';
import {
  ARCADE_SYSTEM_DIRECTORY,
  buildSampleRawFiles,
  describeSampleFiles,
  missingRequiredCoreOptions,
  parseCoreOptionFile,
  sampleDirectories,
  sampleFileName,
} from '../../../public/arcade/samplePaths.js';

// Mirrors the Emscripten FS calls the launcher makes: stat() throws when missing.
function fakeFs(files) {
  return {
    stat(path) {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      return { size: files[path].length };
    },
  };
}

const dkongSamples = [{ fileName: 'dkong.zip', bytes: new Uint8Array([1, 2, 3, 4]) }];

describe('MAME sample layout', () => {
  it('uses the directory the mame2003-plus core resolves for samples', () => {
    // fileio.c osd_get_path(FILETYPE_SAMPLE): <system>/<APPNAME>/samples when the
    // system-subfolder option is enabled, where APPNAME is "mame2003-plus".
    expect(sampleDirectories()[0]).toBe(`${ARCADE_SYSTEM_DIRECTORY}/mame2003-plus/samples`);
    expect(sampleDirectories()[1]).toBe(`${ARCADE_SYSTEM_DIRECTORY}/samples`);
  });

  it('keeps only zip names and strips any directory part', () => {
    expect(sampleFileName('C:\\roms\\samples\\dkong.zip')).toBe('dkong.zip');
    expect(sampleFileName('dkong.7z')).toBe('');
    expect(sampleFileName('')).toBe('');
  });

  it('stages each sample into every candidate directory with the same bytes', () => {
    const rawFiles = buildSampleRawFiles(dkongSamples);
    expect(Object.keys(rawFiles).sort()).toEqual([
      `${ARCADE_SYSTEM_DIRECTORY}/mame2003-plus/samples/dkong.zip`,
      `${ARCADE_SYSTEM_DIRECTORY}/samples/dkong.zip`,
    ]);
    expect(rawFiles[sampleDirectories()[0] + '/dkong.zip']).toBe(dkongSamples[0].bytes);
  });

  it('skips empty or non-zip samples instead of staging them', () => {
    const rawFiles = buildSampleRawFiles([
      { fileName: 'empty.zip', bytes: new Uint8Array() },
      { fileName: 'readme.txt', bytes: new Uint8Array([1]) },
      { fileName: undefined, bytes: new Uint8Array([1]) },
    ]);
    expect(rawFiles).toEqual({});
  });

  it('reports a sample as at the core path only when it is there with the right size', () => {
    const [coreDir, fallbackDir] = sampleDirectories();
    const present = describeSampleFiles(fakeFs({ [`${coreDir}/dkong.zip`]: new Uint8Array(4) }), dkongSamples);
    expect(present[0].atCorePath).toBe(true);

    const wrongSize = describeSampleFiles(fakeFs({ [`${coreDir}/dkong.zip`]: new Uint8Array(2) }), dkongSamples);
    expect(wrongSize[0].atCorePath).toBe(false);

    const onlyFallback = describeSampleFiles(fakeFs({ [`${fallbackDir}/dkong.zip`]: new Uint8Array(4) }), dkongSamples);
    expect(onlyFallback[0].atCorePath).toBe(false);
    expect(onlyFallback[0].locations.map((l) => l.present)).toEqual([false, true]);
  });

  it('parses the core option file and flags values the core did not apply', () => {
    const text = [
      'mame2003-plus_autosave_hiscore = "recursively"',
      'mame2003-plus_use_samples = "enabled"',
      'mame2003-plus_core_sys_subfolder = "disabled"',
    ].join('\n');
    const values = parseCoreOptionFile(text);
    expect(values['mame2003-plus_use_samples']).toBe('enabled');
    expect(missingRequiredCoreOptions(values)).toEqual([
      { key: 'mame2003-plus_core_sys_subfolder', expected: 'enabled', actual: 'disabled' },
    ]);
  });

  it('reports every required option as missing when the core option file is absent', () => {
    expect(missingRequiredCoreOptions({})).toHaveLength(2);
  });
});
