// Player statistics and badges. Pure functions (no I/O) so the rules are easy to test.
export const AVATARS = ['🍌', '🐵', '🦍', '🐒', '🍉', '🥥', '🌴', '🦜'];
export const DEFAULT_AVATAR = AVATARS[0];

export const BADGES = {
  first_banana: { name: 'First Banana', desc: 'Crack your first code' },
  sharp_mind: { name: 'Sharp Mind', desc: 'Crack a code in 3 guesses or fewer' },
  hot_streak: { name: 'Hot Streak', desc: 'Crack 5 codes in a row' },
  veteran: { name: 'Veteran', desc: 'Finish 10 games' },
};

export const newStats = () => ({ games: 0, total: 0, answered: 0, correct: 0, bestStreak: 0, fewestGuesses: null, badges: [] }); // answered/correct = codes played/cracked

// An answer (or timeout) was settled. Returns the new stats and the badges earned just now.
export function applyAnswer(stats, { correct, guesses, streak }) {
  const s = { ...newStats(), ...stats };
  const next = {
    ...s,
    answered: s.answered + 1,
    correct: s.correct + (correct ? 1 : 0),
    bestStreak: Math.max(s.bestStreak, streak),
    fewestGuesses: correct ? Math.min(s.fewestGuesses ?? Infinity, guesses) : s.fewestGuesses,
  };
  const earned = [];
  const award = (id, condition) => { if (condition && !s.badges.includes(id)) earned.push(id); };
  award('first_banana', correct);
  award('sharp_mind', correct && guesses <= 3);
  award('hot_streak', streak >= 5);
  return { stats: { ...next, badges: [...s.badges, ...earned] }, earned };
}

// A game finished (last life lost).
export function applyGameOver(stats, score) {
  const s = { ...newStats(), ...stats };
  const next = { ...s, games: s.games + 1, total: s.total + score };
  const earned = next.games >= 10 && !s.badges.includes('veteran') ? ['veteran'] : [];
  return { stats: { ...next, badges: [...s.badges, ...earned] }, earned };
}

// What the player sees on their profile page.
export function profileView(stats, best) {
  const s = { ...newStats(), ...stats };
  return {
    games_played: s.games,
    total_score: s.total,
    best_score: best ?? 0,
    accuracy: s.answered ? Math.round((s.correct / s.answered) * 100) : null, // percent of codes cracked
    best_streak: s.bestStreak,
    fewest_guesses: s.fewestGuesses,
    badges: Object.entries(BADGES).map(([id, b]) => ({ id, ...b, earned: s.badges.includes(id) })),
  };
}
