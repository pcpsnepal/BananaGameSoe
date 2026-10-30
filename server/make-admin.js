// Promote an existing account to admin. Run on the server: npm run make-admin -- <username>
// Admin can only be granted here, offline. There is deliberately no web or registration path to it.
import { createStore } from './store.js';

export function makeAdmin(dataFile, username) {
  const store = createStore(dataFile);
  const key = String(username).trim().toLowerCase();
  const u = store.users.get(key);
  if (!u) throw new Error(`no such user: ${username}`);
  u.role = 'admin';
  store.save();
  return key;
}

if (process.argv[1].endsWith('make-admin.js')) {
  try {
    console.log(`${makeAdmin(new URL('./data.json', import.meta.url).pathname, process.argv[2] ?? '')} is now an admin`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
