// Banana Game backend (Fastify).
//  - Interoperability: fetches puzzles from the Banana API (https://marcconrad.com/uob/banana/doc.php) over HTTPS/JSON
//  - Virtual identity: bcrypt password hashes + signed httpOnly session cookie (@fastify/session)
//  - Events: per-app EventEmitter; 'score' events update the leaderboard and are pushed to browsers via SSE
// The Banana API call pattern follows the public docs; everything else was written with LLM help (Claude).
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import bcrypt from 'bcryptjs';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// base64=yes: the API returns the PNG itself, so the browser never has to contact the third-party image host.
const BANANA = 'https://marcconrad.com/uob/banana/api.php?out=json&base64=yes';
const LIVES = 3;
const HINTS = 2;   // 50/50 hints per game
const SKIPS = 1;   // free skips per game
const DIFF = { easy: { seconds: 45, mult: 1 }, normal: { seconds: 30, mult: 2 }, hard: { seconds: 15, mult: 3 } };

// Registration rules. The client repeats these for instant feedback; the server is the one that enforces them.
export function validateRegistration({ name, username, password, confirm } = {}) {
  const e = {};
  if (!/^\p{L}[\p{L}\p{M} '.-]{1,29}$/u.test(String(name ?? '').trim())) e.name = 'Name must be 2-30 characters (letters, spaces, . - \')';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,19}$/.test(String(username ?? '').trim())) e.username = 'Username must be 3-20 characters: letters, numbers, . _ - (start with a letter or number)';
  const pw = String(password ?? '');
  if (pw.length < 8) e.password = 'Password must be at least 8 characters';
  else if (Buffer.byteLength(pw) > 72) e.password = 'Password is too long (72 bytes max)'; // bcrypt ignores everything past 72 bytes
  else if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) e.password = 'Password needs at least one letter and one number';
  else if (pw.toLowerCase() === String(username ?? '').trim().toLowerCase()) e.password = 'Password must not be the same as the username';
  if (!e.password && pw !== String(confirm ?? '')) e.confirm = 'Passwords do not match';
  return e;
}

