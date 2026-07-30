const PREFIX = 'local-library:preferred-release';

export function preferredReleaseKey(platform, gameId) {
  return `${PREFIX}:${platform}:${gameId}`;
}

export function getPreferredRelease(game, storage = window.localStorage) {
  const key = preferredReleaseKey(game.platform, game.id);
  const storedId = storage.getItem(key);
  if (!storedId) return null;
  const release = game.releases.find((candidate) => candidate.id === storedId);
  if (!release) {
    storage.removeItem(key);
    return null;
  }
  return release;
}

export function setPreferredRelease(game, releaseId, storage = window.localStorage) {
  if (!game.releases.some((release) => release.id === releaseId)) {
    throw new Error('That release is no longer part of this game.');
  }
  storage.setItem(preferredReleaseKey(game.platform, game.id), releaseId);
}

export function resolveRelease(game, storage = window.localStorage) {
  return getPreferredRelease(game, storage)
    || game.releases.find((release) => release.id === game.defaultReleaseId)
    || game.releases.find((release) => release.isComplete)
    || game.releases[0]
    || null;
}

