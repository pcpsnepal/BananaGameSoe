// Game endpoints. The solution stays in the server-side session; the browser only gets the image.
import { DIFF, LIVES, HINTS, SKIPS } from '../config.js';
import { requireLogin } from './auth.js';
import { BADGES } from '../profile.js';

export function gameRoutes(app, { game, getPuzzle, getQuote, store }) {
  const auth = { preHandler: requireLogin };
  const { limitMs, expired, view, settle } = game;

  // Attach a fresh puzzle from the Banana API to the game state.
  // ponytail: the image is kept in the in-memory session; fine for a handful of players.
  async function withPuzzle(g) {
    const p = await getPuzzle();
    return { ...g, image: p.image, solution: p.solution, api: { source: p.source, latencyMs: p.latencyMs }, issuedAt: Date.now(), removed: [], hinted: false };
  }
  // Settle an answer, then tell the player about badges that answer earned (stats are updated synchronously by the event subscribers).
  function settleAndAward(user, g, correct, timedOut) {
    const had = new Set(store.stats.get(user)?.badges ?? []);
    const { next, result } = settle(user, g, correct, timedOut);
    const newBadges = (store.stats.get(user)?.badges ?? []).filter((id) => !had.has(id)).map((id) => ({ id, ...BADGES[id] }));
    return { next, result: { ...result, newBadges } };
  }
  // When a game ends, attach a motivational quote (external API with local fallback).
  const finish = async (result) => (result.over ? { ...result, quote: await getQuote() } : result);
  const unavailable = (reply) => reply.code(502).send({ error: 'Banana API unavailable' });

  app.post('/api/game', auth, async (req, reply) => {
    const difficulty = req.body?.difficulty;
    if (!DIFF[difficulty]) return reply.code(400).send({ error: 'difficulty must be easy, normal or hard' });
    try {
      const g = await withPuzzle({ difficulty, lives: LIVES, score: 0, streak: 0, bestStreak: 0, hints: HINTS, skips: SKIPS });
      req.session.game = g;
      return view(g);
    } catch {
      return unavailable(reply);
    }
  });

  // Current puzzle (same one after a page reload, so reloading cannot dodge the timer) or the next one.
  app.get('/api/puzzle', auth, async (req, reply) => {
    let g = req.session.game;
    if (g && g.lives <= 0) g = req.session.game = null;
    if (!g) return reply.code(409).send({ error: 'no active game' });
    if (g.solution != null) {
      if (!expired(g)) return view(g);
      const { next, result } = settleAndAward(req.session.user, g, false, true);
      req.session.game = next;
      return { result: await finish(result) };
    }
    try {
      g = await withPuzzle(g);
    } catch {
      return unavailable(reply);
    }
    req.session.game = g;
    return view(g);
  });

  app.post('/api/answer', auth, async (req, reply) => {
    const g = req.session.game;
    if (!g || g.solution == null) return reply.code(409).send({ error: 'no active puzzle' });
    // Time limit is enforced here, not in the browser: a late answer counts as a timeout even if the digit is right.
    // The client sends {timeout:true} when its countdown hits 0 (allowed 1s early for network/clock skew).
    const elapsed = Date.now() - g.issuedAt;
    const timedOut = elapsed > limitMs(g) || (req.body?.timeout === true && elapsed >= limitMs(g) - 1000);
    const digit = Number(req.body?.digit);
    if (!timedOut && (!Number.isInteger(digit) || digit < 0 || digit > 9)) return reply.code(400).send({ error: 'digit 0-9 required' });
    const { next, result } = settleAndAward(req.session.user, g, !timedOut && digit === g.solution, timedOut);
    req.session.game = next;
    return finish(result);
  });

  // Power-up: remove 5 wrong digits. Costs half the points for this puzzle.
  app.post('/api/hint', auth, async (req, reply) => {
    const g = req.session.game;
    if (!g || g.solution == null || expired(g)) return reply.code(409).send({ error: 'no active puzzle' });
    if (g.hinted || g.hints <= 0) return reply.code(409).send({ error: 'no hint available' });
    const wrong = [...Array(10).keys()].filter((d) => d !== g.solution).sort(() => Math.random() - 0.5).slice(0, 5);
    req.session.game = { ...g, hinted: true, hints: g.hints - 1, removed: wrong };
    return { removed: wrong, hints: g.hints - 1 };
  });

  // Power-up: swap the puzzle for a new one, no life lost and the streak is kept.
  app.post('/api/skip', auth, async (req, reply) => {
    const g = req.session.game;
    if (!g || g.solution == null || expired(g)) return reply.code(409).send({ error: 'no active puzzle' });
    if (g.skips <= 0) return reply.code(409).send({ error: 'no skips left' });
    try {
      const n = await withPuzzle({ ...g, skips: g.skips - 1 });
      req.session.game = n;
      return view(n);
    } catch {
      return unavailable(reply);
    }
  });
}
