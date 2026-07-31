import { resolveRelease } from '../storage/preferredReleaseStorage';
import { registerRuntimeRelease } from '../storage/runtimeFileRegistry';

export function orderedReleaseFiles(release) {
  if (!release?.media?.length) throw new Error('This release has no media files.');
  return [...release.media]
    .sort((left, right) => (left.diskNumber || 1) - (right.diskNumber || 1)
      || left.name.localeCompare(right.name, undefined, { numeric: true }))
    .map((item) => item.file);
}

export function prepareLocalGameLaunch(game, storage = window.localStorage) {
  const release = resolveRelease(game, storage);
  if (!release) throw new Error('No playable release is available.');
  const files = orderedReleaseFiles(release);
  const launchId = `local-amiga:${game.id}:${release.id}:${Date.now()}`;
  const machine = release.metadata.machine || [];
  const resolvedModel = release.amiga?.launchConfiguration?.model || release.metadata.amigaModel || '';
  const roomSystem = game.platform === 'amiga'
    ? (machine.includes('AGA') || machine.includes('CD32') || resolvedModel === 'A1200' ? 'amiga_aga' : 'amiga')
    : game.platform === 'c64'
      ? 'c64'
      : game.platform === 'spectrum'
        ? 'spectrum'
        : game.platform === 'amstrad'
          ? 'cpc'
          : null;
  if (!roomSystem) throw new Error(`There is no local player adapter for ${game.platform}.`);
  registerRuntimeRelease(launchId, {
    gameId: game.id,
    releaseId: release.id,
    title: game.title,
    files,
    roomSystem,
    amigaManifest: release.amiga?.manifest || null,
  });
  return { launchId, release, files, roomSystem };
}
