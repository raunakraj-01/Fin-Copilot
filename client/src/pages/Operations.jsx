import React, { useEffect, useState } from 'react';
import { inputRupees, parseRupees } from './OrderAnalyzer/money.js';

const base = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:5000/api');

export default function Operations({ workspaceId, operationsItemId }) {
  const [token, setToken] = useState('');
  const [demoMode, setDemoMode] = useState(false);
  const [localSyntheticDev, setLocalSyntheticDev] = useState(false);
  const [receivables, setReceivables] = useState([]);
  const [status, setStatus] = useState(null);
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
  const [error, setError] = useState('');
  useEffect(() => { setStatus(null); setScore(null); setOffer(null); setPayment(null); setConfirmSend(false); setReceivables([]);
    if (workspaceId) fetch(`${base}/workspaces/${workspaceId}/items?category=receivable`).then(response => response.json())
      .then(data => setReceivables((data.items || []).filter(item => ['open', 'partial'].includes(item.status)))).catch(() => {});
  }, [workspaceId]);
  useEffect(() => { fetch(`${base}/health`).then(response => response.json()).then(data => {
    setDemoMode(data.demoMode === true); setLocalSyntheticDev(data.localSyntheticDev === true);
  }).catch(() => {}); }, []);
  useEffect(() => { if (operationsItemId) { setItemId(operationsItemId.cashItemId); setAmount(inputRupees(operationsItemId.amountPaise)); setDate(operationsItemId.toDate); } }, [operationsItemId]);
  async function call(path, body) {
    setError('');
    const response = await fetch(`${base}/workspaces/${workspaceId}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Request failed');
    return data;
  }
  useEffect(() => {
    if (!payment?.id || payment.status === 'paid') return undefined;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`${base}/workspaces/${workspaceId}/offers/payment-link/${payment.id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (response.ok) { const data = await response.json(); setPayment(current => current?.id === data.id ? { ...current, ...data } : current); }
      } catch { /* A later poll can recover from a temporary network error. */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [payment?.id, payment?.status, workspaceId, token]);
  const canPreview = demoMode || localSyntheticDev || !!token;
  return <section className="operations">
    <h1>Operations</h1><p>Review Tally sync, payment reliability, and a proposed early-payment message. Real financial data requires an authorized deployment.</p>
    {!workspaceId ? <p>Select a workspace first.</p> : <>
      {demoMode ? <p className="decision-notice">Synthetic demo mode: sample sync and payment observations. No message or payment is sent.</p> : localSyntheticDev ? <p className="decision-notice">Local synthetic dev: offer previews are available without a token. No message or payment is sent.</p> : <div className="card"><label>Owner access token<input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label><p>Kept in this page only. The server must have FEATURE_ADMIN_TOKEN configured.</p></div>}
      <div className="card"><h2>Tally sync</h2><p>{status?.latest ? `Last batch: ${new Date(status.latest.createdAt).toLocaleString()} (${status.latest.count} rows)${demoMode ? ' — seeded sample' : ''}` : 'No sync batch loaded.'}</p><button disabled={!demoMode && !token} onClick={async () => { try { const response = await fetch(`${base}/workspaces/${workspaceId}/sync/status`, { headers: { Authorization: `Bearer ${token}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message); setStatus(data); } catch (cause) { setError(cause.message); } }}>Refresh status</button></div>
      <form className="card" onSubmit={async e => { e.preventDefault(); try { const response = await fetch(`${base}/workspaces/${workspaceId}/reliability/buyers/${encodeURIComponent(gstin.toUpperCase())}`, { headers: { Authorization: `Bearer ${token}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message); setScore(data); } catch (cause) { setError(cause.message); } }}>
        <h2>Buyer payment reliability</h2><label>Buyer GSTIN<input value={gstin} onChange={e => setGstin(e.target.value)} placeholder={demoMode ? 'Demo: 22AAAAA0000A1Z5' : ''} required /></label><button disabled={!demoMode && !token}>Check score</button>
        {score && <p>{score.available ? `Median clearance: ${score.clearanceDays} days; median lateness: ${score.latenessDays} days; score: ${score.score}/100; ${score.supplierCount} suppliers.` : score.reason}</p>}
      </form>
      <form className="card" onSubmit={async e => { e.preventDefault(); setConfirmSend(false); setPayment(null); try { setOffer(await call('offers/preview', { cashItemId: itemId, ...(amount ? { amountPaise: parseRupees(amount) } : {}), phone, settleBy: date, discountBps: Number(discount) })); } catch (cause) { setError(cause.message); } }}>
        <h2>Early collection draft</h2><p>Choose an open receivable, then review the amount and wording before opening WhatsApp.</p>
        <label>Open receivable<select value={itemId} onChange={e => { const id = e.target.value; setItemId(id); setAmount(''); setDate(receivables.find(item => item.id === id)?.constraints?.earliestCollectionDate || ''); setOffer(null); setConfirmSend(false); }} required><option value="">Choose an invoice</option>{receivables.map(item => <option key={item.id} value={item.id}>{item.externalId || item.counterparty} — {item.counterparty}</option>)}</select></label>
        <label>Offer amount (₹)<input inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setOffer(null); setConfirmSend(false); }} placeholder="Uses permitted early amount if blank" /></label>
        <label>Buyer phone with country code (+ optional)<input type="tel" inputMode="tel" pattern="\+?[0-9]{10,15}" value={phone} onChange={e => { setPhone(e.target.value); setOffer(null); setConfirmSend(false); }} placeholder="+91…" required /></label>
        <label>Settle by<input type="date" value={date} onChange={e => { setDate(e.target.value); setOffer(null); setConfirmSend(false); }} required /></label>
        <label>Discount, basis points<input type="number" min="0" max="10000" value={discount} onChange={e => { setDiscount(e.target.value); setOffer(null); setConfirmSend(false); }} required /></label>
        <button disabled={!canPreview}>Preview draft</button>
        {!canPreview && <p role="status">Set FEATURE_ADMIN_TOKEN on the server and enter it above to enable previews.</p>}
        {offer && <div><p>{payment?.message || offer.message}</p><p>Lowest cash: {inputRupees(offer.forecast.baselineWorstCashPaise)} → {inputRupees(offer.forecast.simulatedWorstCashPaise)} INR (conditional simulation).</p><p>{payment ? `Razorpay payment: ${payment.status === 'paid' ? 'confirmed' : 'waiting for payment'}` : 'Add the Razorpay link before copying or sending this message.'}</p>{payment?.status === 'paid' && payment.worstCashPaise != null && <p>Updated forecast lowest cash: {inputRupees(payment.worstCashPaise)} INR.</p>}{payment?.paymentUrl && <p><a href={payment.paymentUrl} target="_blank" rel="noopener noreferrer">Open payment link</a></p>}<button type="button" className="secondary" disabled={!payment} onClick={() => navigator.clipboard.writeText(payment.message).catch(() => setError('Could not copy message'))}>Copy message with link</button> <button type="button" onClick={async () => { try { const data = await call('offers/payment-link', { cashItemId: itemId, ...(amount ? { amountPaise: parseRupees(amount) } : {}), phone, settleBy: date, discountBps: Number(discount) }); setPayment(data); } catch (cause) { setError(cause.message); } }} disabled={!!payment}>Add Razorpay link to message</button> <button type="button" disabled={!payment} onClick={() => setConfirmSend(true)}>Send through WhatsApp</button>
          {confirmSend && <div className="decision-notice" role="group" aria-label="Confirm WhatsApp recipient"><p>Send to +{offer.recipientPhone}? Choose WhatsApp Desktop or the browser. Your chosen app must be linked to your account; review the filled message there and press Send.</p><a href={payment ? `whatsapp://send?phone=${offer.recipientPhone}&text=${encodeURIComponent(payment.message)}` : offer.desktopUrl} onClick={() => setConfirmSend(false)}>Open WhatsApp Desktop</a> {' · '} <a href={payment ? `https://wa.me/${offer.recipientPhone}?text=${encodeURIComponent(payment.message)}` : offer.whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={() => setConfirmSend(false)}>Open WhatsApp Web</a> {' · '} <button type="button" className="secondary" onClick={() => setConfirmSend(false)}>Cancel</button></div>}
        </div>}
      </form>
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}
