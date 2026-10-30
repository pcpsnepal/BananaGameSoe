// Cross-cutting security: CSRF defence, cross-site request blocking, response headers, login rate limiting.
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const newCsrfToken = () => randomBytes(32).toString('hex');

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

// Hooks for every request:
//  1. Cross-site blocking: a state-changing request whose Origin header is neither this server's own host nor in
//     allowedOrigins (the web app's address, e.g. the Vite dev server) is refused.
//  2. CSRF token (synchroniser pattern): a logged-in user's state-changing request must carry the token
//     the server put in their session (X-CSRF-Token header). A malicious site can make the browser send the
//     cookie, but it cannot read the token, so it cannot forge the header.
//  3. Safe response headers.
// SameSite=Lax on the session cookie is a second layer, not a replacement for the token.
export function registerSecurity(app, { allowedOrigins = [] } = {}) {
  app.addHook('preHandler', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin) {
      let host;
      try { host = new URL(origin).host; } catch { /* malformed Origin */ }
      if (host !== req.headers.host && !allowedOrigins.includes(origin)) return reply.code(403).send({ error: 'cross-site request blocked' });
    }
    if (req.session.user && !safeEqual(req.headers['x-csrf-token'], req.session.csrf)) {
      return reply.code(403).send({ error: 'invalid CSRF token' });
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });
}

// Blocks a (ip, username) pair after `max` failures within `windowMs`. Slows down password guessing.
// ponytail: in-memory and never pruned except on lookup; behind a reverse proxy req.ip is the proxy (set Fastify trustProxy).
export function createLoginLimiter({ max = 5, windowMs = 5 * 60 * 1000, now = Date.now } = {}) {
  const attempts = new Map(); // key -> { count, since }
  const get = (k) => {
    const e = attempts.get(k);
    if (e && now() - e.since > windowMs) { attempts.delete(k); return null; }
    return e ?? null;
  };
  return {
    blocked: (k) => (get(k)?.count ?? 0) >= max,
    retryAfterSec: (k) => Math.max(1, Math.ceil(((get(k)?.since ?? now()) + windowMs - now()) / 1000)),
    fail: (k) => { const e = get(k) ?? { count: 0, since: now() }; e.count++; attempts.set(k, e); },
    reset: (k) => attempts.delete(k),
  };
}
