// Tiny publish/subscribe bus built on the browser's own EventTarget / CustomEvent.
// Publishers announce what happened ("puzzle:completed"); subscribers decide what to do (sound, flash, ...).
// Neither side knows about the other, which is what makes the design loosely coupled.
//
// Events used in the app:
//   puzzle:completed  { correct, timedOut, points, score, lives, streak, over, ... }  an answer (or timeout) was settled
//   game:over         same detail as above                                            the last life was lost
//   guess:submitted   { exact, partial, attemptsLeft }                                a guess was scored, the code is still open
//   time:warning      { seconds }                                                     5 seconds left on the clock
//   powerup:used      { type: 'hint' | 'skip' }
//   badge:earned      { id, name, desc }                                              an answer earned a badge
//   session:expired   (none)                                                          the server says we are logged out
const bus = new EventTarget();

export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

// Subscribe; returns the unsubscribe function (handy as a React effect cleanup).
export function on(name, handler) {
  const listener = (e) => handler(e.detail);
  bus.addEventListener(name, listener);
  return () => bus.removeEventListener(name, listener);
}
