// PC folders are linked in this browser's local library database. Their add and
// unlink actions must work even when account-synced URL sources have not loaded
// (offline, backend error, or connected-sources storage unavailable). Only URL
// source actions depend on the account catalogue, because saving a list that was
// never loaded would overwrite the account's saved sources.

export function sourceManagerState({ sourcesReady, busy }) {
  const idle = !busy;
  return {
    folderActionsEnabled: idle,
    urlActionsEnabled: idle && Boolean(sourcesReady),
    notice: sourcesReady ? '' : 'Account URL sources are still loading. PC folders can still be added and unlinked.',
  };
}

export function assertAccountSourcesReady(sourcesReady) {
  if (!sourcesReady) {
    throw new Error('Account URL sources are still loading. Try again in a moment.');
  }
}
