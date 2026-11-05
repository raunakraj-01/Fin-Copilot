import React, { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { locale } from '../i18n/index.js';

const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR' }).format(value / 100);
export default function SpendingCheck({ workspaceId, refreshKey }) {
  const [horizon, setHorizon] = useState('30');
  const [delay, setDelay] = useState('7');
  const [confirmedFor, setConfirmedFor] = useState('');
  const [amount, setAmount] = useState('');
  const [requestAmount, setRequestAmount] = useState(0);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const confirmationKey = `${workspaceId}:${refreshKey}:${horizon}`;
  const confirmed = confirmedFor === confirmationKey;
  const requestKey = `${confirmationKey}:${delay}:${confirmed}:${requestAmount}:${version}`;
  const result = response?.key === requestKey ? response.value : null;
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    const params = new URLSearchParams({ horizonDays: horizon, delayDays: delay, commitmentsConfirmed: String(confirmed), spendPaise: String(requestAmount) });
    api(`/workspaces/${workspaceId}/spending-check?${params}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setResponse({ key: requestKey, value }); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [workspaceId, requestKey]);
  function check(event) {
    event.preventDefault();
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || !Number.isSafeInteger(Math.round(Number(amount) * 100))) {
      setError('Enter a nonnegative rupee amount with at most two decimal places.'); return;
    }
    setRequestAmount(Math.round(Number(amount) * 100)); setVersion(v => v + 1);
  }
  const purchaseCurrent = amount !== '' && Math.round(Number(amount) * 100) === requestAmount;
  return <div className="card" aria-label="Reserve-aware spending check">
    <h2>How much can I spend?</h2>
    <p>Compare an additional payment today against your minimum reserve throughout the selected period.</p>
    <div className="form-grid">
      <label>Planning period<select value={horizon} onChange={e => setHorizon(e.target.value)}>{['7', '30', '60', '90'].map(d => <option key={d} value={d}>{d} days</option>)}</select></label>
      <label>Customer payment delay<select value={delay} onChange={e => setDelay(e.target.value)}>{['7', '15', '30'].map(d => <option key={d} value={d}>{d} days late</option>)}</select></label>
    </div>
    <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmedFor(e.target.checked ? confirmationKey : '')} /> I included all wages, tax payments, supplier bills, loan payments and other commitments for this period.</label>
    <p>Add missing commitments in Setup & Import. Confirm the cash snapshot includes all payments already received.</p>
    {error && <div><p role="alert">{error}</p><button type="button" className="secondary" onClick={() => setVersion(v => v + 1)}>Retry spending check</button></div>}
    {!result && !error && <p role="status">Calculating spending limits…</p>}
    {result && <>
      <p>Cash snapshot: {result.asOfDate} · Through {result.endDate} · Protected reserve: {money(result.minimumReservePaise)}</p>
      {result.status === 'incomplete' && <p role="status" className="issue">Data incomplete — spending limits are unavailable. Resolve the issues below.</p>}
      <div className="metrics">{[['Expected payments', result.expected], [`Payments ${result.delayDays} days late`, result.delayed]].map(([label, scenario]) => <article key={label} className="card">
        <h3>{label}</h3><strong>{scenario.spendablePaise == null ? 'Unavailable' : money(scenario.spendablePaise)}</strong>
        <p>Additional spending limit</p>
        <p>Included receipts: {money(scenario.includedReceiptsPaise)} · Included payments: {money(scenario.includedPaymentsPaise)}</p>
        <p>Lowest projected balance before spending: {money(scenario.minimumBalancePaise)} on {scenario.minimumDate}</p>
        {scenario.reserveGapPaise > 0 && <p className="issue">Existing plan is below reserve by {money(scenario.reserveGapPaise)}. First breach: {scenario.firstReserveBreachDate}.</p>}
        {purchaseCurrent && scenario.canSpend != null && <p>{scenario.canSpend ? 'Your proposed payment preserves the reserve in this scenario.' : `Your proposed payment breaches the reserve on ${scenario.firstBreachAfterSpend}.`} Lowest balance after payment: {money(scenario.afterSpendMinimumPaise)}.</p>}
      </article>)}</div>
      {result.recommendedSpendablePaise != null && <p className="notice"><strong>{result.expected.firstReserveBreachDate || result.delayed.firstReserveBreachDate
        ? 'No additional spending room. The existing plan already falls below reserve.'
        : `Limit that preserves the reserve in both scenarios: ${money(result.recommendedSpendablePaise)}`}</strong></p>}
      <form onSubmit={check} className="form-grid">
        <label>Proposed spending (₹)<input type="number" min="0" step="0.01" value={amount} required onChange={e => setAmount(e.target.value)} /></label>
        <button>Check this payment</button>
      </form>
      {result.dataQuality.issues.length > 0 && <div><h3>Data to review</h3><ul>{result.dataQuality.issues.map((issue, i) => <li key={`${issue.code}-${i}`}>{issue.message}{issue.amountPaise > 0 && ` Amount: ${money(issue.amountPaise)}.`}</li>)}</ul></div>}
      <details><summary>How this is calculated</summary><ul>{result.assumptions.map(a => <li key={a}>{a}</li>)}</ul></details>
    </>}
  </div>;
}