export function build({ timeLimitMs = 30000, dataFile = null } = {}) {
  const app = Fastify();
  const bus = new EventEmitter();
  const users = new Map();   // lowercase username -> { username, name, hash }
  const best = new Map();    // lowercase username -> best score
  const clients = new Set(); // open SSE responses

  app.register(cookie);
  app.register(session, {
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me-it-must-be-32+chars',
    cookie: { secure: false, httpOnly: true, sameSite: 'lax' }, // secure:true behind HTTPS in production
    saveUninitialized: false,
  });

  const auth = { preHandler: async (req, reply) => { if (!req.session.user) return reply.code(401).send({ error: 'login required' }); } };
  const top = () => [...best].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, score]) => ({ user: users.get(key)?.name ?? key, score }));

  // Accounts and best scores survive restarts when dataFile is set. ponytail: whole-file JSON rewrite, use a DB if this grows.
  if (dataFile && existsSync(dataFile)) {
    const d = JSON.parse(readFileSync(dataFile, 'utf8'));
    d.users.forEach(([k, v]) => users.set(k, v));
    d.best.forEach(([k, v]) => best.set(k, v));
  }
  const save = () => dataFile && writeFileSync(dataFile, JSON.stringify({ users: [...users], best: [...best] }));

  // ---- events ----
  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    clients.forEach((c) => c.write(msg));
  };
  const nameOf = (key) => users.get(key)?.name ?? key;
  bus.on('score', ({ user, score }) => {
    if (score <= (best.get(user) || 0)) return;
    best.set(user, score);
    save();
    broadcast('leaderboard', top());
  });
  bus.on('game:over', ({ user, score, difficulty }) => broadcast('activity', { text: `${nameOf(user)} finished a ${difficulty} game with ${score} pts` }));
  bus.on('streak', ({ user, streak }) => broadcast('activity', { text: `🔥 ${nameOf(user)} is on a ${streak}-answer streak` }));

  // ---- identity ----
  app.post('/api/register', async (req, reply) => {
    const fields = validateRegistration(req.body);
    const key = String(req.body?.username ?? '').trim().toLowerCase();
    if (!fields.username && users.has(key)) fields.username = 'That username is taken';
    if (Object.keys(fields).length) return reply.code(Object.values(fields).includes('That username is taken') ? 409 : 400).send({ error: Object.values(fields)[0], fields });
    const { name, username, password } = req.body;
    users.set(key, { username: username.trim(), name: name.trim(), hash: await bcrypt.hash(password, 10) });
    save();
    req.session.user = key;
    return { user: key, name: name.trim() };
  });

  app.post('/api/login', async (req, reply) => {
    const { username, password } = req.body ?? {};
    const key = String(username ?? '').trim().toLowerCase();
    const u = users.get(key);
    if (!u || !(await bcrypt.compare(String(password ?? ''), u.hash))) return reply.code(401).send({ error: 'Wrong username or password' });
    await req.session.regenerate(); // fresh session id: prevents session fixation
    req.session.user = key;
    return { user: key, name: u.name };
  });

  app.post('/api/logout', async (req) => { await req.session.destroy(); return { ok: true }; });
  app.get('/api/me', async (req) => ({ user: req.session.user ?? null, name: users.get(req.session.user)?.name ?? null }));

  // ---- game ----
  // The solution stays in the server-side session; the browser only gets the image.
  const limitMs = (g) => timeLimitMs ?? DIFF[g.difficulty].seconds * 1000;
  const secondsLeft = (g) => Math.max(0, Math.ceil((limitMs(g) - (Date.now() - g.issuedAt)) / 1000));
  const expired = (g) => Date.now() - g.issuedAt > limitMs(g);
  const view = (g) => ({
    image: g.image, lives: g.lives, score: g.score, streak: g.streak, difficulty: g.difficulty,
    hints: g.hints, skips: g.skips, removed: g.removed, seconds: secondsLeft(g), total: Math.round(limitMs(g) / 1000),
  });

  // Fetch a fresh puzzle from the Banana API and attach it to the game state.
  // ponytail: image is kept in the in-memory session; fine for a handful of players.
  async function withPuzzle(g) {
    const r = await fetch(BANANA);
    if (!r.ok) throw new Error(r.status);
    const p = await r.json();
    return { ...g, image: `data:image/png;base64,${p.question}`, solution: p.solution, issuedAt: Date.now(), removed: [], hinted: false };
  }

  // Score one puzzle. Points: (10 + seconds left) x difficulty x streak bonus (+25% per streak step, max +100%), halved if the hint was used.
  function settle(user, g, correct, timedOut) {
    const points = correct ? Math.round((10 + secondsLeft(g)) * DIFF[g.difficulty].mult * (1 + 0.25 * Math.min(g.streak, 4)) * (g.hinted ? 0.5 : 1)) : 0;
    const streak = correct ? g.streak + 1 : 0;
    const next = { ...g, lives: g.lives - (correct ? 0 : 1), score: g.score + points, streak, bestStreak: Math.max(g.bestStreak, streak), solution: null };
    const over = next.lives <= 0;
    bus.emit('score', { user, score: next.score });
    if (over) bus.emit('game:over', { user, score: next.score, difficulty: g.difficulty });
    else if (correct && streak % 5 === 0) bus.emit('streak', { user, streak });
    return { next, result: { correct, timedOut, solution: g.solution, points, score: next.score, lives: next.lives, streak, bestStreak: next.bestStreak, over } };
  }

  app.post('/api/game', auth, async (req, reply) => {
    const difficulty = req.body?.difficulty;
    if (!DIFF[difficulty]) return reply.code(400).send({ error: 'difficulty must be easy, normal or hard' });
    try {
      const g = await withPuzzle({ difficulty, lives: LIVES, score: 0, streak: 0, bestStreak: 0, hints: HINTS, skips: SKIPS });
      req.session.game = g;
      return view(g);
    } catch {
      return reply.code(502).send({ error: 'Banana API unavailable' });
    }
  });

  // Current puzzle (same one after a page reload, so reloading cannot dodge the timer) or the next one.
  app.get('/api/puzzle', auth, async (req, reply) => {
    let g = req.session.game;
    if (g && g.lives <= 0) g = req.session.game = null;
    if (!g) return reply.code(409).send({ error: 'no active game' });
    if (g.solution != null) {
      if (!expired(g)) return view(g);
      const { next, result } = settle(req.session.user, g, false, true);
      req.session.game = next;
      return { result };
    }
    try {
      g = await withPuzzle(g);
    } catch {
      return reply.code(502).send({ error: 'Banana API unavailable' });
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
    const { next, result } = settle(req.session.user, g, !timedOut && digit === g.solution, timedOut);
    req.session.game = next;
    return result;
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
      return reply.code(502).send({ error: 'Banana API unavailable' });
    }
  });

  app.get('/api/leaderboard', auth, async () => top());

  app.get('/api/events', auth, (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    clients.add(reply.raw);
    req.raw.on('close', () => clients.delete(reply.raw));
  });

  return app;
}
