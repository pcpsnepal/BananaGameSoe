// Game constants in one place.
export const CODE_LENGTH = 4;
export const LIVES = 3;
export const HINTS = 2;       // "reveal a digit" power-ups per game
export const MAX_REVEALS = 3; // never reveal the whole code
export const SKIPS = 1;       // free "new code" per game
// seconds = time for one whole code, attempts = guesses allowed per code, mult = points multiplier
export const DIFF = {
  easy: { seconds: 180, attempts: 10, mult: 1 },
  normal: { seconds: 120, attempts: 8, mult: 2 },
  hard: { seconds: 90, attempts: 6, mult: 3 },
};
