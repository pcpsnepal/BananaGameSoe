// Virtual identity: registration, login (bcrypt + session cookie), logout, roles.
import bcrypt from 'bcryptjs';
import { validateRegistration } from '../validation.js';
import { newCsrfToken } from '../security.js';
import { DEFAULT_AVATAR } from '../profile.js';

// preHandler for routes that need a logged-in user. The user comes from the server-side session, never from the request body.
export const requireLogin = async (req, reply) => {
  if (!req.session.user) return reply.code(401).send({ error: 'login required' });
};

// Role-based access control: the role is read from the stored account on every request, so a demotion takes effect at once.
// Hiding a link in the UI is not protection; this is.
export const requireRole = (store, role) => async (req, reply) => {
  if (!req.session.user) return reply.code(401).send({ error: 'login required' });
  if (store.roleOf(req.session.user) !== role) return reply.code(403).send({ error: 'forbidden' });
};

// Compared against when the username does not exist, so "unknown user" and "wrong password" take the same time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const clean = (s) => String(s).replace(/[^\w.@-]/g, '?').slice(0, 20); // safe to store in the login history

export function authRoutes(app, { store, limiter }) {
  const { users, save } = store;
  const identity = (req, key) => ({ user: key, name: users.get(key).name, avatar: store.avatarOf(key), role: store.roleOf(key), csrfToken: req.session.csrf });

  app.post('/api/register', async (req, reply) => {
    const fields = validateRegistration(req.body);
    const key = String(req.body?.username ?? '').trim().toLowerCase();
    if (!fields.username && users.has(key)) fields.username = 'That username is taken';
    if (Object.keys(fields).length) return reply.code(Object.values(fields).includes('That username is taken') ? 409 : 400).send({ error: Object.values(fields)[0], fields });
    const { name, username, password } = req.body;
    users.set(key, { username: username.trim(), name: name.trim(), hash: await bcrypt.hash(password, 10), role: 'player', avatar: DEFAULT_AVATAR });
    save();
    await req.session.regenerate();
    req.session.user = key;
    req.session.csrf = newCsrfToken();
    store.recordLogin({ username: clean(key), success: true, ip: req.ip });
    return identity(req, key);
  });

  app.post('/api/login', async (req, reply) => {
    const { username, password } = req.body ?? {};
    const key = String(username ?? '').trim().toLowerCase();
    const attempt = `${req.ip}|${key.slice(0, 20)}`;
    if (limiter.blocked(attempt)) {
      store.recordLogin({ username: clean(key), success: false, ip: req.ip, note: 'locked out' });
      return reply.code(429).header('Retry-After', limiter.retryAfterSec(attempt)).send({ error: `Too many failed attempts. Try again in ${Math.ceil(limiter.retryAfterSec(attempt) / 60)} minute(s).` });
    }
    const u = users.get(key);
    const match = await bcrypt.compare(String(password ?? ''), u?.hash ?? DUMMY_HASH);
    if (!u || !match) {
      limiter.fail(attempt);
      store.recordLogin({ username: clean(key), success: false, ip: req.ip });
      return reply.code(401).send({ error: 'Wrong username or password' });
    }
    limiter.reset(attempt);
    await req.session.regenerate(); // fresh session id: prevents session fixation
    req.session.user = key;
    req.session.csrf = newCsrfToken(); // and a fresh CSRF token
    store.recordLogin({ username: clean(key), success: true, ip: req.ip });
    return identity(req, key);
  });

  app.post('/api/logout', async (req) => { await req.session.destroy(); return { ok: true }; });

  app.get('/api/me', async (req) => {
    const key = req.session.user;
    return key && users.has(key) ? identity(req, key) : { user: null, name: null, role: null, csrfToken: null };
  });
}
