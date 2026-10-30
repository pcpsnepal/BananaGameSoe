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

// Same rules as server/app.js validateRegistration (the server is the one that enforces them).
function validate(f) {
  const e = {};
  if (!/^\p{L}[\p{L}\p{M} '.-]{1,29}$/u.test(f.name.trim())) e.name = "Enter your name (2-30 characters, letters and spaces)";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,19}$/.test(f.username.trim())) e.username = 'Username: 3-20 characters, letters, numbers, . _ -';
  if (f.password.length < 8) e.password = 'At least 8 characters';
  else if (!/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) e.password = 'Needs at least one letter and one number';
  else if (f.password.toLowerCase() === f.username.trim().toLowerCase()) e.password = 'Must differ from the username';
  if (!e.password && f.password !== f.confirm) e.confirm = 'Passwords do not match';
  return e;
}

function Field({ id, label, error, ...props }) {
  return (
    <div className="text-left">
      <label htmlFor={id} className="block text-sm text-amber-100 mb-1">{label}</label>
      <input id={id} aria-invalid={!!error} aria-describedby={error ? id + '-err' : undefined}
        className={`w-full rounded-lg bg-white/90 text-slate-900 placeholder-slate-500 border-2 outline-none px-3 py-2 ${error ? 'border-red-500' : 'border-transparent focus:border-amber-600'}`}
        {...props} />
      {error && <p id={id + '-err'} className="text-red-400 text-sm mt-1">{error}</p>}
    </div>
  );
}

export default function Landing({ onUser, api }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [f, setF] = useState({ name: '', username: '', password: '', confirm: '' });
  const [errs, setErrs] = useState({});
  const [formErr, setFormErr] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [music, setMusic] = useState(isPlaying());
  useEffect(() => stopMusic, []); // stop when leaving the page (e.g. after login)

  const reg = mode === 'register';
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErrs({ ...errs, [k]: undefined }); setFormErr(''); };
  const blur = (k) => () => reg && f[k] && setErrs((p) => ({ ...p, [k]: validate(f)[k] }));
  const switchMode = (m) => { setMode(m); setErrs({}); setFormErr(''); };
  const toggle = () => { if (isPlaying()) stopMusic(); else startMusic(); setMusic(isPlaying()); };

  const submit = async (e) => {
    e.preventDefault();
    click();
    if (reg) {
      const v = validate(f);
      if (Object.keys(v).length) return setErrs(v);
    } else if (!f.username.trim() || !f.password) {
      return setFormErr('Enter your username and password');
    }
    setBusy(true);
    try {
      const r = await api('/api/' + (reg ? 'register' : 'login'), f);
      onUser(r.name);
    } catch (x) {
      if (x.fields) setErrs(x.fields); else setFormErr(x.message);
    } finally { setBusy(false); }
  };

  const tab = (m) => `flex-1 py-2 font-bold rounded-lg ${mode === m ? 'bg-yellow-400 text-slate-900' : 'bg-slate-700 hover:bg-slate-600'}`;

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
      <form onSubmit={submit} noValidate className="w-full rounded-2xl bg-slate-800/80 p-5 flex flex-col gap-3 shadow-xl">
        <div className="flex gap-2" role="tablist">
          <button type="button" role="tab" aria-selected={!reg} onClick={() => switchMode('login')} className={tab('login')}>Log in</button>
          <button type="button" role="tab" aria-selected={reg} onClick={() => switchMode('register')} className={tab('register')}>Create account</button>
        </div>
        {reg && <Field id="name" label="Your name" placeholder="e.g. Ada Lovelace" autoComplete="name" value={f.name} onChange={set('name')} onBlur={blur('name')} error={errs.name} />}
        <Field id="username" label="Username" placeholder={reg ? '3-20 characters' : 'Username'} autoComplete="username" value={f.username} onChange={set('username')} onBlur={blur('username')} error={errs.username} />
        <Field id="password" label="Password" type={show ? 'text' : 'password'} placeholder={reg ? '8+ characters, a letter and a number' : 'Password'} autoComplete={reg ? 'new-password' : 'current-password'} value={f.password} onChange={set('password')} onBlur={blur('password')} error={errs.password} />
        {reg && <Field id="confirm" label="Confirm password" type={show ? 'text' : 'password'} placeholder="Type it again" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} onBlur={blur('confirm')} error={errs.confirm} />}
        <label className="flex items-center gap-2 text-sm text-slate-300 self-start">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password
        </label>
        <p className="text-red-400 text-sm min-h-5" role="alert">{formErr}</p>
        <button disabled={busy} className="rounded-lg bg-yellow-400 text-slate-900 font-bold py-2 hover:bg-yellow-300 disabled:opacity-60">
          {busy ? 'Please wait…' : reg ? 'Create account' : 'Log in'}
        </button>
      </form>
    </section>
  );
}
