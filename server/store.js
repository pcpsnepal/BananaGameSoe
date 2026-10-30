// Accounts and best scores, optionally persisted to a JSON file.
// ponytail: whole-file JSON rewrite on each change; use a database if this grows.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { newStats, DEFAULT_AVATAR } from './profile.js';

export function createStore(dataFile = null) {
  const users = new Map(); // lowercase username -> { username, name, hash }
  const best = new Map();  // lowercase username -> best score
  const stats = new Map(); // lowercase username -> player statistics and badges (see profile.js)
  const history = [];      // recent login attempts, newest last: { at, username, success, ip }

  if (dataFile && existsSync(dataFile)) {
    const d = JSON.parse(readFileSync(dataFile, 'utf8'));
    d.users.forEach(([k, v]) => users.set(k, v));
    d.best.forEach(([k, v]) => best.set(k, v));
    (d.stats ?? []).forEach(([k, v]) => stats.set(k, { ...newStats(), ...v })); // older files lack the newer fields
    history.push(...(d.history ?? []));
  }

  return {
    users,
    best,
    stats,
    history,
    save: () => dataFile && writeFileSync(dataFile, JSON.stringify({ users: [...users], best: [...best], stats: [...stats], history })),
    roleOf: (key) => users.get(key)?.role ?? 'player', // role lives on the account, never in the browser
    recordLogin(entry) {
      history.push({ at: new Date().toISOString(), ...entry });
      if (history.length > 200) history.splice(0, history.length - 200);
      this.save();
    },
    nameOf: (key) => users.get(key)?.name ?? key,
    avatarOf: (key) => users.get(key)?.avatar ?? DEFAULT_AVATAR,
    top: () => [...best].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, score]) => ({ user: users.get(key)?.name ?? key, avatar: users.get(key)?.avatar ?? DEFAULT_AVATAR, score })),
  };
}
