const releases = new Map();

export function registerRuntimeRelease(key, release) {
  releases.set(key, {
    ...release,
    files: [...release.files],
  });
}

export function takeRuntimeRelease(key) {
  const release = releases.get(key) || null;
  releases.delete(key);
  return release;
}

export function clearRuntimeReleases() {
  releases.clear();
}
