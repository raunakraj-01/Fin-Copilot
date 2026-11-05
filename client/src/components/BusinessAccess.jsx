import React, { useEffect, useState } from 'react';
import { api, json } from '../services/api.js';
export default function BusinessAccess({ workspaceId }) {
  const [members, setMembers] = useState([]); const [invitations, setInvitations] = useState([]); const [devices, setDevices] = useState([]);
  const [email, setEmail] = useState(''); const [link, setLink] = useState(''); const [secret, setSecret] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const base = `/workspaces/${workspaceId}`;
  async function load() { const [access, credentials] = await Promise.all([api(`${base}/members`), api(`${base}/sync/devices`)]); setMembers(access.members); setInvitations(access.invitations); setDevices(credentials.devices); }
  useEffect(() => { load().catch(e => setMessage(e.message)); }, [workspaceId]);
  async function run(action) { setBusy(true); setMessage(''); try { await action(); await load(); } catch (e) { setMessage(e.message); } finally { setBusy(false); } }
  return <section className="card"><h2>Business access</h2>
    <p>Accountants can maintain records and use planning tools. Only the owner can change business settings, manage access, delete records or configure integrations and messaging.</p>
    <form onSubmit={e => { e.preventDefault(); run(async () => { const result = await json(`${base}/members/invitations`, 'POST', { email }); setLink(result.invitationUrl); }); }}>
      <label>Accountant email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><button disabled={busy}>Create accountant invitation</button>
    </form>
    {link && <label>Invitation link · share with this accountant<input readOnly value={link} onFocus={e => e.target.select()} /></label>}
    <ul>{members.map(m => <li key={m.id}>{m.name} · {m.email} · {m.role}{m.role === 'accountant' && <button disabled={busy} onClick={() => run(() => json(`${base}/members/${m.id}`, 'DELETE'))}>Remove accountant</button>}</li>)}</ul>
    <ul>{invitations.map(i => <li key={i.id}>{i.email} · invitation expires {new Date(i.expiresAt).toLocaleString()} <button disabled={busy} onClick={() => run(() => json(`${base}/invitations/${i.id}`, 'DELETE'))}>Revoke invitation</button></li>)}</ul>
    <h3>Integration credentials</h3><p>Each credential works only for this business. Revoking it blocks subsequent requests.</p>
    <button disabled={busy} onClick={() => run(async () => { const result = await json(`${base}/sync/devices`, 'POST', { name: 'n8n follow-ups', kind: 'automation' }); setSecret(result.token); })}>Create automation credential</button>
    {secret && <label>Automation credential · shown once<input readOnly type="text" value={secret} onFocus={e => e.target.select()} /></label>}
    <ul>{devices.map(d => <li key={d.id}>{d.name} · {d.kind} · {d.revokedAt ? 'revoked' : 'active'}{!d.revokedAt && <button disabled={busy} onClick={() => run(() => json(`${base}/sync/devices/${d.id}`, 'DELETE'))}>Revoke credential</button>}</li>)}</ul>
    {message && <p role="alert">{message}</p>}
  </section>;
}
