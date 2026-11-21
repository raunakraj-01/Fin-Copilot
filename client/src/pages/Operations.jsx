import { sessionFetch } from '../services/session.js';
import React, { useEffect, useState } from 'react';
import { inputRupees, parseRupees } from './OrderAnalyzer/money.js';
import ProactiveCollections from '../components/ProactiveCollections.jsx';

const base = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:5000/api');

export default function Operations({ workspaceId, operationsItemId, businessRole = 'owner' }) {
  const token = '';
  const [demoMode, setDemoMode] = useState(false);
  const [localSyntheticDev, setLocalSyntheticDev] = useState(false);
  const [receivables, setReceivables] = useState([]);
  const [status, setStatus] = useState(null);
  const [syncChanges, setSyncChanges] = useState([]);
  const [timingItemId, setTimingItemId] = useState('');
  const [timing, setTiming] = useState(null);
  const [gstin, setGstin] = useState('');
  const [score, setScore] = useState(null);
  const [itemId, setItemId] = useState('');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [date, setDate] = useState('');
  const [discount, setDiscount] = useState('200');
  const [offer, setOffer] = useState(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [payment, setPayment] = useState(null);
  const [consent, setConsent] = useState(false);
  const [deviceName, setDeviceName] = useState('Browser bridge test');
  const [deviceToken, setDeviceToken] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [syncForm, setSyncForm] = useState({ companyId: '', sourceId: '', buyerGstin: '', invoiceDate: '', dueDate: '', clearedDate: '', amount: '' });
  const [error, setError] = useState('');
  useEffect(() => { setStatus(null); setSyncChanges([]); setTiming(null); setTimingItemId(''); setScore(null); setOffer(null); setPayment(null); setConfirmSend(false); setReceivables([]); setConsent(false); setDeviceToken(''); setSyncMessage('');
    if (workspaceId) sessionFetch(`${base}/workspaces/${workspaceId}/items?category=receivable`).then(response => response.json())
      .then(data => setReceivables((data.items || []).filter(item => ['open', 'partial'].includes(item.status)))).catch(() => {});
  }, [workspaceId]);
  useEffect(() => { sessionFetch(`${base}/health`).then(response => response.json()).then(data => {
    setDemoMode(data.demoMode === true); setLocalSyntheticDev(data.localSyntheticDev === true);
  }).catch(() => {}); }, []);
  useEffect(() => {
    if (!workspaceId || businessRole !== 'owner') return;
    ownerRequest('reliability/consent').then(data => setConsent(data.share)).catch(() => {});
  }, [workspaceId, businessRole]);
  useEffect(() => { if (operationsItemId) { setItemId(operationsItemId.cashItemId); setAmount(inputRupees(operationsItemId.amountPaise)); setDate(operationsItemId.toDate); setOffer(null); setPayment(null); setConfirmSend(false); } }, [operationsItemId]);
  async function call(path, body) {
    setError('');
    const response = await sessionFetch(`${base}/workspaces/${workspaceId}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Request failed');
    return data;
  }
  async function ownerRequest(path, method = 'GET', body) {
    setError('');
    const response = await sessionFetch(`${base}/workspaces/${workspaceId}/${path}`, { method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Request failed');
    return data;
  }
  async function refreshSyncStatus() {
    const [latest, pending] = await Promise.all([ownerRequest('sync/status'), ownerRequest('sync/changes')]);
    setStatus(latest); setSyncChanges(pending.changes || []);
  }
  async function loadPaymentTiming() {
    if (!timingItemId) return;
    setTiming(await ownerRequest(`reliability/payment-timing/${timingItemId}`));
  }
  async function submitSyncTest(event) {
    event.preventDefault(); setError(''); setSyncMessage('');
    try {
      const amountPaise = parseRupees(syncForm.amount);
      const response = await sessionFetch(`${base}/workspaces/${workspaceId}/sync/batches`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deviceToken}` },
        body: JSON.stringify({ companyId: syncForm.companyId, batchId: crypto.randomUUID(), rows: [{
          sourceId: syncForm.sourceId, version: '1', item: { category: 'receivable', counterparty: syncForm.buyerGstin,
            sourceSystem: 'tally_export', amountPaise, settledPaise: amountPaise, status: 'paid', dueDate: syncForm.dueDate,
            expectedDate: syncForm.clearedDate, confidenceState: 'verified' },
          observation: { buyerGstin: syncForm.buyerGstin, invoiceDate: syncForm.invoiceDate, dueDate: syncForm.dueDate,
            clearedDate: syncForm.clearedDate, amountPaise },
        }] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Sync failed');
      setSyncMessage(`Applied ${data.count} Tally row and ${data.observationCount} payment observation. Switch profiles and repeat for the same buyer GSTIN.`);
      setSyncForm(current => ({ ...current, sourceId: '', amount: '' }));
    } catch (cause) { setError(cause.message); }
  }
  useEffect(() => {
    if (!payment?.id || payment.status === 'paid') return undefined;
    const timer = setInterval(async () => {
      try {
        const response = await sessionFetch(`${base}/workspaces/${workspaceId}/offers/payment-link/${payment.id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (response.ok) { const data = await response.json(); setPayment(current => current?.id === data.id ? { ...current, ...data } : current); }
      } catch { /* A later poll can recover from a temporary network error. */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [payment?.id, payment?.status, workspaceId, token]);
  const canPreview = businessRole === 'owner';
  if (!canPreview) return <section><h1>Operations</h1><p>Only the business owner can configure integrations, messaging and payment links.</p></section>;
  return <section className="operations">
    <h1>Operations</h1><p>Manage Tally sync, buyer reliability, and collection messages.</p>
    {!workspaceId ? <p>Select a workspace first.</p> : <>
      <ProactiveCollections workspaceId={workspaceId} token={token} enabled={canPreview} />
      <div className="card"><h2>Tally connection</h2><p>Enroll a sync device for this business. Payment observations stay isolated within this business; cross-business pooling is disabled.</p>
        <p><a href="/tally-sync/CashFlow-TallySync.ps1" download>Download the Windows Tally sync agent</a> · <a href="/tally-sync/README.md" target="_blank" rel="noreferrer">Setup instructions</a></p>
        <p>Payment telemetry: <strong>{consent ? 'enabled' : 'disabled'}</strong> <button type="button" className="secondary" onClick={async () => { try { const data = await ownerRequest('reliability/consent', 'PATCH', { share: !consent }); setConsent(data.share); } catch (cause) { setError(cause.message); } }}>{consent ? 'Withdraw consent' : 'Enable consent'}</button></p>
        <label>Device name<input value={deviceName} onChange={event => setDeviceName(event.target.value)} /></label><button type="button" onClick={async () => { try { const data = await ownerRequest('sync/devices', 'POST', { name: deviceName }); setDeviceToken(data.token); setSyncMessage('Device enrolled. Its token is shown below only for this session.'); } catch (cause) { setError(cause.message); } }}>Enroll sync device</button>
        <label>Sync device token<input type="password" autoComplete="off" value={deviceToken} onChange={event => setDeviceToken(event.target.value)} required /></label>
        <form onSubmit={submitSyncTest} className="form-grid"><label>Tally company ID<input value={syncForm.companyId} onChange={event => setSyncForm({ ...syncForm, companyId: event.target.value })} required /></label><label>Invoice/source ID<input value={syncForm.sourceId} onChange={event => setSyncForm({ ...syncForm, sourceId: event.target.value })} required /></label><label>Buyer GSTIN<input value={syncForm.buyerGstin} onChange={event => setSyncForm({ ...syncForm, buyerGstin: event.target.value.toUpperCase() })} maxLength="15" required /></label><label>Invoice date<input type="date" value={syncForm.invoiceDate} onChange={event => setSyncForm({ ...syncForm, invoiceDate: event.target.value })} required /></label><label>Due date<input type="date" value={syncForm.dueDate} onChange={event => setSyncForm({ ...syncForm, dueDate: event.target.value })} required /></label><label>Cleared date<input type="date" value={syncForm.clearedDate} onChange={event => setSyncForm({ ...syncForm, clearedDate: event.target.value })} required /></label><label>Paid amount (₹)<input inputMode="decimal" value={syncForm.amount} onChange={event => setSyncForm({ ...syncForm, amount: event.target.value })} required /></label><button disabled={!deviceToken || !consent}>Submit bridge test batch</button></form>
        {syncMessage && <p role="status">{syncMessage}</p>}
      </div>
      <div className="card"><h2>Tally sync</h2>
        <p>{status?.lastSuccessfulAt ? `Last successful sync: ${new Date(status.lastSuccessfulAt).toLocaleString('en-IN')}` : status ? 'No successful sync yet.' : 'Sync status has not been loaded.'}</p>
        {status?.latest && <p>Last batch: {new Date(status.latest.createdAt).toLocaleString('en-IN')} · {status.latest.count} rows</p>}
        {status?.latestRun && <p>Last agent run: {status.latestRun.status} · {status.latestRun.appliedCount} applied · {status.latestRun.pendingCount} pending</p>}
        {status?.actionableError && <p className="issue" role="alert">{status.actionableError.code}: {status.actionableError.message}</p>}
        <p>{status?.pendingChanges || 0} Tally change(s) waiting for review.</p>
        <button disabled={!canPreview} onClick={() => refreshSyncStatus().catch(cause => setError(cause.message))}>Refresh status and review queue</button>
        {syncChanges.map(change => <article className="decision-notice" key={change.id}>
          <h3>{change.kind === 'deleted' ? 'Tally deletion' : change.kind === 'backdated' ? 'Backdated record' : 'Changed Tally record'} · {change.proposedItem?.externalId || change.sourceId}</h3>
          <p>{change.proposedItem?.counterparty || change.before?.counterparty || 'New Tally record'} · {change.createdAt && new Date(change.createdAt).toLocaleString('en-IN')}</p>
          {change.before && <p>Current: {change.before.category} · INR {(change.before.amountPaise / 100).toLocaleString('en-IN')} · due {change.before.dueDate}</p>}
          {change.proposedItem && <p>Proposed: {change.proposedItem.category} · INR {(change.proposedItem.amountPaise / 100).toLocaleString('en-IN')} · due {change.proposedItem.dueDate}</p>}
          <button type="button" onClick={async () => { try { await ownerRequest(`sync/changes/${change.id}/resolve`, 'POST', { decision: 'accept' }); await refreshSyncStatus(); } catch (cause) { setError(cause.message); } }}>Accept Tally change</button>
          <button type="button" className="secondary" onClick={async () => { try { await ownerRequest(`sync/changes/${change.id}/resolve`, 'POST', { decision: 'keep_current' }); await refreshSyncStatus(); } catch (cause) { setError(cause.message); } }}>Keep current record</button>
        </article>)}
      </div>
      <div className="card"><h2>Payment timing suggestion</h2><p>Suggestions use only fully settled, verified invoices for the same customer in this business. They never change an expected date until you apply one.</p>
        <label>Open customer invoice<select value={timingItemId} onChange={event => { setTimingItemId(event.target.value); setTiming(null); }}><option value="">Choose an invoice</option>
          {receivables.filter(item => ['open', 'partial'].includes(item.status) && item.confidenceState !== 'needs_review').map(item => <option key={item.id} value={item.id}>Invoice {item.externalId || item.id} · due {item.dueDate}</option>)}</select></label>
        <button type="button" disabled={!timingItemId} onClick={() => loadPaymentTiming().catch(cause => setError(cause.message))}>Review same-business evidence</button>
        {timing && (timing.available ? <div><p>{timing.explanation}</p><p>Suggested expected date: {timing.expectedDate} · confidence {timing.confidence} · evidence range {timing.rangeDaysLate.low} to {timing.rangeDaysLate.high} days from due date.</p>
          <p>Current owner-entered date: {timing.ownerExpectedDate || 'none'}.</p><details><summary>Evidence ({timing.evidenceCount} invoices)</summary><ul>{timing.evidence.map((record, index) => <li key={`${record.clearedDate}-${index}`}>Due {record.dueDate} · cleared {record.clearedDate} · {record.latenessDays} days from due date</li>)}</ul></details>
          <button type="button" onClick={async () => { try { await ownerRequest(`reliability/payment-timing/${timingItemId}/apply`, 'POST', { confirm: true, expectedDate: timing.expectedDate }); setTiming({ ...timing, ownerExpectedDate: timing.expectedDate }); setReceivables(records => records.map(item => item.id === timingItemId ? { ...item, expectedDate: timing.expectedDate } : item)); } catch (cause) { setError(cause.message); } }}>Apply suggested date</button>
        </div> : <p>{timing.reason}</p>)}
      </div>
      <form className="card" onSubmit={async e => { e.preventDefault(); try { const response = await sessionFetch(`${base}/workspaces/${workspaceId}/reliability/buyers/${encodeURIComponent(gstin.toUpperCase())}`, { headers: { Authorization: `Bearer ${token}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message); setScore(data); } catch (cause) { setError(cause.message); } }}>
        <h2>Buyer payment reliability</h2><label>Buyer GSTIN<input value={gstin} onChange={e => setGstin(e.target.value)} placeholder={demoMode ? 'Demo: 22AAAAA0000A1Z5' : ''} required /></label><button disabled={!canPreview}>Check score</button>
        {score && <p>{score.available ? `Median clearance: ${score.clearanceDays} days; median lateness: ${score.latenessDays} days; score: ${score.score}/100; ${score.supplierCount} suppliers.` : score.reason}</p>}
      </form>
      <form className="card" onSubmit={async e => { e.preventDefault(); setConfirmSend(false); setPayment(null); try { setOffer(await call('offers/preview', { cashItemId: itemId, ...(amount ? { amountPaise: parseRupees(amount) } : {}), phone, settleBy: date, discountBps: Number(discount) })); } catch (cause) { setError(cause.message); } }}>
        <h2>Early collection draft</h2><p>Choose an open receivable, then review the amount and wording before opening WhatsApp.</p>
        <label>Open receivable<select value={itemId} onChange={e => { const id = e.target.value; setItemId(id); setAmount(''); setDate(receivables.find(item => item.id === id)?.constraints?.earliestCollectionDate || ''); setOffer(null); setPayment(null); setConfirmSend(false); }} required><option value="">Choose an invoice</option>{receivables.map(item => <option key={item.id} value={item.id}>{item.externalId || item.counterparty} — {item.counterparty}</option>)}</select></label>
        <label>Offer amount (₹)<input inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setOffer(null); setPayment(null); setConfirmSend(false); }} placeholder="Uses permitted early amount if blank" /></label>
        <label>Buyer phone with country code (+ optional)<input type="tel" inputMode="tel" pattern="\+?[0-9]{10,15}" value={phone} onChange={e => { setPhone(e.target.value); setOffer(null); setPayment(null); setConfirmSend(false); }} placeholder="+91…" required /></label>
        <label>Settle by<input type="date" value={date} onChange={e => { setDate(e.target.value); setOffer(null); setPayment(null); setConfirmSend(false); }} required /></label>
        <label>Discount, basis points<input type="number" min="0" max="10000" value={discount} onChange={e => { setDiscount(e.target.value); setOffer(null); setPayment(null); setConfirmSend(false); }} required /></label>
        <button disabled={!canPreview}>Preview draft</button>
        {!canPreview && <p role="status">Business owner access is required.</p>}
        {offer && <div><p>{payment?.message || offer.message}</p><p>Lowest cash: {inputRupees(offer.forecast.baselineWorstCashPaise)} → {inputRupees(offer.forecast.simulatedWorstCashPaise)} INR (conditional simulation).</p><p>{payment ? `Razorpay payment: ${payment.status === 'paid' ? 'confirmed' : 'waiting for payment'}` : 'Send this draft directly, or add an optional Razorpay link first.'}</p>{payment?.status === 'paid' && payment.worstCashPaise != null && <p>Updated forecast lowest cash: {inputRupees(payment.worstCashPaise)} INR.</p>}{payment?.paymentUrl && <p><a href={payment.paymentUrl} target="_blank" rel="noopener noreferrer">Open payment link</a></p>}<button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(payment?.message || offer.message).catch(() => setError('Could not copy message'))}>{payment ? 'Copy message with link' : 'Copy message'}</button> <button type="button" onClick={async () => { try { const data = await call('offers/payment-link', { cashItemId: itemId, ...(amount ? { amountPaise: parseRupees(amount) } : {}), phone, settleBy: date, discountBps: Number(discount) }); setPayment(data); } catch (cause) { setError(cause.message); } }} disabled={!!payment}>Add Razorpay link to message</button> <button type="button" onClick={() => setConfirmSend(true)}>{payment ? 'Send through WhatsApp with link' : 'Send through WhatsApp without link'}</button>
          {confirmSend && <div className="decision-notice" role="group" aria-label="Confirm WhatsApp recipient"><p>Send to +{offer.recipientPhone}? Choose WhatsApp Desktop or the browser. Your chosen app must be linked to your account; review the filled message there and press Send.</p><a href={payment ? `whatsapp://send?phone=${offer.recipientPhone}&text=${encodeURIComponent(payment.message)}` : offer.desktopUrl} onClick={() => setConfirmSend(false)}>Open WhatsApp Desktop</a> {' · '} <a href={payment ? `https://wa.me/${offer.recipientPhone}?text=${encodeURIComponent(payment.message)}` : offer.whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={() => setConfirmSend(false)}>Open WhatsApp Web</a> {' · '} <button type="button" className="secondary" onClick={() => setConfirmSend(false)}>Cancel</button></div>}
        </div>}
      </form>
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}
