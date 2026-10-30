// Smoke test with the Banana API stubbed (solution is always 7).
import assert from 'node:assert';
import { build, validateRegistration } from './app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

globalThis.fetch = async () => ({ ok: true, json: async () => ({ question: 'http://img/x.png', solution: 7 }) });
const app = build();
let cookie = '';
const call = async (method, url, payload) => {
  const res = await app.inject({ method, url, payload, headers: { cookie } });
  const c = res.cookies.at(-1);
  if (c) cookie = `${c.name}=${c.value}`;
  return { code: res.statusCode, body: res.json() };
};

assert.equal((await call('GET', '/api/puzzle')).code, 401);                      // not logged in
assert.equal((await call('POST', '/api/register', { name: 'Ann Lee', username: 'ann', password: 'secret123', confirm: 'secret123' })).code, 200);
const p = await call('GET', '/api/puzzle');
assert.equal(p.body.image, 'http://img/x.png');
assert.ok(!('solution' in p.body));                                              // answer never leaks
assert.equal((await call('POST', '/api/answer', { digit: 7 })).body.correct, true);
assert.equal((await call('POST', '/api/answer', { digit: 7 })).code, 409);       // must fetch a new puzzle first
await call('GET', '/api/puzzle');
const w = await call('POST', '/api/answer', { digit: 1 });
assert.deepEqual([w.body.correct, w.body.lives, w.body.score], [false, 2, 1]);
assert.deepEqual((await call('GET', '/api/leaderboard')).body, [{ user: 'Ann Lee', score: 1 }]);
assert.equal((await call('POST', '/api/login', { username: 'ann', password: 'nope' })).code, 401);

// timer: separate app with a 50ms limit; a late but correct answer must count as a timeout
const slow = build({ timeLimitMs: 50 });
let ck = '';
const call2 = async (method, url, payload) => {
  const res = await slow.inject({ method, url, payload, headers: { cookie: ck } });
  const c = res.cookies.at(-1);
  if (c) ck = `${c.name}=${c.value}`;
  return { code: res.statusCode, body: res.json() };
};
await call2('POST', '/api/register', { name: 'Bob', username: 'bob', password: 'secret456', confirm: 'secret456' });
assert.equal((await call2('GET', '/api/puzzle')).body.seconds, 0);
await new Promise((r) => setTimeout(r, 100));
const late = await call2('POST', '/api/answer', { digit: 7 });
assert.deepEqual([late.body.correct, late.body.timedOut, late.body.lives, late.body.score], [false, true, 2, 0]);
await call2('GET', '/api/puzzle');
assert.equal((await call2('POST', '/api/answer', { timeout: true })).body.timedOut, true); // client-reported timeout, no digit needed

// registration validation
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

// persistence: a new app instance on the same file still knows the account
const dir = mkdtempSync(join(tmpdir(), 'banana-'));
const f = join(dir, 'data.json');
const a1 = build({ dataFile: f });
await a1.inject({ method: 'POST', url: '/api/register', payload: ok });
const a2 = build({ dataFile: f });
const li = await a2.inject({ method: 'POST', url: '/api/login', payload: { username: 'cy.dee', password: 'abcdef12' } });
assert.equal(li.statusCode, 200);
rmSync(dir, { recursive: true });

console.log('ok');
await app.close();
await slow.close();
