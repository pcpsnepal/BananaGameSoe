// Client for the Banana API (https://marcconrad.com/uob/banana/doc.php): the only place that talks to it.
// The game uses each puzzle's solution digit as part of the secret code. We use plain out=json (about 100 bytes),
// so getDigits() only keeps each puzzle's image link. The player solves the puzzle from its picture, but the link must
// never reach the browser: the filename ends in the solution digit (...n96.png -> 6). getImage() downloads the picture
// on the server so our own /api/puzzle route can serve it under an opaque URL.
//
// Resilience (all optional knobs):
//  - timeout: give up on a slow request instead of hanging the game
//  - validation: reject responses whose solution is not a digit 0-9
//  - cache: remember recent digits and use them when the live service fails
//  - circuit breaker: after N failures in a row stop calling for a cooldown, serve the cache meanwhile
//  - latency: round-trip time of the last live request
import { timeoutFetch } from './http.js';

const BANANA = 'https://marcconrad.com/uob/banana/api.php?out=json';

// The image link comes from a third party, so it is only passed on if it is plain https on a Banana host.
const IMAGE_HOSTS = ['sanfoh.com', 'marcconrad.com'];
const MAX_IMAGE_BYTES = 1_000_000; // the real pictures are about 40 KB
export function safeImage(link) {
  try {
    const u = new URL(link);
    return u.protocol === 'https:' && IMAGE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`)) ? u.href : null;
  } catch {
    return null;
  }
}

export function createBananaClient({ timeoutMs = 5000, failureThreshold = 3, cooldownMs = 30000, cacheSize = 40, fetchImpl, now = Date.now } = {}) {
  const cache = [];
  let failures = 0;
  let openedAt = 0;
  let lastLatencyMs = null;

  const tripped = () => failures >= failureThreshold;
  const isOpen = () => tripped() && now() - openedAt < cooldownMs; // after the cooldown one trial request is allowed (half-open)

  async function live() {
    const start = now();
    const r = await timeoutFetch(BANANA, timeoutMs, fetchImpl);
    if (!r.ok) throw new Error(`Banana API ${r.status}`);
    const p = await r.json();
    const solution = Number(p.solution);
    if (p.solution === '' || p.solution == null || !Number.isInteger(solution) || solution < 0 || solution > 9) throw new Error('Banana API sent an invalid solution');
    lastLatencyMs = now() - start;
    return { digit: solution, image: safeImage(p.question) };
  }

  // One digit and its puzzle image link: live if possible, otherwise a cached one.
  async function oneDigit() {
    if (!isOpen()) {
      try {
        const item = await live();
        failures = 0;
        cache.push(item);
        if (cache.length > cacheSize) cache.shift();
        return { ...item, source: 'live' };
      } catch {
        failures++;
        if (tripped()) openedAt = now();
      }
    }
    if (cache.length) return { ...cache[Math.floor(Math.random() * cache.length)], source: 'cache' };
    throw new Error('Banana API unavailable and nothing cached');
  }

  // n digits fetched in parallel. Returns { digits, images, source: 'live' | 'cache' | 'mixed', latencyMs }; images[i] is the puzzle link for digits[i] (or null).
  async function getDigits(n) {
    const parts = await Promise.all(Array.from({ length: n }, oneDigit));
    const live = parts.filter((p) => p.source === 'live').length;
    return { digits: parts.map((p) => p.digit), images: parts.map((p) => p.image), source: live === n ? 'live' : live === 0 ? 'cache' : 'mixed', latencyMs: lastLatencyMs };
  }

  // The picture behind an image link from getDigits(). The link is a third-party value, so it is checked again here
  // (https, Banana host), redirects are refused, only a PNG up to MAX_IMAGE_BYTES is accepted, and recent pictures are
  // kept so a reload or a retry does not hit the Banana host again.
  const pictures = new Map(); // link -> { type, body }, oldest first
  async function getImage(link) {
    const url = safeImage(link);
    if (!url) throw new Error('not a Banana image link');
    if (pictures.has(url)) return pictures.get(url);
    const r = await timeoutFetch(url, timeoutMs, fetchImpl, { redirect: 'error' });
    const type = r.headers?.get('content-type') ?? '';
    if (!r.ok || !type.startsWith('image/png')) throw new Error(`Banana image ${r.status} ${type}`);
    const body = Buffer.from(await r.arrayBuffer());
    if (body.length > MAX_IMAGE_BYTES) throw new Error('Banana image too large');
    const picture = { type: 'image/png', body };
    pictures.set(url, picture);
    if (pictures.size > cacheSize) pictures.delete(pictures.keys().next().value);
    return picture;
  }

  const stats = () => ({ circuit: isOpen() ? 'open' : tripped() ? 'half-open' : 'closed', failures, cachedDigits: cache.length, lastLatencyMs });
  return { getDigits, getImage, stats };
}
