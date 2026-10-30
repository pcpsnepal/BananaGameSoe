// Security tests: CSRF, cross-site blocking, session timeout, login lockout, roles, login history, CSV safety.
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from './app.js';
import { makeAdmin } from './make-admin.js';
import { csvCell } from './routes/admin.js';
import { createLoginLimiter } from './security.js';

const banana = { getDigits: async (n) => ({ digits: Array(n).fill(7), source: 'live', latencyMs: 5 }), stats: () => ({}) };
const quotes = { getQuote: async () => ({ text: 'q', author: 'a', source: 'local' }) };
const acct = (name, username) => ({ name, username, password: 'secret123', confirm: 'secret123' });

// raw client: the test decides which headers to send
function client(app) {
  let cookie = '';
  const send = async (method, url, payload, headers = {}) => {
    const res = await app.inject({ method, url, payload, headers: { cookie, ...headers } });
    const c = res.cookies.at(-1);
    if (c) cookie = `${c.name}=${c.value}`;
    let body; try { body = res.json(); } catch { body = res.body; }
    return { code: res.statusCode, body, headers: res.headers };
  };
  return send;
}

const app = build({ banana, quotes });
const web = client(app);

// --- CSRF ---
const reg = await web('POST', '/api/register', acct('Ann Lee', 'ann'));
const token = reg.body.csrfToken;
assert.equal(token.length, 64);
assert.equal(reg.body.role, 'player');
assert.equal((await web('POST', '/api/game', { difficulty: 'easy' })).code, 403); // no token
assert.equal((await web('POST', '/api/game', { difficulty: 'easy' }, { 'x-csrf-token': 'x'.repeat(64) })).code, 403); // wrong token
assert.equal((await web('POST', '/api/game', { difficulty: 'easy' }, { 'x-csrf-token': token })).code, 200);
assert.equal((await web('GET', '/api/me')).body.csrfToken, token); // page reload recovers the token
assert.equal((await web('GET', '/api/leaderboard')).code, 200); // reads need no token

// cross-site Origin is refused even with a valid token; same-site Origin is fine
const sameHost = { host: 'localhost:5173' };
assert.equal((await web('POST', '/api/hint', {}, { 'x-csrf-token': token, origin: 'http://evil.example', ...sameHost })).code, 403);
assert.equal((await web('POST', '/api/hint', {}, { 'x-csrf-token': token, origin: 'http://localhost:5173', ...sameHost })).code, 200);
// dev setup: the web app (:5173) proxies to the API (:3001), so Origin and Host differ but the origin is on the allow-list
assert.notEqual((await web('POST', '/api/hint', {}, { 'x-csrf-token': token, origin: 'http://localhost:5173', host: 'localhost:3001' })).code, 403); // passed the security check
assert.equal((await web('POST', '/api/hint', {}, { 'x-csrf-token': token, origin: 'http://localhost:5174', host: 'localhost:3001' })).code, 403); // other port: not allowed
const lo = await web('POST', '/api/login', { username: 'ann', password: 'secret123' }, { 'x-csrf-token': token });
assert.notEqual(lo.body.csrfToken, token); // new session, new token
assert.equal((await web('POST', '/api/game', { difficulty: 'easy' }, { 'x-csrf-token': token })).code, 403); // old token is dead
const lo2 = await web('POST', '/api/logout', {}, { 'x-csrf-token': lo.body.csrfToken });
assert.equal(lo2.code, 200);
assert.equal((await web('GET', '/api/me')).body.user, null);

// security headers
const h = await web('GET', '/api/me');
assert.deepEqual([h.headers['x-content-type-options'], h.headers['x-frame-options']], ['nosniff', 'DENY']);

// --- cookie attributes ---
const ck = (await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'ann', password: 'secret123' } })).cookies[0];
assert.equal(ck.httpOnly, true);
assert.equal(ck.sameSite, 'Lax');
assert.ok(ck.maxAge === 900 || ck.expires, 'cookie expires after 15 minutes of inactivity');
const prod = build({ banana, quotes, secureCookies: true });
const pc = (await prod.inject({ method: 'POST', url: '/api/register', payload: acct('Pat Lee', 'pat'), headers: { 'x-forwarded-proto': 'https' } })).cookies[0];
assert.equal(pc?.secure, true);

