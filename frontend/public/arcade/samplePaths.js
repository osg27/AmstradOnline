// MAME sample layout shared by the arcade launcher and its unit tests.
//
// The mame2003-plus core (src/fileio.c osd_get_path) resolves FILETYPE_SAMPLE
// relative to its libretro system directory. With the core option
// "Locate System Files Within a Subfolder" enabled, that is
// <system>/mame2003-plus/samples; disabled, it is <system>/samples. The core
// only reads the option from the core option file, and it only loads sample
// zips when "Use Samples" is enabled. The launcher therefore pins both options
// and writes the zips to both directories, so a missing or changed default in
// the core build cannot silently hide the samples.

export const ARCADE_SYSTEM_DIRECTORY = '/home/web_user/retroarch/system';
export const ARCADE_CORE_SUBFOLDER = 'mame2003-plus';
export const ARCADE_CORE_OPTION_FILE = '/home/web_user/retroarch/userdata/config/mame2003-plus/mame2003-plus.opt';

export const REQUIRED_SAMPLE_CORE_OPTIONS = Object.freeze({
  'mame2003-plus_use_samples': 'enabled',
  'mame2003-plus_core_sys_subfolder': 'enabled',
});

export function sampleFileName(fileName) {
  const base = String(fileName || '').split(/[\\/]/).pop();
  return /\.zip$/i.test(base) ? base : '';
}

// The first entry is where the core looks when its subfolder option is enabled.
export function sampleDirectories() {
  return [
    `${ARCADE_SYSTEM_DIRECTORY}/${ARCADE_CORE_SUBFOLDER}/samples`,
    `${ARCADE_SYSTEM_DIRECTORY}/samples`,
  ];
}

export function buildSampleRawFiles(samples) {
  const rawFiles = {};
  for (const sample of samples || []) {
    const name = sampleFileName(sample?.fileName);
    if (!name || !sample?.bytes?.length) continue;
    for (const directory of sampleDirectories()) {
      rawFiles[`${directory}/${name}`] = sample.bytes;
    }
  }
  return rawFiles;
}

// Reads the sizes back from the Emscripten filesystem the core is running on.
// This is what proves a sample is where the core will look, rather than
// trusting that the launcher wrote it.
export function describeSampleFiles(fs, samples) {
  const statSize = (path) => {
    try {
      return fs.stat(path).size;
    } catch {
      return null;
    }
  };
  return (samples || [])
    .map((sample) => {
      const name = sampleFileName(sample?.fileName);
      if (!name) return null;
      const locations = sampleDirectories().map((directory) => {
        const path = `${directory}/${name}`;
        const size = statSize(path);
        return { path, present: size !== null, size };
      });
      const expectedSize = sample?.bytes?.length || 0;
      const coreLocation = locations[0];
      return {
        name,
        expectedSize,
        locations,
        atCorePath: coreLocation.present && coreLocation.size === expectedSize,
      };
    })
    .filter(Boolean);
}

// Parses the core option file the core asks the frontend to write
// (lines of: key = "value"). Used to confirm the pinned values reached the core.
export function parseCoreOptionFile(text) {
  const values = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = /^\s*([^=\s]+)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

export function missingRequiredCoreOptions(values) {
  return Object.entries(REQUIRED_SAMPLE_CORE_OPTIONS)
    .filter(([key, expected]) => values?.[key] !== expected)
    .map(([key, expected]) => ({ key, expected, actual: values?.[key] ?? null }));
}
