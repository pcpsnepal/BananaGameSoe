// Read-only data: leaderboard + live event stream for the browser, and a public versioned JSON API for other apps.
import { requireLogin } from './auth.js';

export function publicRoutes(app, { store, events, banana }) {
  const auth = { preHandler: requireLogin };
  app.get('/api/leaderboard', auth, async () => store.top());
  app.get('/api/events', auth, (req, reply) => events.subscribe(req, reply));

  // ---- public API v1: lets another site or a mobile app read our data (we provide an API, not just consume one) ----
  // Only display names and scores are exposed. Never login usernames, password hashes or sessions.
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/v1/')) reply.header('Access-Control-Allow-Origin', '*'); // read-only data, so any origin may fetch it
    return payload;
  });

  app.get('/api/v1/scores', async () => ({
    status: 'success',
    data: [...store.best].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, bestScore], i) => ({
      rank: i + 1,
      player: store.nameOf(key),
      best_score: bestScore,
      total_score: store.stats.get(key)?.total ?? 0,
      games_played: store.stats.get(key)?.games ?? 0,
    })),
  }));

  // Health of the external dependency: circuit state, cached puzzles, last round-trip time.
  app.get('/api/v1/status', async () => ({ status: 'success', data: { banana_api: banana.stats() } }));
}
