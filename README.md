# Banana Game

Puzzle game built on the **Banana API** (https://marcconrad.com/uob/banana/doc.php).
Each puzzle is an image of an equation with one digit hidden; the player picks the missing digit (0-9).
3 lives, 1 point per correct answer, live leaderboard.

Stack: **Fastify** (backend) · **React + Vite** (frontend) · **Tailwind CSS v4** (styling).

## Run

Needs Node 18+ and internet access (the Banana API is called live). Use two terminals.

```bash
# 1) API on :3001
cd server && npm install && npm start

# 2) Frontend on :5173 (proxies /api to :3001)
cd client && npm install && npm run dev
```

Open http://localhost:5173, register, and play. For the live leaderboard, open a second browser (or a private window), register another user, and watch scores appear in the first window.

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
| POST | `/api/register` `/api/login` | no | `{username, password}` |
| POST | `/api/logout` | yes | destroy session |
| GET | `/api/me` | no | current user or `null` |
| GET | `/api/puzzle` | yes | fetch a puzzle from Banana API → `{image, lives, score}` |
| POST | `/api/answer` | yes | `{digit}` → `{correct, solution, score, lives, over}` |
| GET | `/api/leaderboard` | yes | top 10 |
| GET | `/api/events` | yes | Server-Sent Events: `leaderboard` |

## The four themes (notes for the video)

- **Interoperability**: `server/app.js` `/api/puzzle` calls the third-party Banana API over HTTPS, returning JSON `{question, solution}`. Failure maps to a 502. The image is served from the Banana host directly. Different stack from mine (a separate system I don't control), so the contract is the JSON format. Discuss: why proxy via the server (hide the solution) vs call from the browser.
- **Event-driven programming**: client: button clicks, keyboard/form events, `EventSource` listener. Server: an `EventEmitter` fires `score`; its listener updates the leaderboard and pushes a `leaderboard` event to every connected browser. Discuss: SSE vs polling vs WebSockets.
- **Virtual identity**: passwords hashed with bcrypt (never stored in plain text); login issues a signed `httpOnly`, `sameSite=lax` session cookie via `@fastify/session`; session ID regenerated at login (session fixation); `auth` preHandler protects routes. Discuss alternatives: JWT, OAuth, MFA; and what's missing (HTTPS-only `secure` cookie, rate limiting, CSRF tokens).
- **Version control**: `git init`, one feature branch per theme (`feature/banana-api`, `feature/auth`, `feature/sse-leaderboard`), small commits, tag `v1.0`. `.gitignore` excludes `node_modules`/`dist`. The `server/` and `client/` split gives separate dependency manifests and clean diffs.

## Known limits

Users and scores are in memory and reset on server restart. Set `SESSION_SECRET` for anything beyond local dev.

## Code from others / acknowledgements

- Banana API: Marc Conrad, University of Bedfordshire (https://marcconrad.com/uob/banana/).
- Libraries: Fastify, @fastify/cookie, @fastify/session, bcryptjs, React, Vite, Tailwind CSS (used per their docs).
- Code was written with help from an LLM (Claude). Add your own notes here on what you wrote or changed yourself.
