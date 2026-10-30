// A player's own profile: statistics, badges, avatar. Always the logged-in user's data, taken from the session.
import { requireLogin } from './auth.js';
import { AVATARS, profileView } from '../profile.js';

export function profileRoutes(app, { store }) {
  const auth = { preHandler: requireLogin };

  app.get('/api/profile', auth, async (req) => {
    const key = req.session.user;
    const u = store.users.get(key);
    const lastLogin = [...store.history].reverse().filter((h) => h.username === key && h.success)[1]?.at ?? null; // [0] is this session's login
    return { name: u.name, username: u.username, avatar: store.avatarOf(key), avatars: AVATARS, last_login: lastLogin, ...profileView(store.stats.get(key), store.best.get(key)) };
  });

  app.post('/api/profile', auth, async (req, reply) => {
    const { avatar } = req.body ?? {};
    if (!AVATARS.includes(avatar)) return reply.code(400).send({ error: 'unknown avatar' });
    store.users.get(req.session.user).avatar = avatar;
    store.save();
    return { avatar };
  });
}
