# Video preparation: likely questions and answers

For your 10-minute video. The answers describe **this project as it really is**. Put them in your own words: the brief requires your own voice and an obviously genuine understanding, so do not read them out. Where an answer says "(file)", you can show that file on screen.

## 0. Plan for 10 minutes

| Time | Content |
|---|---|
| 0:00-1:00 | **Demo first** (required): log in, start a game, make a guess, use a power-up, show the leaderboard updating in a second window |
| 1:00-3:00 | **Version control and code organisation** |
| 3:00-5:00 | **Event-driven programming** |
| 5:00-7:30 | **Interoperability** |
| 7:30-9:30 | **Virtual identity and security** |
| 9:30-10:00 | Compare the themes, limits, what you would do next |

Tip: the brief wants you to compare and reflect, not list features. For each theme say what you chose, why, and one alternative you rejected.

## 1. The project in one minute

**What is it?** Banana Mastermind. The server builds a secret 4-digit code from the solution digits of four Banana API puzzles. The player solves the four puzzle pictures and guesses; each guess returns pegs (green = right digit, right place; hollow yellow = right digit, wrong place). Three levels, 3 lives, streak bonus, power-ups, live leaderboard, profile and badges.

**What is the architecture?** A React single-page app (browser) talks JSON over HTTP to a Fastify server. The server talks to two external services (Banana API, ZenQuotes) and pushes live updates back to browsers with Server-Sent Events. It is a three-party distributed system: browser, our server, third-party services.

**Why Fastify, React and Tailwind?** Fastify is fast, small and has first-class plugins for cookies and sessions. React suits a screen that changes a lot (board, timer, pegs). Tailwind keeps styling next to the markup with no separate CSS to maintain. (The Express version I made first was a smaller prototype.)

**Why not PHP like the guide?** The guide is written for PHP but the brief says any language is fine. I used JavaScript on both sides so the browser and server share a language, and the example code in the unit includes JavaScript.

**Why Mastermind rather than the equation puzzle?** I wanted a non-maths game that still depends on the Banana API. The API gives me trustworthy random digits from an external system; the rules and scoring are mine.

## 2. Theme 1: Version control and code organisation

**How did you use Git?** Feature branches, one per piece of work: `feature/countdown-timer`, `feature/landing-page`, `feature/registration-validation`, `feature/game-modes`, `refactor/server-modules`, `feature/api-resilience`, `feature/security`, `feature/event-feedback`, `feature/player-profile`. Small commits with descriptive messages, tags `v1.0` and `v2.0`, and the repository is on GitHub.

**Be honest about the history.** The project began from a generated baseline (one initial commit), then I built features on branches. The Mastermind game ended up directly on `main` because renaming the branch moved it; no work was lost. Say this plainly if asked. Do not claim a history that is not there.

**Why branches?** Each branch isolates one feature, so a half-finished feature never breaks `main`, and I can compare, test and discard it independently. They also make the work reviewable.

**What is a good commit?** One logical change, a message that says what and why, and the tests passing. Example: "Fix: build() defaulted timeLimitMs to 30000, so every level used 30 s." One commit per idea gives a readable history and makes `git bisect` or revert practical.

**What are tags for?** A tag names a release point: `v1.0` is the first complete game with login, leaderboard and countdown; `v2.0` is the Mastermind game with resilience, security, events and profile. I can check out either to show how the project changed.

**How is the code organised?** (show `server/` on screen)
- `app.js` wires only; no logic.
- `config.js` constants; `validation.js` registration rules; `store.js` accounts and scores; `profile.js` stats and badge rules (pure functions).
- `game.js` Mastermind scoring and timing; `events.js` publish/subscribe and SSE.
- `services/banana.js`, `services/quotes.js`: the only code that calls external APIs.
- `routes/auth.js`, `game.js`, `profile.js`, `admin.js`, `public.js`: HTTP only.
- `security.js`: CSRF, origin check, headers, login limiter.

