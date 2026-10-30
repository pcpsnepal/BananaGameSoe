// Registration rules. The client repeats these for instant feedback; the server is the one that enforces them.
export function validateRegistration({ name, username, password, confirm } = {}) {
  const e = {};
  if (!/^\p{L}[\p{L}\p{M} '.-]{1,29}$/u.test(String(name ?? '').trim())) e.name = 'Name must be 2-30 characters (letters, spaces, . - \')';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,19}$/.test(String(username ?? '').trim())) e.username = 'Username must be 3-20 characters: letters, numbers, . _ - (start with a letter or number)';
  const pw = String(password ?? '');
  if (pw.length < 8) e.password = 'Password must be at least 8 characters';
  else if (Buffer.byteLength(pw) > 72) e.password = 'Password is too long (72 bytes max)'; // bcrypt ignores everything past 72 bytes
  else if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) e.password = 'Password needs at least one letter and one number';
  else if (pw.toLowerCase() === String(username ?? '').trim().toLowerCase()) e.password = 'Password must not be the same as the username';
  if (!e.password && pw !== String(confirm ?? '')) e.confirm = 'Passwords do not match';
  return e;
}
