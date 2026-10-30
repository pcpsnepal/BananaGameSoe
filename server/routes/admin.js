// Admin-only endpoints. Every route checks the role on the server (403 for players, 401 for anonymous).
import { requireRole } from './auth.js';

// Spreadsheet formula injection: a cell starting with = + - @ would be executed by Excel, so neutralise it.
export function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function adminRoutes(app, { store }) {
  const admin = { preHandler: requireRole(store, 'admin') };
  const rows = () => [...store.users].map(([key, u]) => {
    const s = store.stats.get(key);
    const lastLogin = [...store.history].reverse().find((h) => h.username === key && h.success)?.at ?? null;
    return { name: u.name, username: u.username, role: u.role ?? 'player', best_score: store.best.get(key) ?? 0, total_score: s?.total ?? 0, games_played: s?.games ?? 0, last_login: lastLogin };
  });

  app.get('/api/admin/players', admin, async () => ({ players: rows(), history: [...store.history].reverse().slice(0, 50) }));

  // Score export (CSV), admin only.
  app.get('/api/admin/export.csv', admin, async (req, reply) => {
    const cols = ['name', 'username', 'role', 'best_score', 'total_score', 'games_played', 'last_login'];
    const csv = [cols.join(','), ...rows().map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
    return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="banana-scores.csv"').send(csv);
  });
}