**What is the single-responsibility principle here?** `services/banana.js` knows how to get digits and survive failure; it knows nothing about routes. `game.js` knows the rules; it knows nothing about HTTP. That is why I can test the rules and the API client with no server and no network.

**How does the structure help testing?** External services are injected: `build({ banana, quotes })`. Tests pass fakes, so they are fast and never touch the internet. There are four server test files and one client test file.

**Why not a framework like NestJS, Laravel or Symfony?** For a project this size a framework adds configuration and conventions I would not use. Fastify plus small modules gives clear structure with little overhead. A framework would give built-in security features and conventions that help a larger team, so for a bigger product I would reconsider.

**Alternatives to your branching?** Trunk-based development (everyone commits small changes to `main` behind feature flags) or Gitflow (develop and release branches). Feature branches suit one developer and a short project. With a team I would add pull requests and code review before merging, and CI to run the tests.

**How would code review help?** A second person checks correctness, security and readability before merge. Here the automated tests act as a first reviewer, and I broke the code deliberately to check the tests actually fail.

**How do you manage dependencies?** `package.json` and lockfiles are committed so everyone installs the same versions. `node_modules`, build output, `data.json` (accounts) and `.idea` are in `.gitignore`.

**What did you use that is not yours?** Fastify, `@fastify/cookie`, `@fastify/session`, bcryptjs, React, Vite, Tailwind, the Banana API and ZenQuotes. An AI assistant helped write the code, and the README says so. (The brief allows AI for code but not for the video.)

## 3. Theme 2: Event-driven programming

**What is event-driven programming?** The program reacts to events instead of following one fixed sequence. Something happens (a click, a timer, a network reply), and registered handlers run.

**List the events in your game.**
- Browser: button clicks, keyboard digits, Backspace and Enter, form submit, `setInterval` countdown, image/network responses.
- Client bus (custom events): `puzzle:completed`, `guess:submitted`, `game:over`, `time:warning`, `powerup:used`, `badge:earned`, `session:expired`.
- Server bus: `answer`, `score`, `streak`, `game:over`, `badge`.
- Server-Sent Events to the browser: `leaderboard`, `activity`.

**Show an example of publish/subscribe.** When a code ends, the game publishes one event, `puzzle:completed`. Three separate subscribers react: the sound module plays a sound, the board flashes green/red/amber, and the game-over logic runs. The publisher does not know they exist. (files: `client/src/events.js`, `feedback.js`, `App.jsx`)

**Why is that better than calling three functions?** Loose coupling: I added sound later without changing the game code. Subscribers can be added or removed independently, and each is easy to test.

**Which pattern is this?** Publisher-Subscriber (observer). On the client it is built on the browser's own `EventTarget` and `CustomEvent`; on the server on Node's `EventEmitter`.

**How does the countdown work?** The client runs `setInterval` every 250 ms and shows the time left. At 5 seconds it publishes `time:warning` (beep, red pulsing bar). At 0 it tells the server. **The server also enforces the limit itself**, so refreshing the page or editing JavaScript cannot buy extra time.

**What happens if the browser says "time is up" too early?** The server only accepts a client-reported timeout if at least (limit minus 1 second) has really passed. A 1-second allowance covers network delay and clock differences.

**Why Server-Sent Events rather than polling or WebSockets?** Updates only flow server to browser, one way, which is exactly what SSE is for. Polling wastes requests and is delayed; WebSockets are two-way and need more setup than I need. SSE reconnects automatically, and the page shows "reconnecting" when the stream drops. A limitation: SSE connections are not in the session timeout renewal, and one server only.

**How do you handle failed requests?** `api()` catches network errors and shows "Cannot reach the server", handles non-JSON proxy errors, and a 401 on a protected call publishes `session:expired` so the app returns to login with a message.

**What are asynchronous requests?** `fetch` sends the guess without reloading the page; the page keeps running and updates when the reply arrives. Risks are late replies and failures, so handlers must cope with both.

**Is there an event on the server that is not a network request?** Yes: game rules publish `answer` and `game:over`; subscribers update statistics, award badges, update the leaderboard and push to browsers. The rules do not know who is listening.

