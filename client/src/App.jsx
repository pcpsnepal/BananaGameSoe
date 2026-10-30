import { useCallback, useEffect, useState } from 'react';
import Landing from './Landing.jsx';
import { emit, on } from './events.js';
import { subscribeFeedback } from './feedback.js';
import { isMuted, setMuted } from './sound.js';

let csrf = null; // CSRF token from the server (login/register/me); sent back on every state-changing request
const api = async (url, body) => {
  let r;
  try {
    r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrf && { 'X-CSRF-Token': csrf }) }, body: JSON.stringify(body) } : undefined);
  } catch {
    throw new Error('Cannot reach the server. Check your connection and try again.'); // network failure
  }
  const j = await r.json().catch(() => ({})); // a proxy error page is not JSON
  if (j?.csrfToken !== undefined) csrf = j.csrfToken;
  // A 401 on a protected route means the session ended (e.g. 15 min idle): publish an event for the rest of the app.
  if (r.status === 401 && !/^\/api\/(login|register|me)/.test(url)) emit('session:expired');
  if (!r.ok) throw Object.assign(new Error(j.error || j.message || `Request failed (${r.status})`), { fields: j.fields, status: r.status });
  return j;
};

const LEVELS = [
  { id: 'easy', name: 'Easy', desc: '45 seconds per puzzle', mult: '×1', style: 'bg-green-600 hover:bg-green-500' },
  { id: 'normal', name: 'Normal', desc: '30 seconds per puzzle', mult: '×2', style: 'bg-yellow-500 text-slate-900 hover:bg-yellow-400' },
  { id: 'hard', name: 'Hard', desc: '15 seconds per puzzle', mult: '×3', style: 'bg-red-600 hover:bg-red-500' },
];

function Leaderboard({ rows, live }) {
  return (
    <section className="rounded-lg bg-slate-800 p-4">
      <h2 className="font-bold mb-2">🏆 Leaderboard <span className={`text-xs ${live ? 'text-slate-400' : 'text-amber-400'}`}>{live ? '(live)' : '(reconnecting…)'}</span></h2>
      {rows.length === 0 && <p className="text-slate-400 text-sm">No scores yet.</p>}
      <ol className="space-y-1">
        {rows.map((r, i) => <li key={i} className="flex justify-between"><span>{i + 1}. {r.avatar} {r.user}</span><b>{r.score}</b></li>)}
      </ol>
    </section>
  );
}

function Activity({ items }) {
  return (
    <section className="rounded-lg bg-slate-800 p-4">
      <h2 className="font-bold mb-2">📣 Live activity</h2>
      {items.length === 0 && <p className="text-slate-400 text-sm">Waiting for players…</p>}
      <ul className="space-y-1 text-sm text-slate-300" aria-live="polite">
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </section>
  );
}

function Menu({ onStart, err }) {
  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-xs">
      <p className="text-slate-300 text-center">Find the digit hidden behind the banana to complete the equations.</p>
      <div className="w-full flex flex-col gap-2">
        {LEVELS.map((l) => (
          <button key={l.id} onClick={() => onStart(l.id)} className={`rounded-xl px-4 py-3 text-left font-bold flex justify-between items-center ${l.style}`}>
            <span>{l.name}<span className="block text-xs font-normal opacity-90">{l.desc}</span></span>
            <span className="text-xl">{l.mult} points</span>
          </button>
        ))}
      </div>
      <p className="h-5 text-red-400 text-sm" role="alert">{err}</p>
      <ul className="text-sm text-slate-400 space-y-1 list-disc pl-5">
        <li>Faster answers score more: (10 + seconds left) × level.</li>
        <li>Each correct answer in a row adds +25% (up to +100%).</li>
        <li>3 lives. A wrong answer or timeout costs one.</li>
        <li>Power-ups: 50/50 ×2 (halves that puzzle's points), Skip ×1 (free).</li>
      </ul>
    </div>
  );
}

