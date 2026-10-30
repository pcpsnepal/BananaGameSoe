import { useCallback, useEffect, useState } from 'react';
import Landing from './Landing.jsx';

const api = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error || j.message), { fields: j.fields, status: r.status });
  return j;
};

const LEVELS = [
  { id: 'easy', name: 'Easy', desc: '45 seconds per puzzle', mult: '×1', style: 'bg-green-600 hover:bg-green-500' },
  { id: 'normal', name: 'Normal', desc: '30 seconds per puzzle', mult: '×2', style: 'bg-yellow-500 text-slate-900 hover:bg-yellow-400' },
  { id: 'hard', name: 'Hard', desc: '15 seconds per puzzle', mult: '×3', style: 'bg-red-600 hover:bg-red-500' },
];

function Leaderboard({ rows }) {
  return (
    <section className="rounded-lg bg-slate-800 p-4">
      <h2 className="font-bold mb-2">🏆 Leaderboard <span className="text-xs text-slate-400">(live)</span></h2>
      {rows.length === 0 && <p className="text-slate-400 text-sm">No scores yet.</p>}
      <ol className="space-y-1">
        {rows.map((r, i) => <li key={i} className="flex justify-between"><span>{i + 1}. {r.user}</span><b>{r.score}</b></li>)}
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
  const fail = (e) => setErr(e.message);

  const enter = useCallback((p) => { setPuzzle(p); setFb(null); setLeft(null); setErr(''); setPhase('play'); }, []);
  const toMenu = () => { setPuzzle(null); setFb(null); setErr(''); setPhase('menu'); };

  useEffect(() => {
    api('/api/puzzle')
      .then((r) => (r.result ? (setPuzzle(null), setFb(r.result), setPhase('play')) : enter(r)))
      .catch((e) => (e.status === 409 ? setPhase('menu') : (setErr(e.message), setPhase('menu'))));
    api('/api/leaderboard').then(setRows).catch(() => {});
    const es = new EventSource('/api/events'); // server push: leaderboard + activity update live
    es.addEventListener('leaderboard', (e) => setRows(JSON.parse(e.data)));
    es.addEventListener('activity', (e) => setFeed((f) => [JSON.parse(e.data).text, ...f].slice(0, 5)));
    return () => es.close();
  }, [enter]);

  // countdown: displays the time left and reports expiry
  useEffect(() => {
    if (!puzzle || fb) return;
    const end = Date.now() + puzzle.seconds * 1000;
    const t = setInterval(() => {
      const s = Math.ceil((end - Date.now()) / 1000);
      setLeft(Math.max(s, 0));
      if (s <= 0) { clearInterval(t); api('/api/answer', { timeout: true }).then(setFb).catch(fail); }
    }, 250);
    return () => clearInterval(t);
  }, [puzzle, fb]);

  const answer = useCallback((digit) => { if (puzzle && !fb) api('/api/answer', { digit }).then(setFb).catch(fail); }, [puzzle, fb]);

  // keyboard: press 0-9 to answer
  useEffect(() => {
    const h = (e) => { if (/^\d$/.test(e.key) && !e.ctrlKey && !e.metaKey && !puzzle?.removed.includes(Number(e.key))) answer(Number(e.key)); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [answer, puzzle]);

  const start = (difficulty) => { setErr(''); api('/api/game', { difficulty }).then(enter).catch(fail); };
  const next = () => (fb.over ? toMenu() : api('/api/puzzle').then(enter).catch(fail));
  const hint = () => api('/api/hint', {}).then((r) => setPuzzle((p) => ({ ...p, removed: r.removed, hints: r.hints }))).catch(fail);
  const skip = () => api('/api/skip', {}).then(enter).catch(fail);

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
                <div className={`h-full transition-all duration-300 ${secs <= 5 ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${(secs / puzzle.total) * 100}%` }} />
              </div>
              <p className="text-center text-sm text-slate-300 mt-1">⏱ {secs}s</p>
            </div>
          )}

          {puzzle && <img src={puzzle.image} alt="Banana puzzle: what digit replaces the banana?" className="rounded-lg bg-white max-w-full" />}
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
              <p className="text-xl font-semibold">
                {fb.correct ? `✅ Correct! +${fb.points} pts` : fb.timedOut ? `⏰ Time's up! It was ${fb.solution}` : `❌ Wrong, it was ${fb.solution}`}
              </p>
              {fb.over && <p className="mt-1 text-slate-300">Game over: <b>{fb.score}</b> points, best streak <b>{fb.bestStreak}</b></p>}
              <button onClick={next} autoFocus className="mt-2 rounded bg-indigo-600 px-4 py-2 font-semibold hover:bg-indigo-500">
                {fb.over ? 'Play again' : 'Next puzzle'}
              </button>
            </div>
          )}
        </>
      )}
      <div className="w-full max-w-xs flex flex-col gap-3">
        <Leaderboard rows={rows} />
        <Activity items={feed} />
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out
  useEffect(() => { api('/api/me').then((r) => setUser(r.name)); }, []);
  const logout = () => api('/api/logout', {}).then(() => setUser(null));

  return (
    <main className={`min-h-screen text-slate-100 flex flex-col items-center gap-4 p-4 ${user ? 'bg-slate-900' : 'bg-gradient-to-b from-amber-800 via-slate-900 to-slate-900'}`}>
      <h1 className="text-3xl font-extrabold tracking-wide">🍌 BANANA GAME</h1>
      {user === undefined ? null : user ? (
        <>
          <p className="text-sm text-slate-400">Playing as <b className="text-slate-100">{user}</b> · <button onClick={logout} className="underline">log out</button></p>
          <Game />
        </>
      ) : <Landing onUser={setUser} api={api} />}
    </main>
  );
}
