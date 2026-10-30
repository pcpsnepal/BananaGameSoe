// Run with: npm test  (node's built-in test runner, no browser needed)
import test from 'node:test';
import assert from 'node:assert';
import { emit, on } from './events.js';

test('every subscriber receives the published detail', () => {
  const seen = [];
  const off1 = on('puzzle:completed', (d) => seen.push(['sound', d.score]));
  const off2 = on('puzzle:completed', (d) => seen.push(['flash', d.score]));
  emit('puzzle:completed', { score: 10 });
  assert.deepEqual(seen, [['sound', 10], ['flash', 10]]);
  off1(); off2();
});

test('unsubscribing stops delivery', () => {
  let n = 0;
  const off = on('time:warning', () => n++);
  emit('time:warning', { seconds: 5 });
  off();
  emit('time:warning', { seconds: 5 });
  assert.equal(n, 1);
});

test('publishers do not need subscribers', () => {
  assert.doesNotThrow(() => emit('nobody:listens', {}));
});

test('events are isolated by name', () => {
  let hits = 0;
  const off = on('game:over', () => hits++);
  emit('powerup:used', { type: 'hint' });
  off();
  assert.equal(hits, 0);
});
