export function createManifest(games) {
  return {
    libraryVersion: 1,
    generatedAt: new Date().toISOString(),
    gameCount: games.length,
    releaseCount: games.reduce((total, game) => total + game.releases.length, 0),
    games: games.map((game) => ({
      id: game.id,
      title: game.title,
      platform: game.platform,
      defaultReleaseId: game.defaultReleaseId,
      warnings: game.warnings,
      releases: game.releases.map((release) => ({
        id: release.id,
        label: release.label,
        score: release.score,
        isComplete: release.isComplete,
        metadata: release.metadata,
        warnings: release.warnings,
        media: release.media.map((item) => ({
          path: item.path,
          name: item.name,
          size: item.size,
          hash: item.sha256,
          disk: item.diskNumber,
          diskCount: item.diskCount,
          role: item.diskRole,
        })),
      })),
    })),
  };
}

