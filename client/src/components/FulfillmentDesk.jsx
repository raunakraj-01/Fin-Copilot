import React, { useEffect, useState } from 'react';
import { api, json } from '../services/api.js';

const todayIndia = () => {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const inr = paise => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format((paise || 0) / 100);
const statuses = [
  ['accepted', 'Accepted'], ['in_production', 'In production'], ['ready_to_dispatch', 'Ready to dispatch'],
  ['cancelled', 'Cancelled'],
];

export default function FulfillmentDesk({ workspaceId, businessRole = 'owner', refreshKey = 0 }) {
  const [orders, setOrders] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [receivables, setReceivables] = useState([]);
  const [form, setForm] = useState({ orderScenarioId: '', customerName: '', phone: '', expectedDeliveryDate: '', finalCollectionDate: '', advanceCashItemId: '' });
  const [statusForms, setStatusForms] = useState({});
  const [dispatchForms, setDispatchForms] = useState({});
  const [followupForms, setFollowupForms] = useState({});
  const [busy, setBusy] = useState(false);
  const [busyOrder, setBusyOrder] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    if (!workspaceId) return;
    const [tracking, saved, ledger] = await Promise.all([
      api(`/workspaces/${workspaceId}/fulfillment`), api(`/workspaces/${workspaceId}/orders/scenarios`),
      api(`/workspaces/${workspaceId}/items?category=receivable`),
    ]);
    setOrders(tracking.orders || []);
    setScenarios(saved.scenarios || []);
    setReceivables(ledger.items || []);
  }

  useEffect(() => { setOrders([]); setScenarios([]); setReceivables([]); setMessage(''); setError(''); load().catch(cause => setError(cause.message)); }, [workspaceId]);
  useEffect(() => { if (refreshKey) load().catch(cause => setError(cause.message)); }, [refreshKey]);

  async function startTracking(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const result = await json(`/workspaces/${workspaceId}/fulfillment`, 'POST', {
        ...form, ...(form.expectedDeliveryDate ? {} : { expectedDeliveryDate: undefined }),
        ...(form.finalCollectionDate ? {} : { finalCollectionDate: undefined }),
        ...(form.advanceCashItemId ? {} : { advanceCashItemId: undefined }),
      });
      setMessage(result.alreadyTracked ? 'This saved order is already on the delivery board.' : 'Order added to the delivery board. No new cash record was created.');
      setForm({ orderScenarioId: '', customerName: '', phone: '', expectedDeliveryDate: '', finalCollectionDate: '', advanceCashItemId: '' });
      await load();
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  async function updateStatus(event, order) {
    event.preventDefault(); setBusyOrder(order.id); setError(''); setMessage('');
    const draft = statusForms[order.id] || { status: order.status, note: '' };
    try {
      await json(`/workspaces/${workspaceId}/fulfillment/${order.id}/status`, 'PATCH', draft);
      setMessage(`${order.scenarioLabel} progress updated.`); await load();
    } catch (cause) { setError(cause.message); }
    finally { setBusyOrder(''); }
  }

  async function confirmDispatch(event, order) {
    event.preventDefault(); setBusyOrder(order.id); setError(''); setMessage('');
    const draft = dispatchForms[order.id] || {};
    const requestId = draft.requestId || crypto.randomUUID();
    const next = { ...draft, requestId };
    setDispatchForms(current => ({ ...current, [order.id]: next }));
    try {
      const result = await json(`/workspaces/${workspaceId}/fulfillment/${order.id}/dispatch`, 'POST', next);
      setMessage(result.message || 'Dispatch and invoice recorded.'); await load();
    } catch (cause) { setError(cause.message); }
    finally { setBusyOrder(''); }
  }

  async function scheduleFollowup(order) {
    setBusyOrder(order.id); setError(''); setMessage('');
    const draft = followupForms[order.id] || { mode: 'demo', recipientOptIn: false };
    try {
      const result = await json(`/workspaces/${workspaceId}/fulfillment/${order.id}/collection-followup`, 'POST', draft);
      setMessage(result.message); await load();
    } catch (cause) { setError(cause.message); }
    finally { setBusyOrder(''); }
  }

  const selectedScenario = scenarios.find(item => item._id === form.orderScenarioId);
  return <section className="card fulfillment-desk">
    <h2>Delivery to invoice to collection</h2>
    <p>Track accepted work through production and dispatch. Confirm delivery with a proof reference to create the final-balance receivable once. Advance receipts are linked to existing ledger items and are never added again here.</p>
    {!workspaceId ? <p>Select a business first.</p> : businessRole !== 'owner' ? <p>Only the business owner can start and update fulfillment tracking.</p> : <>
      <form className="form-grid" onSubmit={startTracking}>
        <label>Saved cash-tested order<select required value={form.orderScenarioId} onChange={event => {
          const scenario = scenarios.find(item => item._id === event.target.value);
          setForm(current => ({ ...current, orderScenarioId: event.target.value,
            expectedDeliveryDate: '', finalCollectionDate: scenario?.finalCollectionDate || '' }));
        }}><option value="">Choose a saved order analysis</option>{scenarios.filter(scenario => !orders.some(order => order.orderScenarioId === scenario._id) && !['completed', 'cancelled'].includes(scenario.trackingStatus)).map(scenario =>
          <option key={scenario._id} value={scenario._id}>{scenario.label} · {inr(scenario.orderValuePaise)}</option>)}</select></label>
        <label>Customer/business name<input required maxLength="160" value={form.customerName} onChange={event => setForm({ ...form, customerName: event.target.value })} /></label>
        <label>Customer WhatsApp number<input required type="tel" pattern="\+?[0-9]{10,15}" placeholder="+91…" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
        <label>Expected delivery date<input type="date" required value={form.expectedDeliveryDate} onChange={event => setForm({ ...form, expectedDeliveryDate: event.target.value })} /></label>
        <label>Final collection date<input type="date" required value={form.finalCollectionDate} onChange={event => setForm({ ...form, finalCollectionDate: event.target.value })} /></label>
        <label>Already-recorded advance invoice (optional)<select value={form.advanceCashItemId} onChange={event => setForm({ ...form, advanceCashItemId: event.target.value })}>
          <option value="">No advance invoice already in ledger</option>{receivables.map(item => <option key={item.id} value={item.id}>{item.externalId || item.counterparty} · invoice {inr(item.amountPaise)}, received {inr(item.settledPaise)}</option>)}
        </select></label>
        {selectedScenario && <p className="decision-muted">Order value {inr(selectedScenario.orderValuePaise)} · proposed advance {inr(selectedScenario.advancePaise)}. The linked advance invoice amount is deducted from the final balance; receipts stay on that invoice and no receipt is created here.</p>}
        <button disabled={busy || !scenarios.length}>{busy ? 'Saving…' : 'Start delivery tracking'}</button>
      </form>
      {orders.length === 0 ? <p>No accepted orders are on the delivery board yet.</p> : <div className="fulfillment-order-list">{orders.map(order => {
        const statusDraft = statusForms[order.id] || { status: order.status, note: '' };
        const dispatch = dispatchForms[order.id] || { dispatchDate: todayIndia(), proofReference: '', invoiceDueDate: order.finalCollectionDate, invoiceNumber: '', requestId: '' };
        const followup = followupForms[order.id] || { mode: 'demo', recipientOptIn: false };
        return <article className="decision-notice" key={order.id}>
          <h3>{order.scenarioLabel} · {order.customerName}</h3>
          <p>Status: <strong>{order.status.replaceAll('_', ' ')}</strong> · {inr(order.orderValuePaise)} total · {inr(order.advanceAppliedPaise)} advance already represented · {inr(order.finalBalancePaise)} final balance</p>
          <p>Expected delivery {order.expectedDeliveryDate} · Final collection {order.finalCollectionDate}{order.statusNote ? ` · ${order.statusNote}` : ''}</p>
          {!['delivered', 'cancelled'].includes(order.status) && <>
            <form className="form-grid" onSubmit={event => updateStatus(event, order)}>
              <label>Production progress<select value={statusDraft.status} onChange={event => setStatusForms(current => ({ ...current, [order.id]: { ...statusDraft, status: event.target.value } }))}>
                {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              <label>Note<input maxLength="500" value={statusDraft.note} onChange={event => setStatusForms(current => ({ ...current, [order.id]: { ...statusDraft, note: event.target.value } }))} /></label>
              <button className="secondary" disabled={busyOrder === order.id}>Save progress</button>
            </form>
            {order.status === 'ready_to_dispatch' && <form className="form-grid" onSubmit={event => confirmDispatch(event, order)}>
              <h4>Confirm dispatch</h4>
              <label>Dispatch date<input type="date" required value={dispatch.dispatchDate} onChange={event => setDispatchForms(current => ({ ...current, [order.id]: { ...dispatch, dispatchDate: event.target.value } }))} /></label>
              <label>Proof of delivery reference<input required maxLength="500" placeholder="Courier tracking ID or POD link" value={dispatch.proofReference} onChange={event => setDispatchForms(current => ({ ...current, [order.id]: { ...dispatch, proofReference: event.target.value } }))} /></label>
              <label>Invoice due date<input type="date" required value={dispatch.invoiceDueDate} onChange={event => setDispatchForms(current => ({ ...current, [order.id]: { ...dispatch, invoiceDueDate: event.target.value } }))} /></label>
              <label>Invoice number (optional)<input maxLength="100" value={dispatch.invoiceNumber} onChange={event => setDispatchForms(current => ({ ...current, [order.id]: { ...dispatch, invoiceNumber: event.target.value } }))} /></label>
              <button disabled={busyOrder === order.id}>{busyOrder === order.id ? 'Recording…' : 'Confirm delivery & create invoice'}</button>
              <p className="decision-muted">The invoice will contain only the final balance. No payment is recorded by this step.</p>
            </form>}
          </>}
          {order.status === 'delivered' && <>
            <p>Delivered {order.dispatchDate} · POD: {order.proofReference || 'recorded'} · Invoice {order.invoiceNumber || 'none needed'}{order.invoiceDueDate ? ` · due ${order.invoiceDueDate}` : ''}</p>
            {order.invoiceCashItemId && <div className="form-grid">
              <label>Collection automation<select value={followup.mode} onChange={event => setFollowupForms(current => ({ ...current, [order.id]: { ...followup, mode: event.target.value } }))}>
                <option value="demo">Local reminder drafts only</option><option value="n8n">Automatic WhatsApp (requires setup)</option>
              </select></label>
              {followup.mode === 'n8n' && <label><input type="checkbox" checked={followup.recipientOptIn} onChange={event => setFollowupForms(current => ({ ...current, [order.id]: { ...followup, recipientOptIn: event.target.checked } }))} /> Customer opted in to WhatsApp reminders</label>}
              <button type="button" className="secondary" disabled={busyOrder === order.id || followup.mode === 'n8n' && !followup.recipientOptIn} onClick={() => scheduleFollowup(order)}>
                {busyOrder === order.id ? 'Scheduling…' : followup.mode === 'demo' ? 'Schedule reminder drafts' : 'Schedule opted-in WhatsApp follow-ups'}
              </button>
              <p className="decision-muted">Scheduling is a separate owner action. Draft mode sends nothing; live sending requires configured n8n and customer opt-in.</p>
            </div>}
          </>}
          {order.statusHistory?.length > 0 && <details><summary>Order history ({order.statusHistory.length})</summary><ol>{order.statusHistory.map((entry, index) => <li key={index}>{entry.status.replaceAll('_', ' ')} · {new Date(entry.at).toLocaleString()}{entry.note ? ` · ${entry.note}` : ''}</li>)}</ol></details>}
        </article>;
      })}</div>}
    </>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
