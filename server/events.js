// Event bus (publish/subscribe) plus the Server-Sent Events hub that pushes updates to browsers.
// Publishers (game logic) emit events; the subscribers below decide what to do. They do not know about each other.
import { EventEmitter } from 'node:events';

export function createEvents(store) {
  const bus = new EventEmitter();
  const clients = new Set(); // open SSE responses

  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    clients.forEach((c) => c.write(msg));
  };

  bus.on('score', ({ user, score }) => {
    if (score <= (store.best.get(user) || 0)) return;
    store.best.set(user, score);
    store.save();
    broadcast('leaderboard', store.top());
  });
  bus.on('game:over', ({ user, score, difficulty }) => broadcast('activity', { text: `${store.nameOf(user)} finished a ${difficulty} game with ${score} pts` }));
  bus.on('streak', ({ user, streak }) => broadcast('activity', { text: `🔥 ${store.nameOf(user)} is on a ${streak}-answer streak` }));

  // Attach one browser connection to the stream.
  const subscribe = (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    clients.add(reply.raw);
    req.raw.on('close', () => clients.delete(reply.raw));
  };

  return { bus, broadcast, subscribe };
}
