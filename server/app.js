// Banana Game backend (Fastify). This file only wires the parts together:
//   config.js        constants                       validation.js    registration rules
//   store.js         accounts + best scores          events.js        pub/sub bus + Server-Sent Events
//   game.js          timing and scoring rules        services/banana  the one place that calls the Banana API
//   routes/auth.js   virtual identity (bcrypt + session cookie)
//   routes/game.js   game endpoints                  routes/public.js leaderboard + event stream
// The Banana API call pattern follows the public docs; everything else was written with LLM help (Claude).
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import { createStore } from './store.js';
import { createEvents } from './events.js';
import { createGame } from './game.js';
import { fetchPuzzle } from './services/banana.js';
import { authRoutes } from './routes/auth.js';
import { gameRoutes } from './routes/game.js';
import { publicRoutes } from './routes/public.js';

export { validateRegistration } from './validation.js';

export function build({ timeLimitMs = 30000, dataFile = null } = {}) {
  const app = Fastify();
  const store = createStore(dataFile);
  const events = createEvents(store);
  const game = createGame({ timeLimitMs, bus: events.bus });

  app.register(cookie);
  app.register(session, {
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me-it-must-be-32+chars',
    cookie: { secure: false, httpOnly: true, sameSite: 'lax' }, // secure:true behind HTTPS in production
    saveUninitialized: false,
  });

  authRoutes(app, { store });
  gameRoutes(app, { game, getPuzzle: fetchPuzzle });
  publicRoutes(app, { store, events });

  return app;
}