**How do badges use events?** `answer` and `game:over` events feed pure functions in `profile.js`; if a badge is earned, a `badge` event is published, which sends an activity message to everyone and a toast to the player.

## 4. Theme 3: Interoperability

**What is interoperability?** Different systems, possibly in different languages and on different machines, exchanging information through an agreed interface and data format.

**Where does your code interoperate?** Banana API (digits), ZenQuotes (quote at game over), and our own public API for other apps. Also browser to server.

**What protocol and format?** HTTPS with REST-style GET requests and JSON. Our own live updates use Server-Sent Events over HTTP.

**Show the Banana API call.** `GET https://marcconrad.com/uob/banana/api.php?out=json` returns `{ "question": <image URL>, "solution": <digit> }`. I make four calls in parallel and use the four `solution` values as the code. The image URL never goes to the browser, because its filename ends in the solution digit; my server downloads the picture and serves it from `/api/puzzle/:index`. (file: `server/services/banana.js`)

**Why does the server call it, not the browser?** The code must stay secret: if the browser fetched the digits, anyone could read them in dev tools. CORS was not the problem (the API allows any origin). The server also gives a shared cache, a circuit breaker and validation.

**How do you cope when the API fails?**
- 5-second timeout so the game never hangs.
- Validation: the solution must be a whole digit 0-9.
- A cache of the last 40 digits; failed calls fall back to it, and the screen says "cached digits".
- A circuit breaker: after 3 failures in a row it stops calling for 30 seconds, then allows one trial.
- Latency is measured and shown (for example "Banana API: 429 ms").
- If the API is down and nothing is cached, the server returns 502 and the game shows an error.

**What is a circuit breaker?** A guard that stops repeated calls to a failing service, so failures do not slow every request. States: closed (normal), open (not calling), half-open (one trial). `/api/v1/status` shows the current state.

