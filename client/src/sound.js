// Background music + click sound, synthesised with the Web Audio API.
// No audio files are used, so there is nothing to license or attribute.
// Browsers block audio until a user gesture, so music only starts from the toggle button.
let ctx = null;
let timer = null;

const ARP = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880.0, 698.46]; // C major / F, 8 notes
const STEP = 0.28; // seconds per note

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

function bar() {
  const t = ctx.currentTime + 0.05;
  ARP.forEach((f, i) => tone(f, t + i * STEP, STEP * 1.6, 0.04));
  tone(130.81, t, STEP * 4, 0.05, 'sine'); // bass notes under the loop
  tone(174.61, t + STEP * 4, STEP * 4, 0.05, 'sine');
}

export const isPlaying = () => timer !== null;

export function startMusic() {
  if (timer) return;
  ctx ??= new AudioContext();
  ctx.resume();
  bar();
  timer = setInterval(bar, ARP.length * STEP * 1000);
}

export function stopMusic() {
  clearInterval(timer);
  timer = null;
}

export function click() {
  if (!ctx) return;
  tone(880, ctx.currentTime, 0.12, 0.06, 'square');
}
