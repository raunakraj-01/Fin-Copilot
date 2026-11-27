import React, { useEffect, useState } from 'react';
import { api, json } from '../services/api.js';
import { setCsrf } from '../services/session.js';

export default function AuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [register, setRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recoveryNotice, setRecoveryNotice] = useState(false);
  const invite = new URLSearchParams(window.location.search).get('invite');
  const [inviteToken, setInviteToken] = useState(invite || '');

  useEffect(() => {
    if (invite) window.history.replaceState(null, '', window.location.pathname);
    let active = true;
    api('/auth/me').then(data => { if (active) { setCsrf(data.csrfToken); setUser(data.user); } })
      .catch(() => { if (active) setCsrf(''); }).finally(() => { if (active) setLoading(false); });
    const expired = () => { setCsrf(''); setUser(null); setError('Your session expired. Sign in again.'); };
    window.addEventListener('cashflow-session-expired', expired);
    return () => { active = false; window.removeEventListener('cashflow-session-expired', expired); };
  }, []);

  async function authenticate(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const data = await json(`/auth/${register ? 'register' : 'login'}`, 'POST', { email, password, ...(register ? { name } : {}) });
      setCsrf(data.csrfToken); setUser(data.user); setPassword('');
      if (register) setRecoveryNotice(true);
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }

  async function logout() {
    try { await json('/auth/logout', 'POST', {}); }
    catch (cause) { if (cause.status !== 401) { setError(cause.message); return; } }
    setCsrf(''); setUser(null); localStorage.removeItem('cashflowProfiles'); localStorage.removeItem('cashflowWorkspaceId'); sessionStorage.clear();
  }

  if (loading) return <main className="decision-page auth-page auth-page--loading"><section className="decision-card"><p role="status">Checking your session…</p></section></main>;
  if (!user) return <main className="decision-page auth-page"><section className="decision-card">
    <h1>{register ? 'Create your account' : 'Sign in to CashFlow Copilot'}</h1>
    <form onSubmit={authenticate} className="form-grid"><fieldset disabled={busy}>
      {register && <label>Your name<input required maxLength={100} autoComplete="name" value={name} onChange={event => setName(event.target.value)} /></label>}
      <label>Email<input required type="email" autoComplete="username" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Password<input required type="password" minLength={register ? 8 : 1} maxLength={128}
        autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} /></label>
      {register && <p>Use at least 8 characters.</p>}
      <button>{busy ? 'Please wait' : register ? 'Create account' : 'Sign in'}</button>
    </fieldset></form>
    <button className="secondary" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Use an existing account' : 'Create an account'}</button>
    {error && <p role="alert">{error}</p>}
  </section></main>;
  if (inviteToken) return <main className="decision-page auth-page auth-page--invite"><section className="decision-card"><h1>Accept accountant invitation</h1><p>Signed in as {user.email}. The invitation must match this email.</p>
    <button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await json('/auth/invitations/accept', 'POST', { token: inviteToken }); setInviteToken(''); } catch (cause) { setError(cause.message); } finally { setBusy(false); } }}>Accept invitation</button>
    <button className="secondary" onClick={() => setInviteToken('')}>Skip invitation</button><button className="secondary" onClick={logout}>Sign out</button>
    {error && <p role="alert">{error}</p>}</section></main>;
  return <>{error && <p role="alert">{error}</p>}
    {recoveryNotice && <div className="decision-notice" role="status">
      <strong>Account created:</strong> Visit <em>Setup → Account security</em> to generate and save one-time recovery codes in case you forget your password.{' '}
      <button type="button" className="secondary" onClick={() => setRecoveryNotice(false)}>Dismiss</button>
    </div>}
    {children(user, logout)}</>;
}
