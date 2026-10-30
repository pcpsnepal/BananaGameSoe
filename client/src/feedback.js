// Subscribers that turn game events into sound. The game code only publishes events; it never calls sound directly.
import { on } from './events.js';
import { sfx } from './sound.js';

// Returns one function that removes every subscription.
export function subscribeFeedback() {
  const offs = [
    on('puzzle:completed', (r) => sfx(r.correct ? 'correct' : r.timedOut ? 'timeup' : 'wrong', r.streak)),
    on('game:over', () => sfx('gameover')),
    on('time:warning', () => sfx('warning')),
    on('powerup:used', () => sfx('powerup')),
    on('badge:earned', () => sfx('powerup')),
  ];
  return () => offs.forEach((off) => off());
}
