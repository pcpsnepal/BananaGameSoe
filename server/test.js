// Core tests: Mastermind rules, scoring, timer, power-ups, registration, persistence.
// The Banana API is scripted: each new code takes the next secret from this list.
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, validateRegistration } from './app.js';
import { scoreGuess } from './game.js';

const SECRETS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 0, 1, 2], [3, 3, 4, 4], [0, 0, 0, 0], [1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3]];
function fakeBanana() {
  let i = 0;
  const b = {
    calls: 0,
    getDigits: async () => { b.calls++; return { digits: SECRETS[i++ % SECRETS.length], images: [0, 1, 2, 3].map((k) => `https://www.sanfoh.com/uob/banana/data/p${i}${k}.png`), source: 'live', latencyMs: 12 }; },
    getImage: async (link) => ({ type: 'image/png', body: Buffer.from(link) }), // the "picture" is just its own link, so tests can tell which one was served
    stats: () => ({}),
  };
  return b;
}
const quotes = { getQuote: async () => ({ text: 'q', author: 'a', source: 'local' }) };

// each client keeps its own cookie jar and, like the real browser app, sends back the CSRF token it was given
function client(app) {
  let cookie = '', csrf = '';
  const send = async (method, url, payload) => {
    const res = await app.inject({ method, url, payload, headers: { cookie, 'x-csrf-token': csrf } });
    const c = res.cookies.at(-1);
    if (c) cookie = `${c.name}=${c.value}`;
    const body = res.json();
    if (body?.csrfToken) csrf = body.csrfToken;
    return { code: res.statusCode, body };
  };
  send.raw = (url) => app.inject({ method: 'GET', url, headers: { cookie } }); // the raw response, for non-JSON bodies (puzzle pictures)
  return send;
}
const acct = (name, username) => ({ name, username, password: 'secret123', confirm: 'secret123' });

// --- Mastermind feedback (pure) ---
assert.deepEqual(scoreGuess([1, 2, 3, 4], [1, 2, 3, 4]), { exact: 4, partial: 0 });
assert.deepEqual(scoreGuess([1, 2, 3, 4], [4, 3, 2, 1]), { exact: 0, partial: 4 });
assert.deepEqual(scoreGuess([1, 2, 3, 4], [5, 6, 7, 8]), { exact: 0, partial: 0 });
assert.deepEqual(scoreGuess([1, 2, 3, 4], [1, 1, 5, 5]), { exact: 1, partial: 0 }); // a digit is matched once only
assert.deepEqual(scoreGuess([1, 1, 2, 2], [2, 2, 1, 1]), { exact: 0, partial: 4 });
assert.deepEqual(scoreGuess([1, 1, 2, 3], [1, 2, 1, 1]), { exact: 1, partial: 2 });
assert.deepEqual(scoreGuess([7, 7, 7, 7], [7, 0, 0, 0]), { exact: 1, partial: 0 });

const banana = fakeBanana();
const app = build({ banana, quotes });
const call = client(app);
const WRONG = [9, 9, 9, 9];
const failRound = async () => { let r; do { r = (await call('POST', '/api/guess', { guess: WRONG })).body; } while (!r.done); return r; };

// --- identity gate ---
assert.equal((await call('POST', '/api/game', { difficulty: 'easy' })).code, 401);
assert.equal((await call('POST', '/api/register', acct('Ann Lee', 'ann'))).code, 200);
assert.equal((await call('GET', '/api/round')).code, 409); // no game yet

// --- starting a game ---
assert.equal((await call('POST', '/api/game', { difficulty: 'nope' })).code, 400);
const g = await call('POST', '/api/game', { difficulty: 'normal' });
assert.ok(!('secret' in g.body) && !JSON.stringify(g.body).includes('[1,2,3,4]'), 'the code never reaches the browser');
assert.ok(!JSON.stringify(g.body).includes('sanfoh'), 'the Banana link never reaches the browser (its filename ends in the solution digit)');
assert.deepEqual([g.body.length, g.body.attempts, g.body.total, g.body.lives, g.body.hints, g.body.skips], [4, 8, 120, 3, 2, 1]);
assert.deepEqual(g.body.api, { source: 'live', latencyMs: 12 });
assert.equal((await call('GET', '/api/round')).body.length, 4); // reload: same code
assert.equal(banana.calls, 1); // no new fetch from the Banana API

