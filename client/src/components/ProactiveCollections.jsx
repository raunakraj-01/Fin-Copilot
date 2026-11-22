import { sessionFetch } from '../services/session.js';
import React, { useEffect, useRef, useState } from 'react';

const base = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:5000/api');
const dateTime = value => new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
const outcomeLabel = outcome => ({ draft_ready: 'Draft ready · not sent', accepted: 'Accepted by WhatsApp API · delivery not confirmed', failed: 'Send failed · paused' }[outcome] || outcome || 'Waiting');

export default function ProactiveCollections({ workspaceId, token, enabled }) {
  const [data, setData] = useState(null);
  const [actions, setActions] = useState([]);
  const [actionForms, setActionForms] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ cashItemId: '', phone: '', cadenceDays: '3', maxAttempts: '3', mode: 'demo', recipientOptIn: false });
  const currentWorkspace = useRef(workspaceId);
  currentWorkspace.current = workspaceId;
  async function request(path = '', method = 'GET', body) {
    const response = await sessionFetch(`${base}/workspaces/${workspaceId}/followups${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'Could not load follow-ups');
    return result;
  }
  async function refresh() {
    const [result, history] = await Promise.all([request(), request('/actions')]);
    if (currentWorkspace.current === workspaceId) { setData(result); setActions(history.actions || []); }
  }
  useEffect(() => {
    setData(null); setError(''); setNotice(''); setForm({ cashItemId: '', phone: '', cadenceDays: '3', maxAttempts: '3', mode: 'demo', recipientOptIn: false });
    if (!enabled || !workspaceId) return;
    let active = true;
    const load = () => Promise.all([request(), request('/actions')]).then(([result, history]) => {
      if (active) { setData(result); setActions(history.actions || []); }
    }).catch(cause => { if (active) setError(cause.message); });
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [workspaceId, token, enabled]);
  async function act(action) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await refresh(); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  const phone = form.phone.replace(/^\+/, '');
  const validPhone = /^\d{10,15}$/.test(phone);
  return <div className="card proactive-collections">
    <h2>Proactive collections & follow-ups</h2>
    <p>Recommendations use your current ledger and cash forecast. Scheduled demo cycles prepare local drafts; they never send messages.</p>
    {!enabled ? <p>Enter owner access above to load collection recommendations.</p> : <>
      <div className="page-actions"><button type="button" className="secondary" disabled={busy} onClick={() => act(refresh)}>Refresh priorities</button>
        <a href="/workflows/cashflow-followups.n8n.json" download>Download n8n workflow</a></div>
      {data && <p>Workspace snapshot: {data.asOfDate}. {data.firstNegativeDate ? `Cash first turns negative on ${data.firstNegativeDate}.` : 'No negative cash day in the forecast.'} Scheduling uses the real clock (IST).</p>}
      {data?.suggestions?.length === 0 && <p>No overdue, due-soon, or evaluated early-collection opportunities need attention.</p>}
      <div className="proactive-priorities">{data?.suggestions?.map(suggestion => <article key={suggestion.cashItemId} className="decision-notice">
        <h3>{suggestion.counterparty} · {suggestion.externalId || 'Invoice'}</h3>
        <p>{suggestion.reason}</p><p>{suggestion.message}</p>
        <button type="button" className="secondary" onClick={() => setForm(current => ({ ...current, cashItemId: suggestion.cashItemId }))}>Set up follow-ups</button>
        {validPhone && <p><a href={`https://wa.me/${phone}?text=${encodeURIComponent(suggestion.message)}`} target="_blank" rel="noopener noreferrer">Review draft in WhatsApp for +{phone}</a></p>}
      </article>)}</div>
      <form className="form-grid" onSubmit={event => { event.preventDefault(); act(async () => {
        await request('', 'POST', { ...form, cadenceDays: Number(form.cadenceDays), maxAttempts: Number(form.maxAttempts) });
        setNotice(form.mode === 'demo' ? 'Demo scheduled. First draft is prepared within 15 seconds. Use Run demo cycle now to show it immediately.' : 'Automatic n8n follow-ups scheduled for this opted-in recipient.');
      }); }}>
        <label>Follow-up invoice<select required value={form.cashItemId} onChange={event => setForm({ ...form, cashItemId: event.target.value })}><option value="">Choose an open receivable</option>{data?.receivables?.map(item => <option key={item.id} value={item.id}>{item.externalId || 'Invoice'} · {item.counterparty}</option>)}</select></label>
        <label>WhatsApp recipient with country code<input required type="tel" pattern="\+?[0-9]{10,15}" placeholder="+91…" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
        <label>Days between follow-ups<input type="number" min="1" max="30" required value={form.cadenceDays} onChange={event => setForm({ ...form, cadenceDays: event.target.value })} /></label>
        <label>Maximum follow-ups<input type="number" min="1" max="5" required value={form.maxAttempts} onChange={event => setForm({ ...form, maxAttempts: event.target.value })} /></label>
        <label>Follow-up mode<select value={form.mode} onChange={event => setForm({ ...form, mode: event.target.value })}><option value="demo">Local demo · drafts only</option><option value="n8n" disabled={!data?.liveEnabled}>Automatic WhatsApp via n8n</option></select></label>
        {form.mode === 'n8n' && <label className="check"><input type="checkbox" required checked={form.recipientOptIn} onChange={event => setForm({ ...form, recipientOptIn: event.target.checked })} />This recipient opted in to WhatsApp reminders</label>}
        <button disabled={busy || !data}>{busy ? 'Working…' : 'Schedule follow-ups'}</button>
      </form>
      {!data?.liveEnabled && <p>Live sending is disabled. The downloadable n8n workflow can be connected later to your WhatsApp Business account.</p>}
      {notice && <p role="status">{notice}</p>}
      {actions.length > 0 && <details><summary>Collection action history ({actions.length})</summary><ol>{actions.map(action => <li key={action.id}>
        {dateTime(action.at)} IST · {action.type.replaceAll('_', ' ')}{action.amountPaise ? ` · INR ${(action.amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : ''}
        {action.promisedDate && ` · promised ${action.promisedDate}`}{action.receivedDate && ` · received ${action.receivedDate}`}{action.note && <p>{action.note}</p>}
      </li>)}</ol></details>}
      {data?.rules?.map(rule => <article className="decision-notice" key={rule.id}>
        <h3>{rule.counterparty} · {rule.externalId || 'Invoice'}</h3>
        <p>{rule.mode === 'demo' ? 'Local drafts' : 'n8n automatic sending'} · +{rule.phone} · {rule.state} · {rule.attempts}/{rule.maxAttempts} cycles</p>
        <p>{outcomeLabel(rule.lastOutcome)}{rule.state === 'active' && ` · Next: ${dateTime(rule.nextRunAt)} IST`}</p>
        {rule.state === 'active' && <><button type="button" className="secondary" disabled={busy} onClick={() => act(() => request(`/${rule.id}`, 'PATCH', { state: 'paused' }))}>Pause follow-ups</button>
          {rule.mode === 'demo' && <button type="button" disabled={busy} onClick={() => act(() => request(`/${rule.id}/demo-run`, 'POST', {}))}>Run demo cycle now</button>}</>}
        {rule.lastMessage && <><p>{rule.lastMessage}</p><a href={`https://wa.me/${rule.phone}?text=${encodeURIComponent(rule.lastMessage)}`} target="_blank" rel="noopener noreferrer">Review latest draft in WhatsApp</a></>}
        {rule.history.length > 0 && <details><summary>Follow-up history ({rule.history.length})</summary><ol>{rule.history.map((entry, index) => <li key={index}>{dateTime(entry.at)} IST · {outcomeLabel(entry.outcome)}<p>{entry.message}</p></li>)}</ol></details>}
        <form className="form-grid" onSubmit={event => { event.preventDefault(); const value = actionForms[rule.id] || { type: 'customer_response', note: '' };
          act(async () => { await request('/actions', 'POST', { cashItemId: rule.cashItemId, followUpId: rule.id, requestId: crypto.randomUUID(), ...value });
            setActionForms(current => ({ ...current, [rule.id]: { type: value.type, note: '' } })); setNotice(value.type === 'dispute' ? 'Dispute recorded for owner review.' : 'Customer update added to the collection history.'); }); }}>
          <label>Log customer update<select value={(actionForms[rule.id]?.type) || 'customer_response'} onChange={event => setActionForms(current => ({ ...current,
            [rule.id]: { ...(current[rule.id] || { note: '' }), type: event.target.value } }))}><option value="customer_response">Customer response</option><option value="dispute">Dispute</option></select></label>
          <label>Response or dispute details<textarea required maxLength={2000} value={actionForms[rule.id]?.note || ''} onChange={event => setActionForms(current => ({ ...current,
            [rule.id]: { ...(current[rule.id] || { type: 'customer_response' }), note: event.target.value } }))} /></label>
          <button type="submit" className="secondary" disabled={busy}>Add to history</button>
        </form>
      </article>)}
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
