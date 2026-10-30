// Accounts and best scores, optionally persisted to a JSON file.
// ponytail: whole-file JSON rewrite on each change; use a database if this grows.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function createStore(dataFile = null) {
  const users = new Map(); // lowercase username -> { username, name, hash }
  const best = new Map();  // lowercase username -> best score

  if (dataFile && existsSync(dataFile)) {
    const d = JSON.parse(readFileSync(dataFile, 'utf8'));
    d.users.forEach(([k, v]) => users.set(k, v));
    d.best.forEach(([k, v]) => best.set(k, v));
  }

  return {
    users,
    best,
    save: () => dataFile && writeFileSync(dataFile, JSON.stringify({ users: [...users], best: [...best] })),
    nameOf: (key) => users.get(key)?.name ?? key,
    top: () => [...best].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, score]) => ({ user: users.get(key)?.name ?? key, score })),
  };
}
