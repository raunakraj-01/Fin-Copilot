import React, { useEffect, useState } from 'react';
import { api, json } from '../services/api.js';
import { readJsonSafe, sessionFetch, setCsrf } from '../services/session.js';

const base = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:5000/api');
const eventLabel = event => `${event.action} · ${event.entityType}${event.entityId ? ` · ${event.entityId}` : ''}`;

export default function TrustCenter({ workspaceId, businessRole }) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [codes, setCodes] = useState([]);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !workspaceId || businessRole !== 'owner') return;
    let active = true;
    api(`/workspaces/${workspaceId}/trust/audit?offset=0`).then(result => { if (active) setAudit(result.events || []); })
      .catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [open, workspaceId, businessRole]);

  async function makeCodes(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { const result = await json('/auth/recovery-codes', 'POST', { currentPassword }); setCodes(result.codes); setCurrentPassword('');
      setNotice('These codes are shown once. Save them somewhere private and offline. Creating new codes invalidates the previous set.'); }
    catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }

  async function changePassword(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await json('/auth/password', 'POST', passwordForm);
      if (result.csrfToken) setCsrf(result.csrfToken);
      setPasswordForm({ currentPassword: '', newPassword: '' });
      setNotice('Password updated and other active sessions signed out.');
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }

  async function downloadExport() {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await sessionFetch(`${base}/workspaces/${workspaceId}/trust/export`);
      if (!response.ok) { const result = await readJsonSafe(response); throw new Error(result?.error?.message || 'Export failed'); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `cashflow-${workspaceId}-export.json`; anchor.click(); URL.revokeObjectURL(url);
      setNotice('Business export downloaded.');
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }

  function downloadCodes() {
    const blob = new Blob([`CashFlow Copilot recovery codes\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'cashflow-recovery-codes.txt'; anchor.click(); URL.revokeObjectURL(url);
  }

  return <>
    <button className="secondary" type="button" onClick={() => setOpen(value => !value)}>{open ? 'Close security' : 'Account security'}</button>
    {open && <section className="trust-center card" aria-label="Account security and business data">
      <h2>Account security & business data</h2>
      <h3>Change password</h3>
      <form className="form-grid" onSubmit={changePassword}>
        <label>Current password<input type="password" autoComplete="current-password" required value={passwordForm.currentPassword} onChange={event => setPasswordForm(f => ({ ...f, currentPassword: event.target.value }))} /></label>
        <label>New password (min 8 chars)<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={passwordForm.newPassword} onChange={event => setPasswordForm(f => ({ ...f, newPassword: event.target.value }))} /></label>
        <button disabled={busy}>Update password</button>
      </form>
      <h3>Recovery codes</h3>
      <p>Recovery codes work without email delivery. Store them outside this device; each code can be used once.</p>
      <form className="form-grid" onSubmit={makeCodes}>
        <label>Confirm password<input type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
        <button disabled={busy}>Generate new recovery codes</button>
      </form>
      {codes.length > 0 && <div className="decision-notice"><h3>Save these codes now</h3><ol>{codes.map(code => <li key={code}><code>{code}</code></li>)}</ol>
        <button type="button" className="secondary" onClick={downloadCodes}>Download codes</button>
        <button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(codes.join('\n')).then(() => setNotice('Recovery codes copied. Store them somewhere private.')).catch(() => setError('Could not copy recovery codes.'))}>Copy codes</button>
        <button type="button" className="secondary" onClick={() => setCodes([])}>Hide codes</button></div>}
      {workspaceId && businessRole === 'owner' && <><h3>Business data</h3><p>Export the current business ledger, bank matches, follow-up history, sync history, and audit records.</p>
        <button disabled={busy || !workspaceId} onClick={downloadExport}>Download business export</button>
        <h3>Recent change history</h3>{audit.length === 0 ? <p>No recorded changes yet.</p> : <ol>{audit.slice(0, 20).map(event => <li key={event._id}>{new Date(event.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · {eventLabel(event)}</li>)}</ol>}
      </>}
      {workspaceId && businessRole !== 'owner' && <p>Business export and change history are available to the business owner.</p>}
      {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    </section>}
  </>;
}
