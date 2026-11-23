// Banana Game backend (Fastify). This file only wires the parts together:
//   config.js        constants                       validation.js    registration rules
//   store.js         accounts + best scores          events.js        pub/sub bus + Server-Sent Events
//   game.js          timing and scoring rules        services/banana  Banana API client (timeout, cache, breaker)
//                                                    services/quotes  ZenQuotes client (timeout, cache, local fallback)
//   routes/auth.js   virtual identity (bcrypt, session cookie, roles)   security.js  CSRF, origin check, headers, login limiter
//   routes/admin.js  admin-only: players, login history, CSV export
//   profile.js       stats + badge rules (pure)      routes/profile.js  profile page data, avatar
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
import { registerSecurity, createLoginLimiter } from './security.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { profileRoutes } from './routes/profile.js';
import { gameRoutes } from './routes/game.js';
import { publicRoutes } from './routes/public.js';

export { validateRegistration } from './validation.js';

// banana / quotes can be injected (tests do) so external services are never needed to run the suite.
export function build({
  timeLimitMs = null, // null: use each level's own time limit (tests pass a tiny value)
  dataFile = null, banana = createBananaClient(), quotes = createQuoteClient(),
  sessionTtlMs = 15 * 60 * 1000, // inactivity timeout: the cookie is renewed on every response, so it expires after 15 idle minutes
  secureCookies = process.env.NODE_ENV === 'production', // Secure cookies need HTTPS
  loginMaxFailures = 5, loginWindowMs = 5 * 60 * 1000,
  // Where the web app is served from when that differs from the API (the Vite dev server). Set ALLOWED_ORIGINS in production.
  allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(','),
} = {}) {
  const app = Fastify();
  const store = createStore(dataFile);
  const events = createEvents(store);
  const game = createGame({ timeLimitMs, bus: events.bus });

  app.register(cookie);
  app.register(session, {
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me-it-must-be-32+chars',
    cookie: { secure: secureCookies, httpOnly: true, sameSite: 'lax', maxAge: sessionTtlMs },
    saveUninitialized: false,
  });

  registerSecurity(app, { allowedOrigins });
  authRoutes(app, { store, limiter: createLoginLimiter({ max: loginMaxFailures, windowMs: loginWindowMs }) });
  adminRoutes(app, { store });
  gameRoutes(app, { game, getDigits: banana.getDigits, getImage: banana.getImage, getQuote: quotes.getQuote, store });
  profileRoutes(app, { store });
  publicRoutes(app, { store, events, banana });

  return app;
}
