import { apiFetch } from './client';

export async function submitScore(game, system, score, inputReplay = null) {
  return apiFetch('/scores/submit', {
    method: 'POST',
    body: JSON.stringify({
      game,
      system,
      score,
      input_replay: inputReplay,
    }),
  });
}

export async function getLeaderboard(system, game, limit = 100) {
  return apiFetch(`/scores/leaderboard/${system}/${game}?limit=${limit}`);
}

export async function getPersonalScores(system, game) {
  return apiFetch(`/scores/personal/${system}/${game}`);
}
