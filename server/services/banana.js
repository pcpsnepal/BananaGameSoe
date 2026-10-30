// Client for the Banana API (https://marcconrad.com/uob/banana/doc.php): the only place that talks to it.
// base64=yes: the API returns the PNG itself, so the browser never has to contact the third-party image host.
//
// Resilience (all optional knobs):
//  - timeout: give up on a slow request instead of hanging the game
//  - validation: reject responses that are not a string image plus a digit 0-9
//  - cache: remember recent puzzles and serve one when the live service fails
//  - circuit breaker: after N failures in a row stop calling for a cooldown, serve the cache meanwhile
//  - latency: round-trip time of the last live request
import { timeoutFetch } from './http.js';

const BANANA = 'https://marcconrad.com/uob/banana/api.php?out=json&base64=yes';

export function createBananaClient({ timeoutMs = 5000, failureThreshold = 3, cooldownMs = 30000, cacheSize = 10, fetchImpl, now = Date.now } = {}) {
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
    if (typeof p.question !== 'string' || !p.question || !Number.isInteger(solution) || solution < 0 || solution > 9) throw new Error('Banana API sent an invalid puzzle');
    lastLatencyMs = now() - start;
    return { image: `data:image/png;base64,${p.question}`, solution };
  }

  // Returns { image, solution, source: 'live' | 'cache', latencyMs }. Throws only if the service is down and nothing is cached.
  async function getPuzzle() {
    if (!isOpen()) {
      try {
        const p = await live();
        failures = 0;
        cache.push(p);
        if (cache.length > cacheSize) cache.shift();
        return { ...p, source: 'live', latencyMs: lastLatencyMs };
      } catch {
        failures++;
        if (tripped()) openedAt = now();
      }
    }
    if (cache.length) return { ...cache[Math.floor(Math.random() * cache.length)], source: 'cache', latencyMs: null };
    throw new Error('Banana API unavailable and no cached puzzle');
  }

  const stats = () => ({ circuit: isOpen() ? 'open' : tripped() ? 'half-open' : 'closed', failures, cachedPuzzles: cache.length, lastLatencyMs });
  return { getPuzzle, stats };
}
