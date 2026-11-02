// Game rules: Mastermind scoring, timing and what the browser is allowed to see. No HTTP in here.
import { DIFF } from './config.js';

// Mastermind feedback. exact = right digit in the right place, partial = right digit in the wrong place.
// Repeated digits are counted correctly: each digit of the secret can be matched only once.
export function scoreGuess(secret, guess) {
  let exact = 0;
  const left = [];  // secret digits not matched exactly
  const rest = [];  // guess digits not matched exactly
  secret.forEach((d, i) => { if (guess[i] === d) exact++; else { left.push(d); rest.push(guess[i]); } });
  let partial = 0;
  for (const d of rest) {
    const k = left.indexOf(d);
    if (k >= 0) { partial++; left.splice(k, 1); }
  }
  return { exact, partial };
}

export function createGame({ timeLimitMs, bus }) {
  const limitMs = (g) => timeLimitMs ?? DIFF[g.difficulty].seconds * 1000;
  const secondsLeft = (g) => Math.max(0, Math.ceil((limitMs(g) - (Date.now() - g.issuedAt)) / 1000));
  const expired = (g) => Date.now() - g.issuedAt > limitMs(g);
  const attemptsLeft = (g) => DIFF[g.difficulty].attempts - g.history.length;

  // What the browser may see: never the secret code, only the digits the player paid to reveal.
  const view = (g) => ({
    lives: g.lives, score: g.score, streak: g.streak, difficulty: g.difficulty,
    hints: g.hints, skips: g.skips, length: g.secret.length,
    guesses: g.history, attempts: DIFF[g.difficulty].attempts, revealed: g.revealed,
    api: g.api, seconds: secondsLeft(g), total: Math.round(limitMs(g) / 1000),
  });

  // End of a code: cracked, out of guesses, or out of time.
  // Points: (100 + 10 per unused guess + seconds left) x level x streak bonus (+25% per streak step, max +100%), halved if a digit was revealed.
  function settle(user, g, solved, timedOut) {
    const points = solved ? Math.round((100 + 10 * attemptsLeft(g) + secondsLeft(g)) * DIFF[g.difficulty].mult * (1 + 0.25 * Math.min(g.streak, 4)) * (g.hinted ? 0.5 : 1)) : 0;
    const streak = solved ? g.streak + 1 : 0;
    const next = { ...g, lives: g.lives - (solved ? 0 : 1), score: g.score + points, streak, bestStreak: Math.max(g.bestStreak, streak), secret: null };
    const over = next.lives <= 0;
    bus.emit('score', { user, score: next.score });
    bus.emit('answer', { user, correct: solved, guesses: g.history.length, streak });
    if (over) bus.emit('game:over', { user, score: next.score, difficulty: g.difficulty });
    else if (solved && streak % 5 === 0) bus.emit('streak', { user, streak });
    return {
      next,
      // once a code is over the player may see the four Banana puzzles it was made from
      result: { done: true, solved, timedOut, secret: g.secret, puzzles: g.secret.map((digit, i) => ({ digit, image: g.images?.[i] ?? null })), guesses: g.history, points, score: next.score, lives: next.lives, streak, bestStreak: next.bestStreak, over },
    };
  }

  return { limitMs, expired, view, settle, attemptsLeft };
}
