// fetch with a hard timeout, so a hung external service can never stall the game.
// The fetch implementation is looked up at call time so tests can replace globalThis.fetch.
// init: extra fetch options (for example { redirect: 'error' }).
export const timeoutFetch = (url, ms, fetchImpl = (...a) => globalThis.fetch(...a), init = {}) =>
  fetchImpl(url, { ...init, signal: AbortSignal.timeout(ms) });
