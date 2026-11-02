// Game endpoints. The secret code stays in the server-side session; the browser never receives it until the code is over.
import { DIFF, CODE_LENGTH, LIVES, HINTS, SKIPS, MAX_REVEALS } from '../config.js';
import { requireLogin } from './auth.js';
import { BADGES } from '../profile.js';
import { scoreGuess } from '../game.js';

export function gameRoutes(app, { game, getDigits, getQuote, store }) {
  const auth = { preHandler: requireLogin };
  const { limitMs, expired, view, settle, attemptsLeft } = game;

  // Start a new code: the secret is made of digits from the Banana API.
  async function withCode(g) {
    const c = await getDigits(CODE_LENGTH);
    return { ...g, secret: c.digits, images: c.images ?? [], api: { source: c.source, latencyMs: c.latencyMs }, history: [], revealed: [], hinted: false, issuedAt: Date.now() };
  }
  const unavailable = (reply) => reply.code(502).send({ error: 'Banana API unavailable' });

  // Settle a code, then tell the player about badges it earned (stats are updated synchronously by the event subscribers).
  function settleAndAward(user, g, solved, timedOut) {
    const had = new Set(store.stats.get(user)?.badges ?? []);
    const { next, result } = settle(user, g, solved, timedOut);
    const newBadges = (store.stats.get(user)?.badges ?? []).filter((id) => !had.has(id)).map((id) => ({ id, ...BADGES[id] }));
    return { next, result: { ...result, newBadges } };
  }
  // When a game ends, attach a motivational quote (external API with local fallback).
  const finish = async (result) => (result.over ? { ...result, quote: await getQuote() } : result);

  app.post('/api/game', auth, async (req, reply) => {
    const difficulty = req.body?.difficulty;
    if (!DIFF[difficulty]) return reply.code(400).send({ error: 'difficulty must be easy, normal or hard' });
    try {
      const g = await withCode({ difficulty, lives: LIVES, score: 0, streak: 0, bestStreak: 0, hints: HINTS, skips: SKIPS });
      req.session.game = g;
      return view(g);
    } catch {
      return unavailable(reply);
    }
  });

  // Current code (the same one after a page reload, so reloading cannot dodge the timer) or a new one.
  app.get('/api/round', auth, async (req, reply) => {
    let g = req.session.game;
    if (g && g.lives <= 0) g = req.session.game = null;
    if (!g) return reply.code(409).send({ error: 'no active game' });
    if (g.secret != null) {
      if (!expired(g)) return view(g);
      const { next, result } = settleAndAward(req.session.user, g, false, true);
      req.session.game = next;
      return { result: await finish(result) };
    }
    try {
      g = await withCode(g);
    } catch {
      return unavailable(reply);
    }
    req.session.game = g;
    return view(g);
  });

  // One guess: an array of CODE_LENGTH digits, or {timeout:true} when the browser's clock ran out.
  app.post('/api/guess', auth, async (req, reply) => {
    const g = req.session.game;
    if (!g || g.secret == null) return reply.code(409).send({ error: 'no active code' });
    // The time limit is enforced here, not in the browser: a late guess counts as a timeout.
    // The client sends {timeout:true} when its countdown hits 0 (allowed 1s early for network/clock skew).
    const elapsed = Date.now() - g.issuedAt;
    const timedOut = elapsed > limitMs(g) || (req.body?.timeout === true && elapsed >= limitMs(g) - 1000);
    if (timedOut) {
      const { next, result } = settleAndAward(req.session.user, g, false, true);
      req.session.game = next;
      return finish(result);
    }
    const guess = req.body?.guess;
    if (!Array.isArray(guess) || guess.length !== CODE_LENGTH || !guess.every((d) => Number.isInteger(d) && d >= 0 && d <= 9)) {
      return reply.code(400).send({ error: `guess must be ${CODE_LENGTH} digits (0-9)` });
    }
    const feedback = scoreGuess(g.secret, guess);
    const withGuess = { ...g, history: [...g.history, { guess, ...feedback }] };
    const solved = feedback.exact === CODE_LENGTH;
    if (solved || attemptsLeft(withGuess) <= 0) {
      const { next, result } = settleAndAward(req.session.user, withGuess, solved, false);
      req.session.game = next;
      return finish(result);
    }
    req.session.game = withGuess;
    return { done: false, ...feedback, attemptsLeft: attemptsLeft(withGuess) };
  });

  // Power-up: reveal one digit of the code (up to MAX_REVEALS). Halves the points for this code.
  app.post('/api/hint', auth, async (req, reply) => {
    const g = req.session.game;
    if (!g || g.secret == null || expired(g)) return reply.code(409).send({ error: 'no active code' });
    if (g.hints <= 0 || g.revealed.length >= MAX_REVEALS) return reply.code(409).send({ error: 'no reveal available' });
    const hidden = g.secret.map((_, i) => i).filter((i) => !g.revealed.some((r) => r.index === i));
    const index = hidden[Math.floor(Math.random() * hidden.length)];
    const revealed = [...g.revealed, { index, digit: g.secret[index], image: g.images?.[index] ?? null }]; // the puzzle behind this digit
    req.session.game = { ...g, hinted: true, hints: g.hints - 1, revealed };
    return { revealed, hints: g.hints - 1 };
  });

  // Power-up: swap the code for a new one, no life lost and the streak is kept.
  app.post('/api/skip', auth, async (req, reply) => {
    const g = req.session.game;
    if (!g || g.secret == null || expired(g)) return reply.code(409).send({ error: 'no active code' });
    if (g.skips <= 0) return reply.code(409).send({ error: 'no skips left' });
    try {
      const n = await withCode({ ...g, skips: g.skips - 1 });
      req.session.game = n;
      return view(n);
    } catch {
      return unavailable(reply);
    }
  });
}
