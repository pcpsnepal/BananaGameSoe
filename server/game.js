// Game rules: timing, scoring and what the browser is allowed to see. No HTTP in here.
import { DIFF } from './config.js';

export function createGame({ timeLimitMs, bus }) {
  const limitMs = (g) => timeLimitMs ?? DIFF[g.difficulty].seconds * 1000;
  const secondsLeft = (g) => Math.max(0, Math.ceil((limitMs(g) - (Date.now() - g.issuedAt)) / 1000));
  const expired = (g) => Date.now() - g.issuedAt > limitMs(g);

  // What the browser may see: never the solution.
  const view = (g) => ({
    image: g.image, lives: g.lives, score: g.score, streak: g.streak, difficulty: g.difficulty,
    hints: g.hints, skips: g.skips, removed: g.removed, api: g.api, seconds: secondsLeft(g), total: Math.round(limitMs(g) / 1000),
  });

  // Score one puzzle. Points: (10 + seconds left) x difficulty x streak bonus (+25% per streak step, max +100%), halved if the hint was used.
  function settle(user, g, correct, timedOut) {
    const points = correct ? Math.round((10 + secondsLeft(g)) * DIFF[g.difficulty].mult * (1 + 0.25 * Math.min(g.streak, 4)) * (g.hinted ? 0.5 : 1)) : 0;
    const streak = correct ? g.streak + 1 : 0;
    const next = { ...g, lives: g.lives - (correct ? 0 : 1), score: g.score + points, streak, bestStreak: Math.max(g.bestStreak, streak), solution: null };
    const over = next.lives <= 0;
    bus.emit('score', { user, score: next.score });
    bus.emit('answer', { user, correct, elapsedMs: Date.now() - g.issuedAt, streak });
    if (over) bus.emit('game:over', { user, score: next.score, difficulty: g.difficulty });
    else if (correct && streak % 5 === 0) bus.emit('streak', { user, streak });
    return { next, result: { correct, timedOut, solution: g.solution, points, score: next.score, lives: next.lives, streak, bestStreak: next.bestStreak, over } };
  }

  return { limitMs, expired, view, settle };
}
