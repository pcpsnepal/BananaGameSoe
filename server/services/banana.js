// Client for the Banana API (https://marcconrad.com/uob/banana/doc.php): the only place that talks to it.
// The game only needs each puzzle's solution digit (it becomes part of the secret code), so we use plain
// out=json without images: the response is about 100 bytes instead of an embedded PNG.
//
// Resilience (all optional knobs):
//  - timeout: give up on a slow request instead of hanging the game
//  - validation: reject responses whose solution is not a digit 0-9
//  - cache: remember recent digits and use them when the live service fails
//  - circuit breaker: after N failures in a row stop calling for a cooldown, serve the cache meanwhile
//  - latency: round-trip time of the last live request
import { timeoutFetch } from './http.js';

const BANANA = 'https://marcconrad.com/uob/banana/api.php?out=json';

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
    return solution;
  }

  // One digit: live if possible, otherwise a cached one.
  async function oneDigit() {
    if (!isOpen()) {
      try {
        const digit = await live();
        failures = 0;
        cache.push(digit);
        if (cache.length > cacheSize) cache.shift();
        return { digit, source: 'live' };
      } catch {
        failures++;
        if (tripped()) openedAt = now();
      }
    }
    if (cache.length) return { digit: cache[Math.floor(Math.random() * cache.length)], source: 'cache' };
    throw new Error('Banana API unavailable and nothing cached');
  }

  // n digits fetched in parallel. Returns { digits, source: 'live' | 'cache' | 'mixed', latencyMs }.
  async function getDigits(n) {
    const parts = await Promise.all(Array.from({ length: n }, oneDigit));
    const live = parts.filter((p) => p.source === 'live').length;
    return { digits: parts.map((p) => p.digit), source: live === n ? 'live' : live === 0 ? 'cache' : 'mixed', latencyMs: lastLatencyMs };
  }

  const stats = () => ({ circuit: isOpen() ? 'open' : tripped() ? 'half-open' : 'closed', failures, cachedDigits: cache.length, lastLatencyMs });
  return { getDigits, stats };
}
