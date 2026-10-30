// Banana Game backend (Fastify). This file only wires the parts together:
//   config.js        constants                       validation.js    registration rules
//   store.js         accounts + best scores          events.js        pub/sub bus + Server-Sent Events
//   game.js          timing and scoring rules        services/banana  Banana API client (timeout, cache, circuit breaker)
//                                                    services/quotes  ZenQuotes client (timeout, cache, local fallback)
//   routes/auth.js   virtual identity (bcrypt + session cookie)
//   routes/game.js   game endpoints                  routes/public.js leaderboard, event stream, public /api/v1
// The Banana API call pattern follows the public docs; everything else was written with LLM help (Claude).
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import { createStore } from './store.js';
import { createEvents } from './events.js';
import { createGame } from './game.js';
import { createBananaClient } from './services/banana.js';
import { createQuoteClient } from './services/quotes.js';
import { authRoutes } from './routes/auth.js';
import { gameRoutes } from './routes/game.js';
import { publicRoutes } from './routes/public.js';

export { validateRegistration } from './validation.js';

// banana / quotes can be injected (tests do) so external services are never needed to run the suite.
export function build({ timeLimitMs = 30000, dataFile = null, banana = createBananaClient(), quotes = createQuoteClient() } = {}) {
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
  gameRoutes(app, { game, getPuzzle: banana.getPuzzle, getQuote: quotes.getQuote });
  publicRoutes(app, { store, events, banana });

  return app;
}