// --- puzzle pictures: the player solves them, but only through our own opaque URLs ---
assert.ok(g.body.images.length === 4 && g.body.images.every((u) => /^\/api\/puzzle\/[0-3]\?v=\d+$/.test(u)), 'one picture URL per digit, on our own server');
const pic = await call.raw(g.body.images[2]);
assert.deepEqual([pic.statusCode, pic.headers['content-type']], [200, 'image/png']);
assert.match(pic.body, /^https:\/\/www\.sanfoh\.com\/.*2\.png$/); // the fake picture for digit 3 (the body is its own link)
const [picPath, picV] = g.body.images[0].split('?v=');
for (const url of [`${picPath}?v=1`, `${picPath}`, `/api/puzzle/9?v=${picV}`, `/api/puzzle/x?v=${picV}`, `/api/puzzle/-1?v=${picV}`]) {
  assert.equal((await call.raw(url)).statusCode, 404, url); // wrong code id, missing id, no such digit
}
assert.equal((await client(app).raw(g.body.images[0])).statusCode, 401); // pictures are for logged-in players
const downCall = client(build({ banana: { ...fakeBanana(), getImage: async () => { throw new Error('down'); } }, quotes }));
await downCall('POST', '/api/register', acct('Dan Lee', 'dan'));
const downGame = (await downCall('POST', '/api/game', { difficulty: 'easy' })).body;
assert.equal((await downCall.raw(downGame.images[0])).statusCode, 502); // picture host down: a clean error, the game goes on

// a slow picture download must not undo what the player does meanwhile (the session plugin saves on every response)
let openGate;
const gate = new Promise((r) => { openGate = r; });
const slowPic = client(build({ banana: { ...fakeBanana(), getImage: async (link) => { await gate; return { type: 'image/png', body: Buffer.from(link) }; } }, quotes }));
await slowPic('POST', '/api/register', acct('Sam Lee', 'sam'));
const slowGame = (await slowPic('POST', '/api/game', { difficulty: 'easy' })).body;
const pending = slowPic.raw(slowGame.images[0]); // starts now, finishes only when the gate opens
await new Promise((r) => setTimeout(r, 30));
assert.equal((await slowPic('POST', '/api/hint')).body.revealed.length, 1); // a reveal while the picture is still downloading
openGate();
assert.equal((await pending).statusCode, 200);
const afterSlow = (await slowPic('GET', '/api/round')).body;
assert.deepEqual([afterSlow.revealed.length, afterSlow.hints], [1, 1], 'the slow picture request did not write its old session back');

// --- guesses ---
for (const bad of [[1, 2, 3], [1, 2, 3, 4, 5], ['1', '2', '3', '4'], [10, 0, 0, 0], [-1, 0, 0, 0], [1.5, 0, 0, 0], 'abcd', null]) {
  assert.equal((await call('POST', '/api/guess', { guess: bad })).code, 400, JSON.stringify(bad));
}
const w1 = (await call('POST', '/api/guess', { guess: [4, 3, 2, 1] })).body;
assert.deepEqual(w1, { done: false, exact: 0, partial: 4, attemptsLeft: 7 });
assert.equal((await call('GET', '/api/round')).body.guesses.length, 1); // history survives a reload

// --- scoring: (100 + 10 x unused guesses + seconds left) x 2 (normal), no streak yet ---
const c1 = (await call('POST', '/api/guess', { guess: [1, 2, 3, 4] })).body; // 2nd guess, 6 unused
assert.deepEqual([c1.done, c1.solved, c1.secret, c1.streak], [true, true, [1, 2, 3, 4], 1]);
assert.deepEqual(c1.puzzles.map((p) => p.digit), [1, 2, 3, 4]); // finished: the four puzzles behind the code are shown
assert.ok(c1.puzzles.every((p) => /^\/api\/puzzle\/[0-3]\?v=\d+$/.test(p.image)) && !JSON.stringify(c1).includes('sanfoh'));
assert.equal((await call.raw(c1.puzzles[0].image)).statusCode, 200); // the finished code's pictures are still served
assert.ok(c1.points >= 556 && c1.points <= 560, `points ${c1.points}`);
assert.equal((await call('POST', '/api/guess', { guess: WRONG })).code, 409); // code is over: need a new one

