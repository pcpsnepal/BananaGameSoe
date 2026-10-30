// Statistics, badges and profile endpoints.
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createStore } from './store.js';
import { applyAnswer, applyGameOver, newStats, profileView, AVATARS } from './profile.js';
import { build } from './app.js';

// --- pure rules ---
let r = applyAnswer(newStats(), { correct: true, guesses: 5, streak: 1 });
assert.deepEqual(r.earned, ['first_banana']);
r = applyAnswer(r.stats, { correct: true, guesses: 4, streak: 2 });
assert.deepEqual(r.earned, []); // never awarded twice
assert.deepEqual([r.stats.answered, r.stats.correct, r.stats.fewestGuesses], [2, 2, 4]);
assert.deepEqual(applyAnswer(newStats(), { correct: true, guesses: 3, streak: 1 }).earned, ['first_banana', 'sharp_mind']);
assert.deepEqual(applyAnswer(newStats(), { correct: true, guesses: 4, streak: 1 }).earned, ['first_banana']); // 4 guesses is not "3 or fewer"
assert.ok(applyAnswer(newStats(), { correct: true, guesses: 9, streak: 5 }).earned.includes('hot_streak'));
assert.deepEqual(applyAnswer(newStats(), { correct: false, guesses: 1, streak: 0 }).earned, []); // a failed code earns nothing
assert.equal(applyAnswer(newStats(), { correct: false, guesses: 1, streak: 0 }).stats.fewestGuesses, null);
let g = newStats();
for (let i = 1; i <= 9; i++) g = applyGameOver(g, 10).stats;
assert.deepEqual(g.games, 9);
const tenth = applyGameOver(g, 10);
assert.deepEqual([tenth.earned, tenth.stats.total], [['veteran'], 100]);
assert.deepEqual(applyGameOver(tenth.stats, 5).earned, []);
assert.equal(profileView(newStats(), 0).accuracy, null); // no answers yet: no division by zero
assert.equal(profileView({ ...newStats(), answered: 4, correct: 3 }, 0).accuracy, 75);
assert.deepEqual(profileView(tenth.stats, 0).badges.filter((b) => b.earned).map((b) => b.id), ['veteran']);

// --- through the API ---
const banana = { getDigits: async (n) => ({ digits: Array(n).fill(7), source: 'live', latencyMs: 5 }), stats: () => ({}) };
const quotes = { getQuote: async () => ({ text: 'q', author: 'a', source: 'local' }) };
const dir = mkdtempSync(join(tmpdir(), 'banana-prof-'));
const file = join(dir, 'data.json');
const app = build({ banana, quotes, dataFile: file });
let cookie = '', csrf = '';
const call = async (method, url, payload) => {
  const res = await app.inject({ method, url, payload, headers: { cookie, 'x-csrf-token': csrf } });
  const c = res.cookies.at(-1); if (c) cookie = `${c.name}=${c.value}`;
  const body = res.json(); if (body?.csrfToken) csrf = body.csrfToken;
  return { code: res.statusCode, body };
};
assert.equal((await app.inject({ method: 'GET', url: '/api/profile' })).statusCode, 401);
const reg = await call('POST', '/api/register', { name: 'Ann Lee', username: 'ann', password: 'secret123', confirm: 'secret123' });
assert.equal(reg.body.avatar, '🍌');

await call('POST', '/api/game', { difficulty: 'easy' });
const a1 = (await call('POST', '/api/guess', { guess: [7, 7, 7, 7] })).body; // cracked on the first guess
assert.deepEqual(a1.newBadges.map((b) => b.id).sort(), ['first_banana', 'sharp_mind']);
assert.equal(a1.newBadges[0].name !== undefined, true);
await call('GET', '/api/round');
assert.deepEqual((await call('POST', '/api/guess', { guess: [7, 7, 7, 7] })).body.newBadges, []); // nothing new
for (let round = 0; round < 3; round++) { // three failed codes (10 wrong guesses each on easy) end the game
  await call('GET', '/api/round');
  let last; do { last = (await call('POST', '/api/guess', { guess: [1, 1, 1, 1] })).body; } while (!last.done);
}

const p = (await call('GET', '/api/profile')).body;
assert.deepEqual([p.games_played, p.accuracy, p.best_streak, p.fewest_guesses], [1, 40, 2, 1]); // 2 codes cracked of 5 played
assert.equal(p.total_score, p.best_score);
assert.deepEqual(p.badges.filter((b) => b.earned).map((b) => b.id).sort(), ['first_banana', 'sharp_mind']);
assert.equal(p.badges.length, 4);
assert.ok(!('hash' in p) && !('role' in p));

// avatar: validated, CSRF protected, saved, shown on leaderboards
assert.equal((await call('POST', '/api/profile', { avatar: '<script>' })).code, 400);
assert.equal((await call('POST', '/api/profile', { avatar: AVATARS[3] })).code, 200);
assert.equal((await call('GET', '/api/profile')).body.avatar, AVATARS[3]);
assert.equal((await call('GET', '/api/leaderboard')).body[0].avatar, AVATARS[3]);
const pub = (await app.inject({ method: 'GET', url: '/api/v1/scores' })).json();
assert.equal(pub.data[0].avatar, AVATARS[3]);
const noToken = await app.inject({ method: 'POST', url: '/api/profile', payload: { avatar: AVATARS[1] }, headers: { cookie } });
assert.equal(noToken.statusCode, 403);

// stats and avatar survive a restart
const again = build({ banana, quotes, dataFile: file });
let c2 = '', t2 = '';
const login = await again.inject({ method: 'POST', url: '/api/login', payload: { username: 'ann', password: 'secret123' } });
c2 = `${login.cookies.at(-1).name}=${login.cookies.at(-1).value}`; t2 = login.json().csrfToken;
const p2 = (await again.inject({ method: 'GET', url: '/api/profile', headers: { cookie: c2, 'x-csrf-token': t2 } })).json();
assert.deepEqual([p2.games_played, p2.avatar, p2.badges.filter((b) => b.earned).length], [1, AVATARS[3], 2]);
assert.match(p2.last_login ?? '', /^\d{4}-/); // the previous login (registration) is shown, not this one

// an old data file (stats saved before badges existed) still loads, with the new fields filled in
const old = join(dir, 'old.json');
writeFileSync(old, JSON.stringify({ users: [['ann', { username: 'ann', name: 'Ann', hash: 'x' }]], best: [['ann', 40]], stats: [['ann', { games: 3, total: 90 }]] }));
const loaded = createStore(old);
assert.deepEqual(loaded.stats.get('ann'), { ...newStats(), games: 3, total: 90 });
assert.equal(loaded.avatarOf('ann'), '🍌'); // accounts without an avatar get the default
assert.equal(loaded.roleOf('ann'), 'player');
rmSync(dir, { recursive: true });

console.log('profile ok');
await app.close(); await again.close();
