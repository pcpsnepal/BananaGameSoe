import { useEffect, useState } from 'react';

const api = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || j.message);
  return j;
};

function Auth({ onUser }) {
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState('');
  const go = (kind) => api('/api/' + kind, f).then((r) => onUser(r.user)).catch((e) => setErr(e.message));
  const input = 'w-full rounded bg-slate-800 border border-slate-600 px-3 py-2';
  return (
    <form onSubmit={(e) => { e.preventDefault(); go('login'); }} className="w-full max-w-xs flex flex-col gap-3">
      <input className={input} placeholder="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
      <input className={input} type="password" placeholder="password (6+)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      <p className="text-red-400 h-5">{err}</p>
      <div className="flex gap-2">
        <button className="flex-1 rounded bg-yellow-500 text-slate-900 font-bold py-2">Log in</button>
        <button type="button" onClick={() => go('register')} className="flex-1 rounded bg-slate-700 font-bold py-2">Register</button>
      </div>
    </form>
  );
}

function Leaderboard({ rows }) {
  return (
    <aside className="w-full max-w-xs rounded-lg bg-slate-800 p-4">
      <h2 className="font-bold mb-2">🏆 Leaderboard <span className="text-xs text-slate-400">(live)</span></h2>
      {rows.length === 0 && <p className="text-slate-400 text-sm">No scores yet.</p>}
      <ol className="space-y-1">
        {rows.map((r, i) => <li key={r.user} className="flex justify-between"><span>{i + 1}. {r.user}</span><b>{r.score}</b></li>)}
      </ol>
    </aside>
  );
}

function Game() {
  const [puzzle, setPuzzle] = useState(null); // {image, lives, score}
  const [feedback, setFeedback] = useState(null); // answer result, shown until "Next"
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);

  const next = () => { setFeedback(null); setErr(''); api('/api/puzzle').then(setPuzzle).catch((e) => setErr(e.message)); };

  useEffect(() => {
    next();
    api('/api/leaderboard').then(setRows).catch(() => {});
    const es = new EventSource('/api/events'); // server push: leaderboard updates live
    es.addEventListener('leaderboard', (e) => setRows(JSON.parse(e.data)));
    return () => es.close();
  }, []);

  const answer = (digit) => api('/api/answer', { digit }).then(setFeedback).catch((e) => setErr(e.message));
  const over = feedback?.over;

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="flex gap-6 text-lg">
        <span>Score <b>{feedback?.score ?? puzzle?.score ?? 0}</b></span>
        <span>{puzzle && ('❤️'.repeat(Math.max(feedback?.lives ?? puzzle.lives, 0)) || '💀')}</span>
      </div>
      {puzzle && <img src={puzzle.image} alt="Banana puzzle: what digit completes the equation?" className="rounded-lg bg-white max-w-full" />}
      <p className="h-6 text-red-400">{err}</p>
      {!feedback ? (
        <div className="grid grid-cols-5 gap-2">
          {[...Array(10).keys()].map((d) => (
            <button key={d} onClick={() => answer(d)} className="w-12 h-12 rounded bg-yellow-500 text-slate-900 text-xl font-bold hover:bg-yellow-400">{d}</button>
          ))}
        </div>
      ) : (
        <div className="text-center">
          <p className="text-xl font-semibold">{feedback.correct ? '✅ Correct!' : `❌ Wrong, it was ${feedback.solution}`}</p>
          <button onClick={next} className="mt-2 rounded bg-indigo-600 px-4 py-2 font-semibold hover:bg-indigo-500">
            {over ? `Game over (score ${feedback.score}). Play again` : 'Next puzzle'}
          </button>
        </div>
      )}
      <Leaderboard rows={rows} />
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out
  useEffect(() => { api('/api/me').then((r) => setUser(r.user)); }, []);
  const logout = () => api('/api/logout', {}).then(() => setUser(null));

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center gap-4 p-4">
      <h1 className="text-3xl font-extrabold tracking-wide">🍌 BANANA GAME</h1>
      {user === undefined ? null : user ? (
        <>
          <p className="text-sm text-slate-400">Playing as <b className="text-slate-100">{user}</b> · <button onClick={logout} className="underline">log out</button></p>
          <p className="text-slate-300 text-center max-w-xs">Find the digit hidden behind the banana to complete the equation.</p>
          <Game />
        </>
      ) : <Auth onUser={setUser} />}
    </main>
  );
}
