# Banana Game

Puzzle game built on the **Banana API** (https://marcconrad.com/uob/banana/doc.php).
Each puzzle is an image of six equations with a banana hiding one digit; the player picks the missing digit (0-9).

Stack: **Fastify** (backend) · **React + Vite** (frontend) · **Tailwind CSS v4** (styling).

## Features

- **Three levels:** Easy (45 s, ×1), Normal (30 s, ×2), Hard (15 s, ×3) per puzzle; the server enforces the time limit.
- **Scoring:** (10 + seconds left) × level, +25% per correct answer in a row (max +100%). 3 lives.
- **Power-ups:** 50/50 ×2 per game (halves that puzzle's points) and a free Skip ×1.
- **Live leaderboard and activity feed** pushed to every player (Server-Sent Events).
- **Accounts:** name, username, password + confirmation with validation and a strength meter; avatar, statistics and badges (First Banana, Speed Demon, Hot Streak, Veteran).
- **Motivational quote** after each game (ZenQuotes, with local fallback), Banana API latency shown on screen.
- **Sound effects and animations** for correct / wrong / time running out (muteable).
- **Admin panel** (players, login history, CSV export) and a **public JSON API** for other apps.

## Run

Needs Node 18+ and internet access (Banana API and ZenQuotes are called live). Use two terminals.

```bash
# 1) API on :3001
cd server && npm install && npm start

# 2) Frontend on :5173 (proxies /api to :3001)
cd client && npm install && npm run dev
```

Open http://localhost:5173, create an account, pick a level and play. Press 0-9 on the keyboard to answer.

**Make an admin** (there is deliberately no way to become admin from the website): register normally, stop the server, run
`cd server && npm run make-admin -- <username>`, then start it again. An "admin" link appears after the next login.

**Tests:** `cd server && npm test` (four test files, no network needed: external services are injected) and `cd client && npm test`.

**Configuration (environment variables)**

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_SECRET` | dev value | Signs session cookies. **Set this** outside local development. |
| `NODE_ENV=production` | | Marks cookies `Secure` (needs HTTPS) |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Web-app origins allowed to make state-changing requests |

Accounts, scores, stats and login history are saved to `server/data.json` (gitignored). Game sessions are in memory.

## Project structure

```
server/
  app.js            wires everything together (no logic)
  config.js         game constants            validation.js   registration rules
  store.js          accounts, scores, stats   profile.js       stats + badge rules (pure functions)
  events.js         server pub/sub + SSE      game.js         timing and scoring rules
  security.js       CSRF, origin check, headers, login limiter
  services/         banana.js (timeout, cache, circuit breaker) · quotes.js (ZenQuotes) · http.js
  routes/           auth.js · game.js · profile.js · admin.js · public.js
  make-admin.js     offline admin promotion
  test*.js          tests (core, resilience, security, profile)
client/src/
  App.jsx           screens (menu, game, profile, admin)    Landing.jsx   login / register
  events.js         client pub/sub (CustomEvent)            feedback.js   sound subscribers
  sound.js          Web Audio music + effects
```

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/register` | no | `{name, username, password, confirm}`; per-field errors in `fields` |
| POST | `/api/login` | no | `{username, password}`; 429 after 5 failures |
| POST | `/api/logout` | yes | destroy session |
| GET | `/api/me` | no | current user, role, avatar, `csrfToken` |
| POST | `/api/game` | yes | `{difficulty}` starts a game |
| GET | `/api/puzzle` | yes | current puzzle (same one after reload) or next one |
| POST | `/api/answer` | yes | `{digit}` or `{timeout:true}`; returns result, points, `newBadges`, `quote` at game over |
| POST | `/api/hint`, `/api/skip` | yes | power-ups |
| GET/POST | `/api/profile` | yes | stats, badges, avatar |
| GET | `/api/leaderboard` | yes | top 10 |
| GET | `/api/events` | yes | Server-Sent Events: `leaderboard`, `activity` |
| GET | `/api/admin/players`, `/api/admin/export.csv` | admin | players, login history, CSV |
| GET | `/api/v1/scores` | **public** | leaderboard for other apps (CORS open) |
| GET | `/api/v1/status` | **public** | Banana API circuit state, cache size, last latency |

All state-changing requests from a logged-in user need the `X-CSRF-Token` header.

## The four themes (notes for the video)

### 1. Version control and code organisation
- Server split by responsibility (config, store, events, game rules, services, routes); `app.js` only wires. The Banana API client knows nothing about HTTP routes, and the scoring rules know nothing about Fastify, so each part can be tested alone.
- Work was done on feature branches (`feature/countdown-timer`, `feature/landing-page`, `feature/registration-validation`, `feature/game-modes`, `refactor/server-modules`, `feature/api-resilience`, `feature/security`, `feature/event-feedback`, `feature/player-profile`), each with small commits and tests. See `git log --graph --oneline --all`.
- Alternatives to discuss: one big file (what `app.js` used to be: 212 lines), a framework such as NestJS/Laravel (more conventions and built-in security, more weight), a monorepo tool.

### 2. Event-driven programming
- **Browser events:** clicks, keyboard digits, form submit, `img onLoad`, timers (`setInterval` countdown, 5 s warning).
- **Client pub/sub** (`events.js`): `emit('puzzle:completed')` is published once; the sound effects, the green/red animation and the game-over handling each subscribe on their own. Also `time:warning`, `powerup:used`, `badge:earned`, `session:expired`.
- **Server pub/sub** (`events.js`): the game rules emit `answer`, `score`, `streak`, `game:over`, `badge`; subscribers update statistics and badges, the leaderboard, and push to browsers over **Server-Sent Events**. The rules do not know who listens.
- **Network failure handling:** fetch errors give a readable message; the event stream shows "reconnecting" and the browser retries by itself.
- Alternatives: polling (simple, wasteful), WebSockets (two-way, more setup than needed for one-way updates).

### 3. Interoperability
- **Consumes** the Banana API (JSON over HTTPS, `base64=yes` so the image travels inside the response) and ZenQuotes (REST/JSON). Both run on other people's systems in other stacks; the only contract is HTTP + JSON.
- **Resilience:** request timeouts, response validation, a 10-puzzle cache used when the API fails, a circuit breaker (3 failures, 30 s cooldown), a 60 s quote cache and local fallback quotes. Latency is measured and shown. `npm test` proves each behaviour with a fake `fetch`.
- **Provides** an API: `/api/v1/scores` and `/api/v1/status` return JSON for any other site or app, CORS enabled, versioned, and exposing only display names and scores.
- REST + JSON vs SOAP + XML: JSON parses natively in JavaScript and the data is simple; SOAP adds formal contracts and tooling that this project does not need.

### 4. Virtual identity and security
- **Authentication:** bcrypt password hashes (never plain text), server-side sessions with an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production), session ID regenerated at login (session fixation), 15-minute inactivity timeout, login lockout after 5 failures, same response time for unknown users.
- **Authorisation (RBAC):** `player` and `admin`; the role is read from the stored account on every request and `/api/admin/*` returns 403 for players (401 for anonymous). Admin can only be granted offline with `npm run make-admin`.
- **CSRF:** synchroniser token per session in `X-CSRF-Token`, plus an Origin allow-list; a forged cross-site request has the cookie but not the token.
- **Other controls:** server-side validation of every input, password-strength meter (advisory), login history, CSV export protected against spreadsheet formula injection, no hashes or usernames in any API response, nosniff / frame / referrer headers.
- Alternatives: JWT (stateless, harder to revoke), OAuth/OpenID Connect (no password to store, depends on a provider), 2FA (not implemented here: a second factor such as TOTP would be the next step). Known limits: sessions and the login limiter are in memory (single server only), there is no email verification or password reset.

## Not implemented

Two-factor authentication, a daily challenge, a real database (JSON file instead), HTTPS termination (use a reverse proxy).

## Code from others / acknowledgements

- Banana API: Marc Conrad, University of Bedfordshire (https://marcconrad.com/uob/banana/). Quotes: ZenQuotes (https://zenquotes.io/), credited in the UI as their terms ask.
- Libraries: Fastify, @fastify/cookie, @fastify/session, bcryptjs, React, Vite, Tailwind CSS (used per their docs).
- Code was written with help from an LLM (Claude). Add your own notes here on what you wrote or changed yourself.
