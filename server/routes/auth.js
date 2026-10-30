// Virtual identity: registration, login (bcrypt + session cookie), logout.
import bcrypt from 'bcryptjs';
import { validateRegistration } from '../validation.js';

// preHandler for routes that need a logged-in user. The user comes from the server-side session, never from the request body.
export const requireLogin = async (req, reply) => {
  if (!req.session.user) return reply.code(401).send({ error: 'login required' });
};

export function authRoutes(app, { store }) {
  const { users, save } = store;

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
}
