import React, { useEffect, useState } from 'react';
import { api, json } from '../services/api.js';
import { setCsrf } from '../services/session.js';

export default function AuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [register, setRegister] = useState(false);
  const [recover, setRecover] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }

  async function recoverAccount(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await json('/auth/recover', 'POST', { email, recoveryCode, newPassword: password });
      setRecover(false); setRecoveryCode(''); setPassword(''); setError(result.message || 'Password changed. Sign in with your new password.');
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }

  async function logout() {
    try { await json('/auth/logout', 'POST', {}); }
    catch (cause) { if (cause.status !== 401) { setError(cause.message); return; } }
    setCsrf(''); setUser(null); localStorage.removeItem('cashflowProfiles'); localStorage.removeItem('cashflowWorkspaceId'); sessionStorage.clear();
  }

  if (loading) return <main className="decision-page auth-page auth-page--loading"><section className="decision-card"><p role="status">Checking your session?</p></section></main>;
  if (!user) return <main className="decision-page auth-page"><section className="decision-card">
    <h1>{recover ? 'Recover your account' : register ? 'Create your account' : 'Sign in to CashFlow Copilot'}</h1>
    <form onSubmit={recover ? recoverAccount : authenticate} className="form-grid"><fieldset disabled={busy}>
      {register && <label>Your name<input required maxLength={100} autoComplete="name" value={name} onChange={event => setName(event.target.value)} /></label>}
      <label>Email<input required type="email" autoComplete="username" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>
      {recover && <label>Unused recovery code<input required autoComplete="one-time-code" value={recoveryCode} onChange={event => setRecoveryCode(event.target.value.toUpperCase())} /></label>}
      <label>{recover ? 'New password' : 'Password'}<input required type="password" minLength={register || recover ? 8 : 1} maxLength={128}
        autoComplete={register || recover ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} /></label>
      {(register || recover) && <p>Use at least 8 characters.</p>}
      <button>{busy ? 'Please wait' : recover ? 'Change password' : register ? 'Create account' : 'Sign in'}</button>
    </fieldset></form>
    <button className="secondary" onClick={() => { setRegister(!register); setRecover(false); setError(''); }}>{register ? 'Use an existing account' : 'Create an account'}</button>
    {!register && <button className="secondary" onClick={() => { setRecover(value => !value); setError(''); setPassword(''); setRecoveryCode(''); }}>
      {recover ? 'Return to sign in' : 'Recover with a saved code'}</button>}
    {error && <p role="alert">{error}</p>}
  </section></main>;
  if (inviteToken) return <main className="decision-page auth-page auth-page--invite"><section className="decision-card"><h1>Accept accountant invitation</h1><p>Signed in as {user.email}. The invitation must match this email.</p>
    <button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await json('/auth/invitations/accept', 'POST', { token: inviteToken }); setInviteToken(''); } catch (cause) { setError(cause.message); } finally { setBusy(false); } }}>Accept invitation</button>
    <button className="secondary" onClick={() => setInviteToken('')}>Skip invitation</button><button className="secondary" onClick={logout}>Sign out</button>
    {error && <p role="alert">{error}</p>}</section></main>;
  return <>{error && <p role="alert">{error}</p>}{children(user, logout)}</>;
}
