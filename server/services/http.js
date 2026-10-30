// fetch with a hard timeout, so a hung external service can never stall the game.
// The fetch implementation is looked up at call time so tests can replace globalThis.fetch.
export const timeoutFetch = (url, ms, fetchImpl = (...a) => globalThis.fetch(...a)) =>
  fetchImpl(url, { signal: AbortSignal.timeout(ms) });
