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

const BANANA = 'https://marcconrad.com/uob/banana/api.php?out=json';
const LIVES = 3;

export function build() {
  const app = Fastify();
  const bus = new EventEmitter();
  const users = new Map();   // username -> bcrypt hash; ponytail: in memory, swap for a DB to persist
  const best = new Map();    // username -> best score
  const clients = new Set(); // open SSE responses

  app.register(cookie);
  app.register(session, {
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me-it-must-be-32+chars',
    cookie: { secure: false, httpOnly: true, sameSite: 'lax' }, // secure:true behind HTTPS in production
    saveUninitialized: false,
  });

  const auth = { preHandler: async (req, reply) => { if (!req.session.user) return reply.code(401).send({ error: 'login required' }); } };
  const top = () => [...best].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([user, score]) => ({ user, score }));

  // ---- events ----
  bus.on('score', ({ user, score }) => {
    if (score <= (best.get(user) || 0)) return;
    best.set(user, score);
    const msg = `event: leaderboard\ndata: ${JSON.stringify(top())}\n\n`;
    clients.forEach((c) => c.write(msg));
  });

  // ---- identity ----
  app.post('/api/register', async (req, reply) => {
    const { username, password } = req.body ?? {};
    if (!/^\w{3,20}$/.test(username ?? '') || (password ?? '').length < 6) return reply.code(400).send({ error: 'username 3-20 chars, password 6+ chars' });
    if (users.has(username)) return reply.code(409).send({ error: 'user exists' });
    users.set(username, await bcrypt.hash(password, 10));
    req.session.user = username;
    return { user: username };
  });

  app.post('/api/login', async (req, reply) => {
    const { username, password } = req.body ?? {};
    const hash = users.get(username);
    if (!hash || !(await bcrypt.compare(password ?? '', hash))) return reply.code(401).send({ error: 'bad credentials' });
    await req.session.regenerate(); // fresh session id: prevents session fixation
    req.session.user = username;
    return { user: username };
  });

  app.post('/api/logout', async (req) => { await req.session.destroy(); return { ok: true }; });
  app.get('/api/me', async (req) => ({ user: req.session.user ?? null }));

  // ---- game ----
  // The solution stays in the server-side session; the browser only gets the image URL.
  app.get('/api/puzzle', auth, async (req, reply) => {
    let game = req.session.game;
    if (!game || game.lives <= 0) game = { lives: LIVES, score: 0 };
    try {
      const r = await fetch(BANANA);
      if (!r.ok) throw new Error(r.status);
      const p = await r.json();
      req.session.game = { ...game, solution: p.solution };
      return { image: p.question, lives: game.lives, score: game.score };
    } catch {
      return reply.code(502).send({ error: 'Banana API unavailable' });
    }
  });

  app.post('/api/answer', auth, async (req, reply) => {
    const g = req.session.game;
    const digit = Number(req.body?.digit);
    if (!g || g.solution == null) return reply.code(409).send({ error: 'no active puzzle' });
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) return reply.code(400).send({ error: 'digit 0-9 required' });
    const correct = digit === g.solution;
    const next = { lives: g.lives - (correct ? 0 : 1), score: g.score + (correct ? 1 : 0), solution: null };
    req.session.game = next;
    bus.emit('score', { user: req.session.user, score: next.score });
    return { correct, solution: g.solution, score: next.score, lives: next.lives, over: next.lives <= 0 };
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
