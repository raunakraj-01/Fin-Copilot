import React, { useEffect, useState } from 'react';
import { api, json } from '../services/api.js';
import { locale, t, useLanguage } from '../i18n/index.js';

const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR' }).format(value / 100);
const empty = { itemId: '', promiseId: '', amount: '', date: '', note: '', mode: 'promise' };
const statusLabel = status => ({ review_external_settlement: 'Payment recorded elsewhere — review',
  superseded: 'Replaced', cancelled: 'Cancelled', fulfilled: 'Fulfilled', broken: 'Broken', partial: 'Partly received', pending: 'Pending' }[status] || status);

export default function PaymentPromises({ workspaceId, refreshKey, onChanged }) {
  useLanguage();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [risks, setRisks] = useState([]);
  const [retryId, setRetryId] = useState(null);
  async function load() {
    const [result, forecast] = await Promise.all([api(`/workspaces/${workspaceId}/promises`), api(`/workspaces/${workspaceId}/forecast`)]);
    setData(result); setRisks(forecast.promiseRisks || []);
  }
  useEffect(() => {
    let active = true;
    setData(null); setForm(empty); setRetryId(null); setMessage('');
    Promise.all([api(`/workspaces/${workspaceId}/promises`), api(`/workspaces/${workspaceId}/forecast`)])
      .then(([result, forecast]) => { if (active) { setData(result); setRisks(forecast.promiseRisks || []); } })
      .catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [workspaceId, refreshKey]);

  function edit(item, promise, mode) {
    setMessage(''); setRetryId(null);
    setForm({ itemId: item.id, promiseId: promise.id, mode, amount: String(promise.remainingPaise / 100),
      date: mode === 'receipt' ? data.asOfDate : promise.promisedDate, note: '' });
  }
  async function submit(event) {
    event.preventDefault(); if (busy) return;
    const amountPaise = Math.round(Number(form.amount) * 100);
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) { setMessage('Enter a positive amount with at most two decimal places.'); return; }
    setBusy(true); setMessage('');
    try {
      let path = `/workspaces/${workspaceId}/items/${form.itemId}/promises`;
      let method = 'POST';
      let body = { amountPaise, promisedDate: form.date, note: form.note };
      if (form.promiseId) { path += `/${form.promiseId}`; method = 'PATCH'; }
      if (form.mode === 'receipt') {
        const requestId = retryId || crypto.randomUUID(); setRetryId(requestId);
        path += '/receipts'; method = 'POST';
        body = { amountPaise, receivedDate: form.date, note: form.note, requestId };
      }
      await json(path, method, body);
      setForm(empty); setRetryId(null);
      setMessage(form.mode === 'receipt' ? 'Payment confirmed. Invoice balance and forecast updated.' : 'Promise saved. Forecast updated.');
      onChanged?.();
      try { await load(); } catch { setMessage('Saved. Refresh to load the updated forecast.'); }
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  async function cancel(item, promise) {
    setBusy(true); setMessage('');
    try {
      await json(`/workspaces/${workspaceId}/items/${item.id}/promises/${promise.id}/cancel`, 'POST', { note: 'Withdrawn by owner' });
      onChanged?.(); await load(); setMessage('Promise cancelled. Unpromised balance uses the invoice expected date.');
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  function change(values) { setForm(current => ({ ...current, ...values })); setRetryId(null); }
  return <div className="card">
    <h2>{t('Payment promises')}</h2>
    <p>Track installments and receipts as of <strong>{data?.asOfDate || '…'}</strong>. Promises replace the invoice receipt in the forecast; payments already received belong in opening cash.</p>
    <form onSubmit={submit} className="form-grid">
      <fieldset disabled={busy} className="form-grid">
        <legend>{form.mode === 'receipt' ? 'Confirm actual payment' : form.promiseId ? 'Revise remaining promise' : 'Add payment promise'}</legend>
        <label>Promise invoice<select required value={form.itemId} disabled={!!form.promiseId} onChange={e => change({ itemId: e.target.value })}>
          <option value="">Choose an invoice</option>{data?.items.filter(i => i.outstandingPaise > 0 && ['open', 'partial'].includes(i.status)).map(i => <option key={i.id} value={i.id}>{i.externalId || i.counterparty} · {money(i.outstandingPaise)}</option>)}
        </select></label>
        <label>{form.mode === 'receipt' ? 'Received amount (₹)' : 'Promised amount (₹)'}<input required type="number" min="0.01" step="0.01" value={form.amount} onChange={e => change({ amount: e.target.value })} /></label>
        <label>{form.mode === 'receipt' ? 'Actual receipt date' : 'Promised payment date'}<input required type="date" value={form.date} onChange={e => change({ date: e.target.value })} /></label>
        <label>Promise note<input maxLength={1000} value={form.note} onChange={e => change({ note: e.target.value })} /></label>
        {form.mode === 'receipt' && <p>Record a new payment once here. Do not also add it through Already settled. This changes the invoice balance; it does not change the opening cash snapshot.</p>}
        <button disabled={!form.itemId}>{busy ? 'Saving…' : form.mode === 'receipt' ? 'Confirm payment' : 'Save promise'}</button>
        {form.promiseId && <button className="secondary" type="button" onClick={() => { setForm(empty); setRetryId(null); }}>Clear selection</button>}
      </fieldset>
    </form>
    {message && <p role="status">{message}</p>}
    {data && !data.items.some(i => i.promises.length) && <p>No payment promises recorded yet.</p>}
    {data?.items.filter(i => i.promises.length).map(item => <div key={item.id}>
      <h3>{item.externalId || item.counterparty} · {item.counterparty}</h3>
      {item.confidenceState === 'needs_review' && <p className="issue">Invoice needs review. Its promises are excluded from the forecast until the record is verified in Setup & Import.</p>}
      {item.promises.map(p => <article className="card" key={p.id}>
        <p><strong>{money(p.amountPaise)} by {p.promisedDate} · {statusLabel(p.status)}</strong><br />Received: {money(p.receivedPaise || 0)} · Remaining promise: {money(p.remainingPaise)}</p>
        {p.status === 'review_external_settlement' && <p className="issue">A payment or balance change was recorded outside this tracker. Review the remaining promises; do not record that payment again. The forecast caps receipts to the invoice balance.</p>}
        {!p.closedAs && p.remainingPaise > 0 && item.outstandingPaise > 0 && ['open', 'partial'].includes(item.status) && <div className="page-actions">
          <button disabled={busy} type="button" onClick={() => edit(item, p, 'promise')}>Revise promise</button>
          <button disabled={busy} type="button" onClick={() => edit(item, p, 'receipt')}>Record payment</button>
          <button disabled={busy} type="button" className="secondary" onClick={() => cancel(item, p)}>Cancel promise</button>
        </div>}
        {risks.filter(r => r.promiseId === p.id).map(r => <div key={r.promiseId}><p>{r.comparison}</p>
          {r.affectedPayments.length ? <ul>{r.affectedPayments.map((payment, index) => <li key={`${payment.id}-${index}`}>{payment.date} · {payment.label} · Payment {money(payment.amountPaise)} · Cash below reserve by {money(payment.gapPaise)}</li>)}</ul> : <p>No upcoming payment is exposed within the current forecast horizon.</p>}
        </div>)}
        <details><summary>Promise history</summary><ul>{p.history.map((h, index) => <li key={index}>{new Date(h.at).toLocaleString()} · {h.action} · {h.statusBefore && `previously ${h.statusBefore} · `}{h.amountPaise != null && `${money(h.amountPaise)} · `}{h.receivedDate || h.promisedDate || h.asOfDate} {h.note}</li>)}</ul></details>
      </article>)}
    </div>)}
  </div>;
}