// streak bonus: first-try solve of the next code is worth +25%
await call('GET', '/api/round');
const c2 = (await call('POST', '/api/guess', { guess: [5, 6, 7, 8] })).body; // 7 unused guesses
assert.ok(c2.points >= 722 && c2.points <= 725, `points ${c2.points}`); // (100+70+120) x 2 x 1.25
assert.equal(c2.streak, 2);

// out of guesses: life lost, streak reset, the code is revealed
await call('GET', '/api/round');
const lost = await failRound();
assert.deepEqual([lost.solved, lost.timedOut, lost.lives, lost.streak, lost.bestStreak, lost.secret, lost.guesses.length], [false, false, 2, 0, 2, [9, 0, 1, 2], 8]);

// --- power-ups ---
await call('GET', '/api/round'); // secret 3,3,4,4
const h1 = (await call('POST', '/api/hint')).body;
assert.equal(h1.revealed.length, 1);
assert.equal(h1.revealed[0].digit, [3, 3, 4, 4][h1.revealed[0].index]); // reveals a true digit at its true place
assert.deepEqual(Object.keys(h1.revealed[0]).sort(), ['digit', 'index']); // no Banana link: the pictures are already on screen
assert.ok(!JSON.stringify((await call('GET', '/api/round')).body).includes('sanfoh'), 'a reload never exposes the Banana link');
const h2 = (await call('POST', '/api/hint')).body;
assert.deepEqual([h2.revealed.length, h2.hints], [2, 0]);
assert.notEqual(h2.revealed[1].index, h2.revealed[0].index);
assert.equal((await call('POST', '/api/hint')).code, 409); // no reveals left
const hp = (await call('POST', '/api/guess', { guess: [3, 3, 4, 4] })).body; // first try, but revealed digits halve the points
assert.ok(hp.points <= 290, `hinted points ${hp.points}`); // (100+70+120) x 2 x 0.5
await call('GET', '/api/round'); // secret 0,0,0,0
const sk = await call('POST', '/api/skip');
assert.deepEqual([sk.code, sk.body.skips, sk.body.lives, sk.body.guesses.length], [200, 0, 2, 0]); // free: no life lost
assert.equal((await call('POST', '/api/skip')).code, 409); // only one per game

// --- game over ---
await failRound();
await call('GET', '/api/round');
const over = await failRound();
assert.deepEqual([over.lives, over.over], [0, true]);
assert.equal((await call('GET', '/api/round')).code, 409); // a finished game is cleared
assert.deepEqual((await call('GET', '/api/leaderboard')).body, [{ user: 'Ann Lee', avatar: '🍌', score: over.score }]);

// --- timer (50 ms limit): a late but correct guess is a timeout ---
const slow = build({ timeLimitMs: 50, banana: fakeBanana(), quotes });
const call2 = client(slow);
await call2('POST', '/api/register', acct('Bob', 'bob'));
await call2('POST', '/api/game', { difficulty: 'easy' });
await new Promise((r) => setTimeout(r, 100));
const late = (await call2('POST', '/api/guess', { guess: [1, 2, 3, 4] })).body;
assert.deepEqual([late.solved, late.timedOut, late.lives, late.points], [false, true, 2, 0]);
await call2('GET', '/api/round');
const early = await call2('POST', '/api/guess', { timeout: true }); // client-reported expiry is honoured within 1 s of the limit
assert.equal(early.body.timedOut, true);
// reloading after the clock ran out must not dodge the penalty
await call2('GET', '/api/round');
await new Promise((r) => setTimeout(r, 100));
const reload = (await call2('GET', '/api/round')).body;
assert.deepEqual([reload.result.timedOut, reload.result.lives, reload.result.over], [true, 0, true]);

// a client cannot claim a timeout while there is plenty of time left
const call3 = client(build({ banana: fakeBanana(), quotes }));
await call3('POST', '/api/register', acct('Cat', 'cat'));
await call3('POST', '/api/game', { difficulty: 'easy' });
assert.equal((await call3('POST', '/api/guess', { timeout: true })).code, 400); // not a valid guess, and not a valid timeout yet

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
await build({ dataFile: f, banana, quotes }).inject({ method: 'POST', url: '/api/register', payload: ok });
const li = await build({ dataFile: f, banana, quotes }).inject({ method: 'POST', url: '/api/login', payload: { username: 'cy.dee', password: 'abcdef12' } });
assert.equal(li.statusCode, 200);
rmSync(dir, { recursive: true });

console.log('ok');
await app.close();
await slow.close();
