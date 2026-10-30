import { useEffect, useState } from 'react';
import { startMusic, stopMusic, isPlaying, click } from './sound.js';

// Original SVG artwork (drawn for this project, no licence needed).
function Banana({ className }) {
  return (
    <svg viewBox="0 0 200 200" className={className} role="img" aria-label="Smiling banana">
      <path d="M40 60 C 40 150, 120 190, 175 140 C 182 133, 176 125, 168 128 C 125 160, 80 130, 78 62 C 78 50, 42 48, 40 60 Z"
        fill="#FACC15" stroke="#A16207" strokeWidth="5" strokeLinejoin="round" />
      <path d="M40 60 C 38 52, 44 40, 56 38 L 74 40 C 80 46, 79 56, 78 62" fill="#CA8A04" stroke="#A16207" strokeWidth="5" strokeLinejoin="round" />
      <circle cx="92" cy="108" r="5" fill="#422006" /><circle cx="116" cy="124" r="5" fill="#422006" />
      <path d="M96 128 Q 108 140 120 138" fill="none" stroke="#422006" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export default function Landing({ onUser, api }) {
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState('');
  const [music, setMusic] = useState(isPlaying());
  useEffect(() => stopMusic, []); // stop when leaving the page (e.g. after login)

  const go = (kind) => { click(); api('/api/' + kind, f).then((r) => onUser(r.user)).catch((e) => setErr(e.message)); };
  const toggle = () => { if (isPlaying()) stopMusic(); else startMusic(); setMusic(isPlaying()); };
  const input = 'w-full rounded-lg bg-white/90 text-slate-900 placeholder-slate-500 border-2 border-transparent focus:border-amber-600 outline-none px-3 py-2';

  return (
    <section className="w-full max-w-md flex flex-col items-center gap-4 text-center">
      <button onClick={toggle} aria-pressed={music} className="self-end rounded-full bg-slate-800/80 px-3 py-1 text-sm hover:bg-slate-700">
        {music ? '🔊 Music on' : '🔇 Music off'}
      </button>
      <Banana className="float w-40 h-40 drop-shadow-xl" />
      <p className="text-lg text-amber-100">Six equations, one hidden banana. Find the missing digit before the clock runs out!</p>
      <ul className="flex flex-wrap justify-center gap-2 text-sm">
        {['⏱ 30s per puzzle', '❤️ 3 lives', '🏆 Live leaderboard'].map((t) => (
          <li key={t} className="rounded-full bg-white/10 px-3 py-1">{t}</li>
        ))}
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); go('login'); }} className="w-full rounded-2xl bg-slate-800/80 p-5 flex flex-col gap-3 shadow-xl">
        <input className={input} placeholder="Username" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        <input className={input} type="password" placeholder="Password (6+ characters)" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <p className="text-red-400 h-5 text-sm" role="alert">{err}</p>
        <div className="flex gap-2">
          <button className="flex-1 rounded-lg bg-yellow-400 text-slate-900 font-bold py-2 hover:bg-yellow-300">Log in</button>
          <button type="button" onClick={() => go('register')} className="flex-1 rounded-lg bg-slate-600 font-bold py-2 hover:bg-slate-500">Register</button>
        </div>
      </form>
    </section>
  );
}
