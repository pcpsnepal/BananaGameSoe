// Smoke test with the Banana API stubbed (solution is always 7).
import assert from 'node:assert';
import { build } from './app.js';

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
assert.equal((await call('POST', '/api/register', { username: 'ann', password: 'secret1' })).code, 200);
const p = await call('GET', '/api/puzzle');
assert.equal(p.body.image, 'http://img/x.png');
assert.ok(!('solution' in p.body));                                              // answer never leaks
assert.equal((await call('POST', '/api/answer', { digit: 7 })).body.correct, true);
assert.equal((await call('POST', '/api/answer', { digit: 7 })).code, 409);       // must fetch a new puzzle first
await call('GET', '/api/puzzle');
const w = await call('POST', '/api/answer', { digit: 1 });
assert.deepEqual([w.body.correct, w.body.lives, w.body.score], [false, 2, 1]);
assert.deepEqual((await call('GET', '/api/leaderboard')).body, [{ user: 'ann', score: 1 }]);
assert.equal((await call('POST', '/api/login', { username: 'ann', password: 'nope' })).code, 401);
console.log('ok');
await app.close();
