// Tests for external-service handling and the public API. No network: fetch is always injected.
import assert from 'node:assert';
import { createBananaClient, safeImage } from './services/banana.js';
import { createQuoteClient, LOCAL_QUOTES } from './services/quotes.js';
import { build } from './app.js';

// AbortSignal.timeout() timers do not keep Node alive, and this script has nothing else running, so hold the loop open.
const keepAlive = setInterval(() => {}, 1000);

let clock = 0;
const now = () => clock;
const solutionResponse = (solution) => async () => ({ ok: true, json: async () => ({ question: 'https://example.test/x.png', solution }) });

// --- Banana client: live digits, latency ---
let calls = 0;
const live = createBananaClient({ now, fetchImpl: async () => { const k = ++calls; clock += 42; return { ok: true, json: async () => ({ question: 'u', solution: k % 10 }) }; } });
const d1 = await live.getDigits(4);
assert.deepEqual([d1.digits, d1.source, d1.latencyMs, calls], [[1, 2, 3, 4], 'live', 42, 4]); // 4 requests, one per digit

// puzzle image links: kept when they are https on a Banana host, dropped otherwise (the digit still works)
const withLink = (question) => createBananaClient({ fetchImpl: async () => ({ ok: true, json: async () => ({ question, solution: 4 }) }) });
const good = await withLink('https://www.sanfoh.com/uob/banana/data/a.png').getDigits(2);
assert.deepEqual([good.digits, good.images], [[4, 4], ['https://www.sanfoh.com/uob/banana/data/a.png', 'https://www.sanfoh.com/uob/banana/data/a.png']]);
for (const bad of ['http://www.sanfoh.com/a.png', 'https://evil.example/a.png', 'https://sanfoh.com.evil.example/a.png', 'javascript:alert(1)', 'not a url', '', undefined]) {
  assert.equal(safeImage(bad), null, String(bad));
  assert.deepEqual((await withLink(bad).getDigits(1)).images, [null]);
}
// cached digits keep their puzzle link
let okNow = true;
const keep = createBananaClient({ fetchImpl: async () => { if (!okNow) throw new Error('down'); return { ok: true, json: async () => ({ question: 'https://www.sanfoh.com/k.png', solution: 8 }) }; } });
await keep.getDigits(1);
okNow = false;
assert.deepEqual((await keep.getDigits(1)).images, ['https://www.sanfoh.com/k.png']);

// puzzle pictures (getImage): only a PNG from a validated Banana link, no redirects, size capped, cached with a bound
const png = (bytes = 8, type = 'image/png') => ({ ok: true, status: 200, headers: { get: () => type }, arrayBuffer: async () => new ArrayBuffer(bytes) });
const pic = 'https://www.sanfoh.com/uob/banana/data/a.png';
let imgCalls = 0, lastInit;
const pics = createBananaClient({ cacheSize: 2, fetchImpl: async (url, init) => { imgCalls++; lastInit = init; return png(); } });
const p1 = await pics.getImage(pic);
assert.deepEqual([p1.type, p1.body.length, lastInit.redirect, imgCalls], ['image/png', 8, 'error', 1]); // a redirect would be refused
await pics.getImage(pic);
assert.equal(imgCalls, 1, 'a repeat is served from memory');
for (const bad of ['http://www.sanfoh.com/a.png', 'https://evil.example/a.png', 'https://sanfoh.com.evil.example/a.png', 'not a url', '', undefined]) {
  await assert.rejects(pics.getImage(bad), /not a Banana image link/, String(bad));
}
assert.equal(imgCalls, 1, 'a bad link never triggers a fetch');
await assert.rejects(createBananaClient({ fetchImpl: async () => png(8, 'text/html') }).getImage(pic), /Banana image/); // not a PNG
await assert.rejects(createBananaClient({ fetchImpl: async () => ({ ...png(), ok: false, status: 500 }) }).getImage(pic), /Banana image 500/);
await assert.rejects(createBananaClient({ fetchImpl: async () => png(1_000_001) }).getImage(pic), /too large/);
await assert.rejects(createBananaClient({ fetchImpl: async () => { throw new Error('down'); } }).getImage(pic), /down/);
await pics.getImage('https://www.sanfoh.com/b.png');
await pics.getImage('https://www.sanfoh.com/c.png'); // third picture evicts the oldest
await pics.getImage(pic);
assert.equal(imgCalls, 4, 'the picture cache is bounded');

// the solution is a string in some responses: accepted when it is a digit
assert.deepEqual((await createBananaClient({ fetchImpl: solutionResponse('7') }).getDigits(2)).digits, [7, 7]);

// bad payloads are rejected, never trusted
for (const bad of [12, -1, 1.5, 'abc', '', null, undefined]) {
  const c = createBananaClient({ fetchImpl: solutionResponse(bad) });
  await assert.rejects(c.getDigits(4), /unavailable/, `solution ${JSON.stringify(bad)}`);
}
await assert.rejects(createBananaClient({ fetchImpl: async () => ({ ok: false, status: 503 }) }).getDigits(1), /unavailable/);

