// Sound, synthesised with the Web Audio API (no audio files, so nothing to license or attribute).
//  - background music on the landing page (explicit toggle: browsers block audio until a user gesture)
//  - short sound effects for game events (muted with the sound toggle; preference is remembered)
let ctx = null;
let timer = null;
let muted = false;
try { muted = localStorage.getItem('banana.muted') === '1'; } catch { /* storage blocked: keep default */ }

function ensure() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume(); // allowed once the user has interacted with the page
  return ctx;
}

function tone(freq, at, dur, vol, type = 'triangle') {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(ctx.destination);
  o.start(at);
  o.stop(at + dur);
}

// ---- music ----
const ARP = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880.0, 698.46]; // C major / F, 8 notes
const STEP = 0.28; // seconds per note

function bar() {
  const t = ctx.currentTime + 0.05;
  ARP.forEach((f, i) => tone(f, t + i * STEP, STEP * 1.6, 0.04));
  tone(130.81, t, STEP * 4, 0.05, 'sine'); // bass notes under the loop
  tone(174.61, t + STEP * 4, STEP * 4, 0.05, 'sine');
}

export const isPlaying = () => timer !== null;

export function startMusic() {
  if (timer) return;
  ensure();
  bar();
  timer = setInterval(bar, ARP.length * STEP * 1000);
}

export function stopMusic() {
  clearInterval(timer);
  timer = null;
}

// ---- sound effects ----
export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('banana.muted', m ? '1' : '0'); } catch { /* ignore */ }
}

const EFFECTS = {
  click: (t) => tone(880, t, 0.12, 0.06, 'square'),
  // a guess was scored: the more pegs in the right place, the higher the note
  peg: (t, exact = 0) => tone(330 + exact * 110, t, 0.14, 0.06, 'triangle'),
  // pitch rises a semitone per answer in the streak (max 6), so streaks are audible
  correct: (t, streak = 0) => { const k = 2 ** (Math.min(streak, 6) / 12); [523.25, 659.25, 783.99].forEach((f, i) => tone(f * k, t + i * 0.08, 0.2, 0.07)); },
  wrong: (t) => { tone(196, t, 0.25, 0.07, 'sawtooth'); tone(147, t + 0.12, 0.35, 0.07, 'sawtooth'); },
  timeup: (t) => [440, 349, 262].forEach((f, i) => tone(f, t + i * 0.15, 0.25, 0.06, 'square')),
  warning: (t) => { tone(988, t, 0.1, 0.05, 'square'); tone(988, t + 0.18, 0.1, 0.05, 'square'); },
  powerup: (t) => { tone(988, t, 0.12, 0.05); tone(1319, t + 0.09, 0.2, 0.05); },
  gameover: (t) => [392, 311, 262, 196].forEach((f, i) => tone(f, t + 0.4 + i * 0.22, 0.4, 0.06, 'triangle')), // starts after the answer sound
};

export function sfx(name, arg) {
  if (muted || !EFFECTS[name]) return;
  try { ensure(); EFFECTS[name](ctx.currentTime + 0.01, arg); } catch { /* audio unavailable: the game still works */ }
}

export const click = () => sfx('click');
