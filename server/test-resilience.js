// Tests for external-service handling and the public API. No network: fetch is always injected.
import assert from 'node:assert';
import { createBananaClient } from './services/banana.js';
import { createQuoteClient, LOCAL_QUOTES } from './services/quotes.js';
import { build } from './app.js';

// AbortSignal.timeout() timers do not keep Node alive, and this script has nothing else running, so hold the loop open.
const keepAlive = setInterval(() => {}, 1000);

let clock = 0;
const now = () => clock;

// --- Banana client: live, validation, latency ---
let calls = 0;
const live = createBananaClient({ now, fetchImpl: async () => { calls++; clock += 42; return { ok: true, json: async () => ({ question: 'AAA', solution: 3 }) }; } });
const p1 = await live.getPuzzle();
assert.deepEqual([p1.source, p1.latencyMs, p1.solution, p1.image], ['live', 42, 3, 'data:image/png;base64,AAA']);

// bad payloads are rejected, never trusted
for (const bad of [{ question: 'x', solution: 12 }, { question: '', solution: 1 }, { solution: 1 }, { question: 'x', solution: 'abc' }]) {
  const c = createBananaClient({ fetchImpl: async () => ({ ok: true, json: async () => bad }) });
  await assert.rejects(c.getPuzzle(), /unavailable/);
}

// --- timeout: a request that never answers must not hang ---
const hang = createBananaClient({ timeoutMs: 30, fetchImpl: (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason))) });
const t0 = Date.now();
await assert.rejects(hang.getPuzzle(), /unavailable/);
assert.ok(Date.now() - t0 < 1000, 'timed out quickly');

// --- cache fallback + circuit breaker ---
let up = true, fetches = 0;
const flaky = createBananaClient({
  now, failureThreshold: 3, cooldownMs: 1000,
  fetchImpl: async () => { fetches++; if (!up) throw new Error('down'); return { ok: true, json: async () => ({ question: 'CACHED', solution: 5 }) }; },
});
await flaky.getPuzzle(); // fills the cache
up = false;
const f1 = await flaky.getPuzzle();
assert.deepEqual([f1.source, f1.solution, f1.latencyMs], ['cache', 5, null]); // service down -> cached puzzle
await flaky.getPuzzle(); await flaky.getPuzzle(); // 3 failures in a row: circuit opens
assert.equal(flaky.stats().circuit, 'open');
const before = fetches;
await flaky.getPuzzle(); await flaky.getPuzzle();
assert.equal(fetches, before); // open circuit: no calls reach the failing service
clock += 1001; // cooldown over -> half-open, one trial request
assert.equal(flaky.stats().circuit, 'half-open');
await flaky.getPuzzle();
assert.equal(fetches, before + 1);
assert.equal(flaky.stats().circuit, 'open'); // trial failed -> open again
up = true; clock += 1001;
assert.equal((await flaky.getPuzzle()).source, 'live'); // trial succeeds -> closed
assert.equal(flaky.stats().circuit, 'closed');

// nothing cached and service down: error (the route turns it into a 502)
await assert.rejects(createBananaClient({ fetchImpl: async () => { throw new Error('down'); } }).getPuzzle(), /no cached puzzle/);

// --- quotes: live, 60s cache, local fallback ---
let qc = 0, qt = 0;
const quotes = createQuoteClient({ now: () => qt, cacheMs: 60000, fetchImpl: async () => { qc++; return { ok: true, json: async () => [{ q: 'Keep going.', a: 'Someone' }] }; } });
assert.deepEqual(await quotes.getQuote(), { text: 'Keep going.', author: 'Someone', source: 'zenquotes' });
assert.equal((await quotes.getQuote()).source, 'cache');
assert.equal(qc, 1); // second call served from cache
qt = 61000;
await quotes.getQuote();
assert.equal(qc, 2); // cache expired

for (const fetchImpl of [
  async () => { throw new Error('offline'); },
  async () => ({ ok: false, status: 429 }),
  async () => ({ ok: true, json: async () => [{ q: 'Too many requests', a: 'zenquotes.io', h: '' }, 'junk'][1] }), // malformed
  async () => ({ ok: true, json: async () => ({ not: 'an array' }) }),
]) {
  const fq = await createQuoteClient({ fetchImpl }).getQuote();
  assert.equal(fq.source, 'local');
  assert.ok(LOCAL_QUOTES.some((l) => l.text === fq.text));
}

// --- app integration: injected services, quote on game over, public API ---
const fakeBanana = { getPuzzle: async () => ({ image: 'data:image/png;base64,Z', solution: 7, source: 'cache', latencyMs: null }), stats: () => ({ circuit: 'closed', failures: 0, cachedPuzzles: 1, lastLatencyMs: 9 }) };
const fakeQuotes = { getQuote: async () => ({ text: 'Hi', author: 'Me', source: 'local' }) };
const app = build({ banana: fakeBanana, quotes: fakeQuotes });
let cookie = '', csrf = '';
const call = async (method, url, payload) => {
  const res = await app.inject({ method, url, payload, headers: { cookie, 'x-csrf-token': csrf } });
  const c = res.cookies.at(-1); if (c) cookie = `${c.name}=${c.value}`;
  const body = res.json();
  if (body?.csrfToken) csrf = body.csrfToken;
  return { code: res.statusCode, body, headers: res.headers };
};
await call('POST', '/api/register', { name: 'Ann Lee', username: 'ann', password: 'secret123', confirm: 'secret123' });
const g = await call('POST', '/api/game', { difficulty: 'easy' });
assert.deepEqual(g.body.api, { source: 'cache', latencyMs: null }); // browser is told where the puzzle came from
assert.ok(!('solution' in g.body));
await call('POST', '/api/answer', { digit: 7 }); // correct: no quote mid-game
let last;
for (let i = 0; i < 3; i++) { await call('GET', '/api/puzzle'); last = await call('POST', '/api/answer', { digit: 1 }); }
assert.equal(last.body.over, true);
assert.deepEqual(last.body.quote, { text: 'Hi', author: 'Me', source: 'local' });

// public API: no login needed, CORS open, nothing sensitive
const pub = await app.inject({ method: 'GET', url: '/api/v1/scores' });
const scores = pub.json();
assert.equal(pub.headers['access-control-allow-origin'], '*');
assert.equal(scores.status, 'success');
assert.deepEqual(Object.keys(scores.data[0]).sort(), ['best_score', 'games_played', 'player', 'rank', 'total_score']);
assert.deepEqual([scores.data[0].rank, scores.data[0].player, scores.data[0].games_played], [1, 'Ann Lee', 1]);
const raw = pub.body;
assert.ok(!/hash|password|\$2a|"ann"|session/i.test(raw), 'no sensitive data in public API');
const st = (await app.inject({ method: 'GET', url: '/api/v1/status' })).json();
assert.equal(st.data.banana_api.circuit, 'closed');
assert.equal((await app.inject({ method: 'GET', url: '/api/leaderboard' })).statusCode, 401); // internal one stays private

console.log('resilience ok');
await app.close();
clearInterval(keepAlive);