// --- timeout: a request that never answers must not hang ---
const hang = createBananaClient({ timeoutMs: 30, fetchImpl: (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason))) });
const t0 = Date.now();
await assert.rejects(hang.getDigits(4), /unavailable/);
assert.ok(Date.now() - t0 < 1000, 'timed out quickly');

// --- cache fallback + circuit breaker ---
let up = true, fetches = 0;
const flaky = createBananaClient({
  now, failureThreshold: 3, cooldownMs: 1000,
  fetchImpl: async () => { fetches++; if (!up) throw new Error('down'); return { ok: true, json: async () => ({ question: 'u', solution: 5 }) }; },
});
await flaky.getDigits(1); // fills the cache with a 5
up = false;
const f1 = await flaky.getDigits(2);
assert.deepEqual([f1.digits, f1.source], [[5, 5], 'cache']); // service down -> cached digits
assert.equal(flaky.stats().circuit, 'closed'); // 2 failures so far
await flaky.getDigits(1); // 3rd failure: circuit opens
assert.equal(flaky.stats().circuit, 'open');
const before = fetches;
await flaky.getDigits(4);
assert.equal(fetches, before); // open circuit: no calls reach the failing service
clock += 1001; // cooldown over -> half-open, one trial request
assert.equal(flaky.stats().circuit, 'half-open');
await flaky.getDigits(1);
assert.equal(fetches, before + 1);
assert.equal(flaky.stats().circuit, 'open'); // trial failed -> open again
up = true; clock += 1001;
assert.equal((await flaky.getDigits(1)).source, 'live'); // trial succeeds -> closed
assert.equal(flaky.stats().circuit, 'closed');

// some digits live, some cached: reported as 'mixed'
let n = 0;
const half = createBananaClient({ failureThreshold: 99, fetchImpl: async () => { if (++n === 1) return { ok: true, json: async () => ({ question: 'u', solution: 3 }) }; if (n % 2 === 0) throw new Error('flaky'); return { ok: true, json: async () => ({ question: 'u', solution: 3 }) }; } });
await half.getDigits(1);
assert.equal((await half.getDigits(2)).source, 'mixed');

// nothing cached and service down: error (the route turns it into a 502)
await assert.rejects(createBananaClient({ fetchImpl: async () => { throw new Error('down'); } }).getDigits(4), /nothing cached/);

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
  async () => ({ ok: true, json: async () => 'junk' }),
  async () => ({ ok: true, json: async () => ({ not: 'an array' }) }),
]) {
  const fq = await createQuoteClient({ fetchImpl }).getQuote();
  assert.equal(fq.source, 'local');
  assert.ok(LOCAL_QUOTES.some((l) => l.text === fq.text));
}

// --- app integration: injected services, quote on game over, public API ---
const fakeBanana = { getDigits: async (k) => ({ digits: Array(k).fill(7), source: 'cache', latencyMs: null }), stats: () => ({ circuit: 'closed', failures: 0, cachedDigits: 1, lastLatencyMs: 9 }) };
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
assert.deepEqual(g.body.api, { source: 'cache', latencyMs: null }); // the browser is told where the code came from
assert.ok(!('secret' in g.body));
const solved = (await call('POST', '/api/guess', { guess: [7, 7, 7, 7] })).body; // solved: no quote mid-game
assert.equal(solved.solved, true);
assert.ok(!('quote' in solved));
let last;
for (let round = 0; round < 3; round++) {
  await call('GET', '/api/round');
  do { last = await call('POST', '/api/guess', { guess: [1, 1, 1, 1] }); } while (!last.body.done);
}
assert.equal(last.body.over, true);
assert.deepEqual(last.body.quote, { text: 'Hi', author: 'Me', source: 'local' });

// public API: no login needed, CORS open, nothing sensitive
const pub = await app.inject({ method: 'GET', url: '/api/v1/scores' });
const scores = pub.json();
assert.equal(pub.headers['access-control-allow-origin'], '*');
assert.equal(scores.status, 'success');
assert.deepEqual(Object.keys(scores.data[0]).sort(), ['avatar', 'best_score', 'games_played', 'player', 'rank', 'total_score']);
assert.deepEqual([scores.data[0].rank, scores.data[0].player, scores.data[0].games_played], [1, 'Ann Lee', 1]);
assert.ok(!/hash|password|\$2a|"ann"|session|secret/i.test(pub.body), 'no sensitive data in public API');
const st = (await app.inject({ method: 'GET', url: '/api/v1/status' })).json();
assert.equal(st.data.banana_api.circuit, 'closed');
assert.equal((await app.inject({ method: 'GET', url: '/api/leaderboard' })).statusCode, 401); // the internal one stays private

console.log('resilience ok');
await app.close();
clearInterval(keepAlive);