function Game() {
  const [phase, setPhase] = useState('loading'); // loading | menu | play
  const [puzzle, setPuzzle] = useState(null); // server view of the current puzzle
  const [fb, setFb] = useState(null); // result of the last answer, shown until "Next"
  const [left, setLeft] = useState(null); // seconds remaining (display only, the server enforces the limit)
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);
  const [feed, setFeed] = useState([]);
  const [live, setLive] = useState(true); // is the event stream connected?
  const [flash, setFlash] = useState(''); // '', 'correct', 'wrong' or 'timeout': drives the answer animation
  const [loaded, setLoaded] = useState(false); // has the puzzle image finished loading?
  const fail = (e) => setErr(e.message);

  // An answer was settled: update the screen and publish events. Sound is a separate subscriber (feedback.js).
  const settled = useCallback((r) => {
    setFb(r);
    emit('puzzle:completed', r);
    if (r.over) emit('game:over', r);
    (r.newBadges ?? []).forEach((b) => emit('badge:earned', b));
  }, []);

  // Visual feedback is just another subscriber of the same event.
  useEffect(() => on('puzzle:completed', (r) => {
    setFlash(r.correct ? 'correct' : r.timedOut ? 'timeout' : 'wrong');
    setTimeout(() => setFlash(''), 800);
  }), []);

  const enter = useCallback((p) => { setPuzzle(p); setFb(null); setLeft(null); setErr(''); setLoaded(false); setPhase('play'); }, []);
  const toMenu = () => { setPuzzle(null); setFb(null); setErr(''); setPhase('menu'); };

  useEffect(() => {
    api('/api/puzzle')
      .then((r) => (r.result ? (setPuzzle(null), setFb(r.result), setPhase('play')) : enter(r)))
      .catch((e) => (e.status === 409 ? setPhase('menu') : (setErr(e.message), setPhase('menu'))));
    api('/api/leaderboard').then(setRows).catch(() => {});
    const es = new EventSource('/api/events'); // server push: leaderboard + activity update live
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false); // the browser retries by itself
    es.addEventListener('leaderboard', (e) => setRows(JSON.parse(e.data)));
    es.addEventListener('activity', (e) => setFeed((f) => [JSON.parse(e.data).text, ...f].slice(0, 5)));
    return () => es.close();
  }, [enter]);

  // countdown: displays the time left and reports expiry
  useEffect(() => {
    if (!puzzle || fb) return;
    const end = Date.now() + puzzle.seconds * 1000;
    let warned = false;
    const t = setInterval(() => {
      const s = Math.ceil((end - Date.now()) / 1000);
      setLeft(Math.max(s, 0));
      if (s <= 5 && s > 0 && !warned) { warned = true; emit('time:warning', { seconds: s }); }
      if (s <= 0) { clearInterval(t); api('/api/answer', { timeout: true }).then(settled).catch(fail); }
    }, 250);
    return () => clearInterval(t);
  }, [puzzle, fb, settled]);

  const answer = useCallback((digit) => { if (puzzle && !fb) api('/api/answer', { digit }).then(settled).catch(fail); }, [puzzle, fb, settled]);

  // keyboard: press 0-9 to answer
  useEffect(() => {
    const h = (e) => { if (/^\d$/.test(e.key) && !e.ctrlKey && !e.metaKey && !puzzle?.removed.includes(Number(e.key))) answer(Number(e.key)); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [answer, puzzle]);

  const start = (difficulty) => { setErr(''); api('/api/game', { difficulty }).then(enter).catch(fail); };
  const next = () => (fb.over ? toMenu() : api('/api/puzzle').then(enter).catch(fail));
  const hint = () => api('/api/hint', {}).then((r) => { emit('powerup:used', { type: 'hint' }); setPuzzle((p) => ({ ...p, removed: r.removed, hints: r.hints })); }).catch(fail);
  const skip = () => api('/api/skip', {}).then((p) => { emit('powerup:used', { type: 'skip' }); enter(p); }).catch(fail);

  if (phase === 'loading') return null;

  const hud = fb ?? puzzle;
  const level = LEVELS.find((l) => l.id === puzzle?.difficulty);
  const secs = left ?? puzzle?.seconds ?? 0;
  const btn = 'rounded-lg px-3 py-1 text-sm font-semibold disabled:opacity-40';

  return (
    <div className="w-full flex flex-col items-center gap-4">
      {phase === 'menu' ? <Menu onStart={start} err={err} /> : (
        <>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-lg">
            <span>Score <b>{hud?.score ?? 0}</b></span>
            <span>{'❤️'.repeat(Math.max(hud?.lives ?? 0, 0)) || '💀'}</span>
            {hud?.streak > 0 && <span title="Correct answers in a row">🔥 ×{hud.streak}</span>}
            {level && <span className="text-sm self-center rounded-full bg-white/10 px-2">{level.name} {level.mult}</span>}
          </div>

          {puzzle && !fb && (
            <div className="w-full max-w-xs" role="timer" aria-live="off">
              <div className="h-2 rounded bg-slate-700 overflow-hidden">
                <div className={`h-full transition-all duration-300 ${secs <= 5 ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} style={{ width: `${(secs / puzzle.total) * 100}%` }} />
              </div>
              <p className={`text-center text-sm mt-1 ${secs <= 5 ? 'text-red-400 font-bold' : 'text-slate-300'}`}>⏱ {secs}s</p>
            </div>
          )}

          {puzzle && (
            <img src={puzzle.image} onLoad={() => setLoaded(true)} alt="Banana puzzle: what digit replaces the banana?"
              className={`rounded-lg bg-white max-w-full transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'} ${flash && `flash-${flash}`}`} />
          )}
          {puzzle?.api && (
            <p className="text-xs text-slate-500" title="Round-trip time of our server's request to the Banana API">
              Banana API: {puzzle.api.source === 'live' ? `${puzzle.api.latencyMs} ms` : 'cached puzzle (service unreachable)'}
            </p>
          )}
          <p className="h-5 text-red-400 text-sm" role="alert">{err}</p>

          {!fb ? (
            <>
              <div className="grid grid-cols-5 gap-2">
                {[...Array(10).keys()].map((d) => {
                  const gone = puzzle?.removed.includes(d);
                  return (
                    <button key={d} onClick={() => answer(d)} disabled={gone}
                      className="w-12 h-12 rounded bg-yellow-500 text-slate-900 text-xl font-bold hover:bg-yellow-400 disabled:bg-slate-700 disabled:text-slate-500">{gone ? '·' : d}</button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <button onClick={hint} disabled={!puzzle || puzzle.hints <= 0 || puzzle.removed.length > 0} className={`${btn} bg-indigo-600 hover:bg-indigo-500`}>🎯 50/50 ({puzzle?.hints ?? 0})</button>
                <button onClick={skip} disabled={!puzzle || puzzle.skips <= 0} className={`${btn} bg-slate-600 hover:bg-slate-500`}>⏭ Skip ({puzzle?.skips ?? 0})</button>
              </div>
            </>
          ) : (
            <div className="text-center">
              <p className={`text-xl font-semibold ${fb.correct ? 'text-green-400' : fb.timedOut ? 'text-amber-400' : 'text-red-400'}`} role="status">
                {fb.correct ? `✅ Correct! +${fb.points} pts` : fb.timedOut ? `⏰ Time's up! It was ${fb.solution}` : `❌ Wrong, it was ${fb.solution}`}
              </p>
              {fb.over && <p className="mt-1 text-slate-300">Game over: <b>{fb.score}</b> points, best streak <b>{fb.bestStreak}</b></p>}
              {fb.over && fb.quote && (
                <figure className="mt-3 max-w-xs mx-auto rounded-lg bg-slate-800 p-3 text-sm">
                  <blockquote className="italic text-slate-200">“{fb.quote.text}”</blockquote>
                  <figcaption className="mt-1 text-slate-400">
                    {fb.quote.author}
                    {fb.quote.source === 'local'
                      ? ' (offline quote)'
                      : <> · <a className="underline" href="https://zenquotes.io/" target="_blank" rel="noreferrer">Inspirational quotes provided by ZenQuotes API</a></>}
                  </figcaption>
                </figure>
              )}
              <button onClick={next} autoFocus className="mt-2 rounded bg-indigo-600 px-4 py-2 font-semibold hover:bg-indigo-500">
                {fb.over ? 'Play again' : 'Next puzzle'}
              </button>
            </div>
          )}
        </>
      )}
      <div className="w-full max-w-xs flex flex-col gap-3">
        <Leaderboard rows={rows} live={live} />
        <Activity items={feed} />
      </div>
    </div>
  );
}

function Profile({ onAvatar }) {
  const [p, setP] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/api/profile').then(setP).catch((e) => setErr(e.message)); }, []);
  const pick = (avatar) => api('/api/profile', { avatar }).then(() => { setP((x) => ({ ...x, avatar })); onAvatar(avatar); }).catch((e) => setErr(e.message));
  if (err) return <p className="text-red-400" role="alert">{err}</p>;
  if (!p) return null;
  const stat = (label, value) => (
    <div className="rounded-lg bg-slate-700/60 px-3 py-2 text-center"><div className="text-xl font-bold">{value}</div><div className="text-xs text-slate-400">{label}</div></div>
  );
  return (
    <div className="w-full max-w-md flex flex-col gap-4">
      <section className="rounded-lg bg-slate-800 p-4 text-center">
        <div className="text-6xl" aria-hidden="true">{p.avatar}</div>
        <h2 className="text-xl font-bold mt-1">{p.name}</h2>
        <p className="text-sm text-slate-400">@{p.username}{p.last_login && <> · last visit {new Date(p.last_login).toLocaleString()}</>}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Choose your avatar">
          {p.avatars.map((a) => (
            <button key={a} role="radio" aria-checked={a === p.avatar} onClick={() => pick(a)}
              className={`h-10 w-10 rounded-lg text-2xl ${a === p.avatar ? 'bg-yellow-500' : 'bg-slate-700 hover:bg-slate-600'}`}>{a}</button>
          ))}
        </div>
      </section>
      <section className="grid grid-cols-3 gap-2">
        {stat('Best score', p.best_score)}
        {stat('Games', p.games_played)}
        {stat('Total score', p.total_score)}
        {stat('Accuracy', p.accuracy === null ? '-' : `${p.accuracy}%`)}
        {stat('Best streak', p.best_streak)}
        {stat('Fastest', p.fastest_ms === null ? '-' : `${(p.fastest_ms / 1000).toFixed(1)}s`)}
      </section>
      <section className="rounded-lg bg-slate-800 p-4">
        <h2 className="font-bold mb-2">🏅 Badges</h2>
        <ul className="grid grid-cols-2 gap-2">
          {p.badges.map((b) => (
            <li key={b.id} className={`rounded-lg p-3 text-sm ${b.earned ? 'bg-yellow-500/20 ring-1 ring-yellow-500' : 'bg-slate-700/50 opacity-60'}`}>
              <div className="font-semibold">{b.earned ? '🏅' : '🔒'} {b.name}</div>
              <div className="text-xs text-slate-400">{b.desc}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Admin() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/api/admin/players').then(setData).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="text-red-400" role="alert">{err}</p>;
  if (!data) return null;
  const th = 'px-2 py-1 text-left font-semibold';
  return (
    <div className="w-full max-w-2xl flex flex-col gap-4 text-sm">
      <section className="rounded-lg bg-slate-800 p-4 overflow-x-auto">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-bold">👥 Players</h2>
          <a className="rounded bg-indigo-600 px-3 py-1 font-semibold hover:bg-indigo-500" href="/api/admin/export.csv">⬇ Export CSV</a>
        </div>
        <table className="w-full"><thead><tr className="text-slate-400"><th className={th}>Name</th><th className={th}>Role</th><th className={th}>Best</th><th className={th}>Games</th><th className={th}>Last login</th></tr></thead>
          <tbody>{data.players.map((p) => (
            <tr key={p.username} className="border-t border-slate-700"><td className="px-2 py-1">{p.name} <span className="text-slate-500">@{p.username}</span></td><td className="px-2 py-1">{p.role}</td><td className="px-2 py-1">{p.best_score}</td><td className="px-2 py-1">{p.games_played}</td><td className="px-2 py-1">{p.last_login ? new Date(p.last_login).toLocaleString() : '-'}</td></tr>
          ))}</tbody></table>
      </section>
      <section className="rounded-lg bg-slate-800 p-4 overflow-x-auto">
        <h2 className="font-bold mb-2">🔐 Recent logins</h2>
        <table className="w-full"><thead><tr className="text-slate-400"><th className={th}>When</th><th className={th}>User</th><th className={th}>Result</th><th className={th}>IP</th></tr></thead>
          <tbody>{data.history.map((h, i) => (
            <tr key={i} className="border-t border-slate-700"><td className="px-2 py-1">{new Date(h.at).toLocaleString()}</td><td className="px-2 py-1">{h.username}</td><td className={`px-2 py-1 ${h.success ? 'text-green-400' : 'text-red-400'}`}>{h.success ? 'ok' : h.note ?? 'failed'}</td><td className="px-2 py-1">{h.ip}</td></tr>
          ))}</tbody></table>
      </section>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState(undefined); // undefined = loading, null = logged out, else { name, role }
  const [notice, setNotice] = useState('');
  const [view, setView] = useState('game'); // game | admin | profile
  const [toasts, setToasts] = useState([]);
  useEffect(() => { api('/api/me').then((r) => setMe(r.user ? r : null)); }, []);
  useEffect(() => {
    return on('session:expired', () => { setMe(null); setView('game'); setNotice('Your session expired. Please log in again.'); });
  }, []);
  useEffect(() => subscribeFeedback(), []); // sound effects subscribe to game events
  useEffect(() => on('badge:earned', (b) => { // a toast is another subscriber of the same event
    setToasts((t) => [...t, b]);
    setTimeout(() => setToasts((t) => t.slice(1)), 4000);
  }), []);
  const [muted, setMutedState] = useState(isMuted());
  const toggleSound = () => { setMuted(!muted); setMutedState(!muted); };
  const logout = () => api('/api/logout', {}).then(() => { csrf = null; setMe(null); setView('game'); setNotice(''); });
  const user = me?.name;

  return (
    <main className={`min-h-screen text-slate-100 flex flex-col items-center gap-4 p-4 ${user ? 'bg-slate-900' : 'bg-gradient-to-b from-amber-800 via-slate-900 to-slate-900'}`}>
      <h1 className="text-3xl font-extrabold tracking-wide">🍌 BANANA GAME</h1>
      {me === undefined ? null : me ? (
        <>
          <p className="text-sm text-slate-400">
            <span aria-hidden="true">{me.avatar}</span> <b className="text-slate-100">{user}</b>
            {' '}· <button onClick={() => setView(view === 'profile' ? 'game' : 'profile')} className="underline">{view === 'profile' ? 'back to game' : 'profile'}</button>
            {me.role === 'admin' && <> · <button onClick={() => setView(view === 'admin' ? 'game' : 'admin')} className="underline">{view === 'admin' ? 'back to game' : 'admin'}</button></>}
            {' '}· <button onClick={toggleSound} aria-pressed={!muted} className="underline">{muted ? '🔇 sound off' : '🔊 sound on'}</button>
            {' '}· <button onClick={logout} className="underline">log out</button>
          </p>
          {view === 'admin' && me.role === 'admin' ? <Admin /> : view === 'profile' ? <Profile onAvatar={(avatar) => setMe((m) => ({ ...m, avatar }))} /> : <Game />}
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-col gap-2" role="status" aria-live="polite">
            {toasts.map((b, i) => <div key={i} className="rounded-lg bg-yellow-500 text-slate-900 px-4 py-2 font-semibold shadow-lg">🏅 Badge earned: {b.name}</div>)}
          </div>
        </>
      ) : <Landing onUser={(r) => { setNotice(''); setMe(r); }} api={api} notice={notice} />}
    </main>
  );
}