// --- inactivity timeout ---
const short = build({ banana, quotes, sessionTtlMs: 200 });
const s = client(short);
await s('POST', '/api/register', acct('Sam Idle', 'sam'));
assert.equal((await s('GET', '/api/me')).body.user, 'sam');
await new Promise((r) => setTimeout(r, 400)); // idle past the limit
assert.equal((await s('GET', '/api/me')).body.user, null);
assert.equal((await s('GET', '/api/round')).code, 401);

// --- login lockout ---
const lock = build({ banana, quotes, loginMaxFailures: 3 });
const l = client(lock);
await l('POST', '/api/register', acct('Lou Lock', 'lou'));
await l('POST', '/api/logout', {}, { 'x-csrf-token': (await l('GET', '/api/me')).body.csrfToken });
for (let i = 0; i < 3; i++) assert.equal((await l('POST', '/api/login', { username: 'lou', password: 'wrongpass1' })).code, 401);
const locked = await l('POST', '/api/login', { username: 'lou', password: 'secret123' }); // right password, but locked
assert.equal(locked.code, 429);
assert.ok(Number(locked.headers['retry-after']) > 0);
assert.equal((await l('POST', '/api/login', { username: 'someone-else', password: 'x' })).code, 401); // other usernames unaffected
// limiter unit: window expires, success resets
let t = 0;
const lim = createLoginLimiter({ max: 2, windowMs: 1000, now: () => t });
lim.fail('k'); lim.fail('k');
assert.equal(lim.blocked('k'), true);
t = 1001;
assert.equal(lim.blocked('k'), false);

// --- roles (RBAC) + login history + CSV ---
const dir = mkdtempSync(join(tmpdir(), 'banana-sec-'));
const f = join(dir, 'data.json');
const a1 = build({ banana, quotes, dataFile: f });
const p = client(a1);
await p('POST', '/api/register', acct('Root Boss', 'root'));
const player = client(a1);
const pr = await player('POST', '/api/register', acct('Plain Player', 'plain'));
assert.equal((await player('GET', '/api/admin/players')).code, 403); // player: forbidden
assert.equal((await client(a1)('GET', '/api/admin/players')).code, 401); // anonymous: unauthenticated
assert.equal((await player('GET', '/api/admin/export.csv')).code, 403);
await player('POST', '/api/login', { username: 'plain', password: 'wrongpass1' }, { 'x-csrf-token': pr.body.csrfToken });

assert.throws(() => makeAdmin(f, 'nobody'), /no such user/);
makeAdmin(f, 'root'); // offline promotion, then a restart picks it up
const a2 = build({ banana, quotes, dataFile: f });
const admin = client(a2);
const al = await admin('POST', '/api/login', { username: 'root', password: 'secret123' });
assert.equal(al.body.role, 'admin');
const dash = await admin('GET', '/api/admin/players');
assert.equal(dash.code, 200);
assert.deepEqual(dash.body.players.map((x) => [x.username, x.role]).sort(), [['plain', 'player'], ['root', 'admin']]);
assert.ok(dash.body.players.every((x) => !('hash' in x)));
assert.ok(dash.body.history.some((e) => e.username === 'plain' && e.success === false)); // failed login recorded
assert.ok(dash.body.history.some((e) => e.username === 'root' && e.success === true));
const csv = await admin('GET', '/api/admin/export.csv');
assert.match(csv.headers['content-type'], /text\/csv/);
assert.match(csv.body, /^name,username,role,best_score,total_score,games_played,last_login\n/);
assert.ok(!/\$2[aby]\$/.test(readFileSync(f, 'utf8').replace(/"hash":"[^"]+"/g, ''))); // sanity: hashes only live in the hash field
assert.ok(!csv.body.includes('$2a$'), 'CSV never contains password hashes');
rmSync(dir, { recursive: true });

// --- CSV formula injection ---
assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
assert.equal(csvCell('+1'), "'+1");
assert.equal(csvCell('a,b'), '"a,b"');
assert.equal(csvCell(null), '');

console.log('security ok');
for (const a of [app, prod, short, lock, a1, a2]) await a.close();
