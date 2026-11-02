// Pure helper: which state the in-game achievements side panel should show.
// Views: 'online' | 'loading' | 'notConnected' | 'error' | 'unsupported' | 'ready'.
export function deriveAchievementsView({ solo, connected, signedIn, itemCount, problem }) {
  if (!solo) return 'online';
  if (itemCount > 0) return 'ready';
  if (connected === false) return 'notConnected';
  if (problem === 'error') return 'error';
  if (problem === 'nogame') return 'unsupported';
  return 'loading';
}

/** Unlocked count and points for a list of snapshot items. */
export function summariseAchievements(items) {
  const list = Array.isArray(items) ? items : [];
  let unlocked = 0;
  let points = 0;
  let totalPoints = 0;
  list.forEach((item) => {
    const value = Number(item.points) || 0;
    totalPoints += value;
    if (item.unlocked) { unlocked += 1; points += value; }
  });
  return { unlocked, total: list.length, points, totalPoints };
}
