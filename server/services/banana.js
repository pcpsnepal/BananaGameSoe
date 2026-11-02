// Client for the Banana API (https://marcconrad.com/uob/banana/doc.php): the only place that talks to it.
// The game uses each puzzle's solution digit as part of the secret code. We use plain out=json (about 100 bytes):
// the image is not downloaded, only its link is kept so the player can see the puzzle behind a revealed digit.
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

  const stats = () => ({ circuit: isOpen() ? 'open' : tripped() ? 'half-open' : 'closed', failures, cachedDigits: cache.length, lastLatencyMs });
  return { getDigits, stats };
}
