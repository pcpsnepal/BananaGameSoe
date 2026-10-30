// Read-only data for the browser: leaderboard and the live event stream.
import { requireLogin } from './auth.js';

export function publicRoutes(app, { store, events }) {
  const auth = { preHandler: requireLogin };
  app.get('/api/leaderboard', auth, async () => store.top());
  app.get('/api/events', auth, (req, reply) => events.subscribe(req, reply));
}