**What is caching and what did you cache?** Keeping a result to reuse it. I cache Banana digits (resilience) and the last quote for 60 seconds (also protects ZenQuotes' rate limit).

**Why ZenQuotes?** A second, independent external service. It adds a different failure mode: it can be slow or rate-limited. I use a 2-second timeout and fall back to seven local quotes, and the UI credits ZenQuotes as their terms ask.

**Do you also provide an API?** Yes: `GET /api/v1/scores` (public, JSON, CORS open, versioned) and `/api/v1/status`. Another website or mobile app could show our leaderboard. It exposes only display names, avatars and scores: never login names, hashes or sessions.

**Consuming versus providing an API?** Consuming: we call the Banana API. Providing: others call `/api/v1/scores`. Doing both shows two-way participation in a distributed system.

**Why JSON and not XML/SOAP?** JSON parses natively in JavaScript, is compact and readable, and my data is simple. SOAP/XML adds formal contracts and tooling that this project does not need; it would suit systems that require WS-* standards.

**Why REST?** Resources have URLs and HTTP methods have meaning (GET reads, POST changes), which is easy to understand, cache and test.

**Why `out=json` and not `base64=yes` or `out=csv`?** The digit call stays at about 100 bytes, and the picture is fetched separately, so a picture failure never loses the digit. `base64=yes` would put the whole PNG (about 60 KB) into every call and into the digit cache. CSV is also small, but JSON is typed and safer to validate.

**Did you disable certificate checks or anything unsafe for the API?** No. All calls use normal HTTPS verification; I never turn it off.

**How do you test external services without the internet?** `fetch` is injected into the clients, so tests use fake services: success, bad payloads, timeouts, flaky, down, rate limited. No network is needed.

**What are the weaknesses?** The game depends on the Banana API's good behaviour and availability; the terms say it may be discontinued and it must not be used commercially. The picture link gives the answer away in its filename, so I never expose it; that means my server downloads and re-serves every picture (about 40 KB each), and if the picture host is down the player has only the pegs for that code.

**How would a mobile app use your system?** It would call the same JSON endpoints, or just `/api/v1/scores` for the leaderboard.

## 5. Theme 4: Virtual identity and security

**What is virtual identity?** The digital identity the application holds for a person: account, name, avatar, password, session, scores, statistics and badges. The app must recognise the player and protect that identity.

**Authentication versus authorisation?** Authentication: who are you (username and password). Authorisation: what may you do (players play; admins see the admin panel).

**How are passwords stored?** Hashed with bcrypt (cost 10) via bcryptjs, never plain text. Login compares with `bcrypt.compare`. Hashing is one-way: the password cannot be recovered. (file: `server/routes/auth.js`)

**Why bcrypt?** It is deliberately slow and salted, so guessing attacks are expensive and identical passwords get different hashes. It ignores bytes past 72, so the server rejects longer passwords.

**How is the user kept logged in?** A server-side session. After login the server sets a cookie with a session ID; the browser sends it with every request; the server looks up who it is. The browser never supplies the username as proof.

**Which cookie settings and why?** `HttpOnly` (JavaScript cannot read it), `SameSite=Lax` (limits cross-site sending), `Secure` in production (HTTPS only), and a 15-minute lifetime that renews on each response, so idle sessions expire.

**What is session fixation and how do you stop it?** An attacker plants a known session ID before the victim logs in. I call `session.regenerate()` on login and registration, so the ID changes when privileges change.

**What is CSRF and how do you stop it?** A malicious site makes a logged-in user's browser send a request to our server using their cookie. Defence: a random token (32 bytes) created at login, kept in the session, and required in the `X-CSRF-Token` header on every state-changing request. The attacker's page can make the browser send the cookie but cannot read the token. I also refuse requests whose `Origin` is not our own or on an allow-list, and `SameSite=Lax` is a second layer.

**A real bug the browser test found?** The first Origin check compared with the server's own host, which broke login through the Vite dev proxy. Replaced with an explicit `allowedOrigins` list.

**How do you handle brute-force guessing?** After 5 failed logins for the same IP and username within 5 minutes the server answers 429 with `Retry-After`, even if the next password is right. Unknown usernames are compared against a dummy hash, so response time does not reveal which usernames exist.

**What is RBAC and how is it implemented?** Role-based access control. Accounts have a role (`player` or `admin`). `/api/admin/*` uses `requireRole('admin')`, which reads the role from the stored account on every request: 401 if not logged in, 403 if not admin. Hiding the admin link is not security; the server check is.

**How does someone become admin?** Only offline: `npm run make-admin -- <username>`. There is deliberately no web or registration route to admin, so no one can promote themselves.

**What input validation is there?** The server validates everything: name 2-30 letters, username 3-20 characters (letters, digits, `.` `_` `-`), password at least 8 characters with a letter and a number, not equal to the username, and confirmation must match. The client repeats the rules only for fast feedback. Guesses must be exactly four integers 0-9; difficulty must be one of three values.

**What is the password strength meter?** An advisory indicator on the registration form. It is not enforcement; the server rules are.

**What else protects data?** Login history (admin only, capped at 200 entries, usernames sanitised), CSV export protected against spreadsheet formula injection (cells starting with `=`, `+`, `-`, `@` are neutralised), no hashes or usernames in public API responses, and response headers `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.

**Is the secret code safe?** Yes: it stays in the server-side session. The browser only receives peg feedback, and the code only after the code is over, plus any digit the player chose to reveal. The puzzle pictures are served by my own server under opaque URLs, because the Banana image filename ends in the solution digit.

**Why sessions rather than JWT or OAuth?** Sessions suit a normal web app: the server can end a session instantly, and no token is stored in the browser where scripts could read it. JWT is stateless and useful for APIs and many services, but revoking a token before it expires needs extra work. OAuth/OpenID Connect means logging in through a provider (for example Google), so I would not store passwords at all, but I would depend on that provider. For a mobile app or several services I would move to tokens or OAuth.

**Why no two-factor authentication?** It was optional in the guide and I chose not to add it. The next step would be TOTP (authenticator app codes) as a real second factor; a PIN would not count as one because it is just another thing you know.

**What are the known limits?** Sessions and the login limiter are in memory (one server only, lost on restart). Accounts are stored in a JSON file, not a real database. No email verification or password reset. HTTPS must be provided by a reverse proxy in production. Behind a proxy the limiter needs Fastify's `trustProxy`.

**What would you do for production?** HTTPS, a database, a persistent session store such as Redis, `SESSION_SECRET` set, rate limiting at the proxy, password reset and email verification, and 2FA.

## 6. Testing and quality

**How did you test?** Automated tests plus manual browser checks. Four server test files (core rules, resilience, security, profile) and a client event test. Around 170 assertion lines run without a network.

**How do you know the tests are real?** I broke the code on purpose (removed the CSRF check, removed the session timeout, broke duplicate-digit scoring, ignored the level time limits) and confirmed the tests failed each time.

**Give an example of a bug testing found.** The level time limits were being ignored: `build()` defaulted to 30 seconds, so Easy, Normal and Hard all used 30 s. A test that checked each level's total time caught it, and it is fixed.

**How do tests connect to Git?** Each branch gets its tests passing before it is merged or built on. Running `npm test` before each commit is the habit.

**What about manual testing?** Registration, login, game flow, timeout, session expiry, admin panel, profile and avatar were each tried in the browser. Not tested in a browser: sound quality, the badge toast, and the game-over quote screen.

## 7. Scoring and game rules (they may ask for detail)

**How is the score calculated?** `(100 + 10 x unused guesses + seconds left) x level x streak bonus`, where the streak bonus is +25% per code cracked in a row (maximum +100%), halved if a digit was revealed. Levels: Easy 10 guesses and 3 minutes (x1), Normal 8 and 2 minutes (x2), Hard 6 and 90 seconds (x3).

**How do the pegs work with repeated digits?** Exact matches are counted first, then each remaining guess digit can match a remaining secret digit only once. Example: secret 1,2,3,4 and guess 1,1,5,5 gives one exact and no partial, not two.

**Why does the server calculate the score?** The browser can be modified. Anything that affects fairness (time limits, scoring, hints, lives) is enforced server-side.

**What do the power-ups do?** Reveal a digit (two per game, at most three digits revealed) shows a true digit at its true position and halves that code's points. New code (one per game) swaps the code with no life lost.

**What happens on reload?** The server returns the same code with the remaining time, so reloading cannot dodge the timer, and the guess history and revealed digits come back.

## 8. Comparing the four themes (for the conclusion)

**How do the themes relate?** They support each other. Version control and modular code made it possible to add resilience, security and events safely, each on its own branch with tests. Events connect the parts (game rules, leaderboard, sound, badges) without tight coupling. Interoperability brings in outside data, which is a trust boundary, so it needs validation, timeouts and fallbacks. Identity and security protect the data and rules that all the other parts rely on.

**Which theme was hardest?** Choose your honest answer. Good candidates: security (CSRF and Origin rules interact with the dev proxy), or resilience (parallel calls, circuit breaker states).

**What would you change?** Use a real database and a shared session store, add 2FA and password reset, add a proper code review and CI to the Git workflow.

**Which design decision are you most proud of, and why?** For example: enforcing the rules on the server, because browsers cannot be trusted, which links security, interoperability and distributed design in one decision.

## 9. Quick check before recording

- [ ] You can start both servers and show login, a guess, a power-up and the leaderboard updating live.
- [ ] You can open these files on screen: `server/app.js`, `server/services/banana.js`, `server/security.js`, `client/src/events.js`, `git log --oneline --graph --all`.
- [ ] You present your work to the tutor in Week 8 or earlier and keep the evidence.
- [ ] The video has **your own voice** (no AI-generated voice or script read-out).
- [ ] The README's "Code from others" section lists what came from libraries, the APIs and the AI assistant, with notes on what you wrote or changed.
- [ ] You are ready to say honestly what is generated, what you changed, and what you would do differently.
