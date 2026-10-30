// Smoke tests with the Banana API stubbed: every puzzle has solution 7 and a unique image.
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, validateRegistration } from './app.js';

let fetches = 0;
globalThis.fetch = async () => ({ ok: true, json: async () => ({ question: `IMG${++fetches}`, solution: 7 }) });

// each client keeps its own cookie jar
function client(app) {
  let cookie = '';
  return async (method, url, payload) => {
    const res = await app.inject({ method, url, payload, headers: { cookie } });
    const c = res.cookies.at(-1);
    if (c) cookie = `${c.name}=${c.value}`;
    return { code: res.statusCode, body: res.json() };
  };
}
const acct = (name, username) => ({ name, username, password: 'secret123', confirm: 'secret123' });

const app = build();
const call = client(app);

// --- identity ---
assert.equal((await call('POST', '/api/game', { difficulty: 'easy' })).code, 401); // not logged in
assert.equal((await call('POST', '/api/register', acct('Ann Lee', 'ann'))).code, 200);
assert.equal((await call('GET', '/api/puzzle')).code, 409); // no game yet

// --- starting a game ---
assert.equal((await call('POST', '/api/game', { difficulty: 'nope' })).code, 400);
const g = await call('POST', '/api/game', { difficulty: 'normal' });
assert.equal(g.body.image, 'data:image/png;base64,IMG1'); // served as data, never as a third-party URL
assert.ok(!('solution' in g.body)); // answer never leaks
assert.deepEqual([g.body.lives, g.body.total, g.body.hints, g.body.skips], [3, 30, 2, 1]);
const again = await call('GET', '/api/puzzle'); // reload: same puzzle, no new fetch
assert.deepEqual([again.body.image, fetches], ['data:image/png;base64,IMG1', 1]);

// --- scoring: (10 + secondsLeft) x 2 (normal), no streak yet ---
const c1 = (await call('POST', '/api/answer', { digit: 7 })).body;
assert.equal(c1.correct, true);
assert.ok(c1.points >= 76 && c1.points <= 80, `points ${c1.points}`);
assert.equal(c1.streak, 1);
assert.equal((await call('POST', '/api/answer', { digit: 7 })).code, 409); // needs a new puzzle first

// streak bonus: second correct answer is worth +25%
await call('GET', '/api/puzzle');
const c2 = (await call('POST', '/api/answer', { digit: 7 })).body;
assert.ok(c2.points >= 95 && c2.points <= 100, `points ${c2.points}`);
assert.equal(c2.streak, 2);

// wrong answer: life lost, streak reset
await call('GET', '/api/puzzle');
const w = (await call('POST', '/api/answer', { digit: 1 })).body;
assert.deepEqual([w.correct, w.lives, w.streak, w.points], [false, 2, 0, 0]);
assert.equal(w.bestStreak, 2);

// --- power-ups ---
await call('GET', '/api/puzzle');
const h = (await call('POST', '/api/hint')).body;
assert.equal(h.removed.length, 5);
assert.ok(!h.removed.includes(7)); // never removes the right digit
assert.equal((await call('POST', '/api/hint')).code, 409); // one hint per puzzle
const hp = (await call('POST', '/api/answer', { digit: 7 })).body;
assert.ok(hp.points <= 40, `hinted points ${hp.points}`); // (10+30) x 2 x 0.5
await call('GET', '/api/puzzle');
const sk = await call('POST', '/api/skip');
assert.deepEqual([sk.code, sk.body.skips, sk.body.lives], [200, 0, 2]); // free: no life lost
assert.equal((await call('POST', '/api/skip')).code, 409); // only one per game

// --- game over ---
await call('POST', '/api/answer', { digit: 1 });
await call('GET', '/api/puzzle');
const over = (await call('POST', '/api/answer', { digit: 1 })).body;
assert.deepEqual([over.lives, over.over], [0, true]);
assert.equal((await call('GET', '/api/puzzle')).code, 409); // finished game is cleared
assert.deepEqual((await call('GET', '/api/leaderboard')).body, [{ user: 'Ann Lee', score: over.score }]);

// --- timer (50ms limit): a late but correct answer is a timeout ---
const slow = build({ timeLimitMs: 50 });
const call2 = client(slow);
await call2('POST', '/api/register', acct('Bob', 'bob'));
await call2('POST', '/api/game', { difficulty: 'easy' });
await new Promise((r) => setTimeout(r, 100));
const late = (await call2('POST', '/api/answer', { digit: 7 })).body;
assert.deepEqual([late.correct, late.timedOut, late.lives, late.points], [false, true, 2, 0]);
await call2('GET', '/api/puzzle');
assert.equal((await call2('POST', '/api/answer', { timeout: true })).body.timedOut, true); // client-reported expiry
// reloading while the clock has run out must not dodge the penalty
await call2('GET', '/api/puzzle');
await new Promise((r) => setTimeout(r, 100));
const reload = (await call2('GET', '/api/puzzle')).body;
assert.deepEqual([reload.result.timedOut, reload.result.lives, reload.result.over], [true, 0, true]);

// --- registration validation ---
const ok = { name: 'Cy Dee', username: 'cy.dee', password: 'abcdef12', confirm: 'abcdef12' };
assert.deepEqual(validateRegistration(ok), {});
assert.ok(validateRegistration({ ...ok, name: '' }).name);
assert.ok(validateRegistration({ ...ok, name: '1234' }).name);
assert.ok(validateRegistration({ ...ok, username: 'a b' }).username);
assert.ok(validateRegistration({ ...ok, username: 'ab' }).username);
assert.ok(validateRegistration({ ...ok, password: 'short1', confirm: 'short1' }).password);
assert.ok(validateRegistration({ ...ok, password: 'onlyletters', confirm: 'onlyletters' }).password);
assert.ok(validateRegistration({ ...ok, password: '12345678', confirm: '12345678' }).password);
assert.ok(validateRegistration({ ...ok, confirm: 'different1' }).confirm);
const bad = await call('POST', '/api/register', { ...ok, confirm: 'nope' });
assert.deepEqual([bad.code, Object.keys(bad.body.fields)], [400, ['confirm']]);
const dup = await call('POST', '/api/register', { ...ok, username: 'ANN' }); // usernames are case-insensitive
assert.deepEqual([dup.code, Object.keys(dup.body.fields)], [409, ['username']]);
assert.equal((await call('POST', '/api/login', { username: ' Ann ', password: 'secret123' })).body.name, 'Ann Lee');
assert.equal((await call('POST', '/api/login', { username: 'ann', password: 'wrongpass1' })).code, 401);

// --- persistence: a new app instance on the same file still knows the account ---
const dir = mkdtempSync(join(tmpdir(), 'banana-'));
const f = join(dir, 'data.json');
await build({ dataFile: f }).inject({ method: 'POST', url: '/api/register', payload: ok });
const li = await build({ dataFile: f }).inject({ method: 'POST', url: '/api/login', payload: { username: 'cy.dee', password: 'abcdef12' } });
assert.equal(li.statusCode, 200);
rmSync(dir, { recursive: true });

console.log('ok');
await app.close();
await slow.close();
