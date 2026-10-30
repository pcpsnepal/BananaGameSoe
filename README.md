# Banana Game

Puzzle game built on the **Banana API** (https://marcconrad.com/uob/banana/doc.php).
Each puzzle is an image of six equations with a banana hiding one digit; the player picks the missing digit (0-9).

- **Three levels:** Easy (45s, ×1), Normal (30s, ×2), Hard (15s, ×3) per puzzle.
- **Scoring:** (10 + seconds left) × level, +25% per correct answer in a row (max +100%).
- **3 lives.** A wrong answer or a timeout costs one.
- **Power-ups:** 50/50 ×2 per game (removes 5 wrong digits, halves that puzzle's points) and Skip ×1 (free).
- **Live leaderboard and activity feed** pushed to every player over Server-Sent Events.
- **Accounts:** name, username, password + confirmation, validated on client and server. Saved to `server/data.json`, so they survive restarts.

Stack: **Fastify** (backend) · **React + Vite** (frontend) · **Tailwind CSS v4** (styling).

## Run

Needs Node 18+ and internet access (the Banana API is called live). Use two terminals.

```bash
# 1) API on :3001
cd server && npm install && npm start

# 2) Frontend on :5173 (proxies /api to :3001)
cd client && npm install && npm run dev
```

Open http://localhost:5173, create an account, pick a level and play. Press 0-9 on the keyboard to answer. For the live leaderboard, open a second browser (or a private window), register another user, and watch scores appear in the first window.

Tests (Banana API stubbed): `cd server && npm test`

## Architecture

```
React (browser) --JSON/cookie--> Fastify API --HTTPS/JSON--> Banana API (marcconrad.com)
        ^                              |
        +-------- SSE (events) --------+
```

The solution digit is kept in the server-side session. The browser only receives the image URL, so it cannot read the answer before submitting.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/register` | no | `{name, username, password, confirm}` → per-field errors in `fields` |
| POST | `/api/login` | no | `{username, password}` |
| POST | `/api/logout` | yes | destroy session |
| GET | `/api/me` | no | current user or `null` |
| POST | `/api/game` | yes | `{difficulty: easy\|normal\|hard}` starts a game, returns the first puzzle |
| GET | `/api/puzzle` | yes | current puzzle (same one after a reload) or the next one; 409 if no game |
| POST | `/api/answer` | yes | `{digit}` or `{timeout:true}` → `{correct, timedOut, points, score, lives, streak, over, solution}` |
| POST | `/api/hint` | yes | 50/50: returns 5 wrong digits to hide |
| POST | `/api/skip` | yes | swap the puzzle, no life lost |
| GET | `/api/leaderboard` | yes | top 10 |
| GET | `/api/events` | yes | Server-Sent Events: `leaderboard`, `activity` |

## The four themes (notes for the video)

- **Interoperability**: `server/app.js` `/api/puzzle` calls the third-party Banana API over HTTPS with `base64=yes`, so the puzzle image arrives inside the JSON and is sent to the browser as a data URL (the browser never contacts the third-party image host). The docs also offer `out=csv`; JSON was chosen because it parses natively. Failure maps to a 502. The image is served from the Banana host directly. Different stack from mine (a separate system I don't control), so the contract is the JSON format. Discuss: why proxy via the server (hide the solution) vs call from the browser.
- **Event-driven programming**: client: button clicks, keyboard/form events, `EventSource` listener. Server: an `EventEmitter` fires `score`, `game:over` and `streak`; listeners update the leaderboard and push `leaderboard` / `activity` events to every connected browser. The countdown is event-driven too: when the timer hits 0 the client reports a timeout, and the server independently enforces the limit. Discuss: SSE vs polling vs WebSockets.
- **Virtual identity**: passwords hashed with bcrypt (never stored in plain text); login issues a signed `httpOnly`, `sameSite=lax` session cookie via `@fastify/session`; session ID regenerated at login (session fixation); `auth` preHandler protects routes. Discuss alternatives: JWT, OAuth, MFA; and what's missing (HTTPS-only `secure` cookie, rate limiting, CSRF tokens).
- **Version control**: `git init`, one feature branch per theme (`feature/banana-api`, `feature/auth`, `feature/sse-leaderboard`), small commits, tag `v1.0`. `.gitignore` excludes `node_modules`/`dist`. The `server/` and `client/` split gives separate dependency manifests and clean diffs.

## Known limits

Game sessions are in memory (a server restart ends games in progress). Accounts and best scores are in `server/data.json` (gitignored). Set `SESSION_SECRET` for anything beyond local dev.

## Code from others / acknowledgements

- Banana API: Marc Conrad, University of Bedfordshire (https://marcconrad.com/uob/banana/).
- Libraries: Fastify, @fastify/cookie, @fastify/session, bcryptjs, React, Vite, Tailwind CSS (used per their docs).
- Code was written with help from an LLM (Claude). Add your own notes here on what you wrote or changed yourself.
