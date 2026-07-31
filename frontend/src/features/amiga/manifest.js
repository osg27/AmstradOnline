import { AMIGA_RESOLVER_VERSION } from './configuration';

export function createAmigaLaunchManifest({ gameId, releaseId, media, config, kickstart, coreVersion = 'puae-local-2026-06-13' }) {
  return {
    version: 1, canonicalGameId: gameId, releaseId,
    media: [...media].sort((a, b) => a.diskNumber - b.diskNumber).map((item) => ({ sha1: item.sha1, diskNumber: item.diskNumber })),
    profile: { model: config.model, chipset: config.chipset, videoStandard: config.videoStandard, chipMemoryMb: config.chipMemoryMb, fastMemoryMb: config.fastMemoryMb, floppyDriveCount: config.floppyDriveCount },
    kickstart: { id: config.kickstartId, sha1: kickstart.sha1 }, coreVersion,
    diskState: { selected: 0, drive: 'DF0' }, ports: { 0: config.port0, 1: config.port1 }, resolverVersion: AMIGA_RESOLVER_VERSION,
  };
}
