// Motivational quotes from the ZenQuotes REST API (https://zenquotes.io), shown at the end of a game.
// ZenQuotes asks users to credit it, so the UI shows the attribution. The free tier is rate limited, hence:
//  - a short timeout so the player never waits long for a quote
//  - a 60 s cache so repeated games do not hammer the service
//  - local fallback quotes when the service fails or is rate limited
import { timeoutFetch } from './http.js';

export const LOCAL_QUOTES = [
  { text: 'It always seems impossible until it is done.', author: 'Nelson Mandela' },
  { text: 'Fall seven times, stand up eight.', author: 'Japanese proverb' },
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin' },
  { text: 'A journey of a thousand miles begins with a single step.', author: 'Lao Tzu' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius' },
  { text: 'The expert in anything was once a beginner.', author: 'Helen Hayes' },
  { text: 'Do what you can, with what you have, where you are.', author: 'Theodore Roosevelt' },
];

export function createQuoteClient({ timeoutMs = 2000, cacheMs = 60000, fetchImpl, now = Date.now } = {}) {
  let cached = null; // { text, author, at }

  async function getQuote() {
    if (cached && now() - cached.at < cacheMs) return { text: cached.text, author: cached.author, source: 'cache' };
    try {
      const r = await timeoutFetch('https://zenquotes.io/api/random', timeoutMs, fetchImpl);
      if (!r.ok) throw new Error(r.status);
      const [q] = await r.json();
      if (typeof q?.q !== 'string' || typeof q?.a !== 'string' || !q.q) throw new Error('invalid quote'); // rate limits come back as a "quote" too, but with a different shape
      cached = { text: q.q, author: q.a, at: now() };
      return { text: q.q, author: q.a, source: 'zenquotes' };
    } catch {
      return { ...LOCAL_QUOTES[Math.floor(Math.random() * LOCAL_QUOTES.length)], source: 'local' };
    }
  }

  return { getQuote };
}
