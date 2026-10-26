import React, { useState } from 'react';
import { CashChart, DailyTable, Metric, Notices, displayDate, rupees, useAnalysis } from './RescuePlanner/DecisionUI.jsx';
import { inputRupees, parseRupees } from './OrderAnalyzer/money.js';

export default function OrderAnalyzer({ workspaceId, apiBaseUrl }) {
  const [form, setForm] = useState({ label: '', orderValue: '', advance: '0', advanceDate: '', finalCollectionDate: '', delayedCollectionDays: '14' });
  const [costLines, setCostLines] = useState([{ description: '', amount: '', paymentDate: '' }]);
  const [inputError, setInputError] = useState('');
  const { result, error, loading, run, clear } = useAnalysis(workspaceId, 'orders', apiBaseUrl);
  function changed() { clear(); setInputError(''); }
  const change = event => { changed(); setForm(current => ({ ...current, [event.target.name]: event.target.value })); };
  const changeCost = (index, field, value) => { changed(); setCostLines(current => current.map((line, position) => position === index ? { ...line, [field]: value } : line)); };
  async function analyze(event) {
    event.preventDefault();
    setInputError('');
    try {
      await run({
        label: form.label || 'Prospective order', orderValuePaise: parseRupees(form.orderValue), advancePaise: parseRupees(form.advance),
        advanceDate: form.advanceDate, finalCollectionDate: form.finalCollectionDate,
        costLines: costLines.map(line => ({ description: line.description || 'Order cost', amountPaise: parseRupees(line.amount), paymentDate: line.paymentDate })),
        delayedCollectionDays: Number(form.delayedCollectionDays),
      });
    } catch (cause) { setInputError(cause.message); }
  }
  const series = result ? [
    { label: 'Current forecast', daily: result.baseline.daily, color: '#94604e' },
    { label: 'Proposed terms', daily: result.withOrder.daily, color: '#176c61' },
    { label: 'Delayed final payment', daily: result.delayedCustomerScenario?.daily, color: '#7761a8' },
    { label: 'Minimum advance terms', daily: result.minimumAdvance.scenario?.daily, color: '#287cbd' },
  ] : [];
  return <main className="decision-page">
    <header><span className="decision-kicker">CashFlow Copilot · Decision support</span><h1>Can this order fit your cash plan?</h1><p className="decision-intro">Enter payment dates and production costs to compare daily cash, test a delayed customer payment, and find the minimum advance needed to preserve your reserve.</p></header>
    {!workspaceId ? <div className="decision-empty">Create or select a workspace first. Your opening cash, reserve, and existing obligations are needed for this analysis.</div> : <form onSubmit={analyze} className="decision-card">
      <fieldset disabled={loading}><div className="decision-form-grid">
        {[
          ['label', 'Order label', 'text'], ['orderValue', 'Order value (₹)', 'text'], ['advance', 'Proposed advance (₹)', 'text'],
          ['advanceDate', 'Advance date', 'date'], ['finalCollectionDate', 'Final collection date', 'date'], ['delayedCollectionDays', 'Delay stress test (days)', 'number'],
        ].map(([name, label, type]) => <label key={name}>{label}<input name={name} type={type} value={form[name]} onChange={change} required={name !== 'label'} inputMode={['orderValue', 'advance'].includes(name) ? 'decimal' : undefined} min={type === 'number' ? 0 : undefined} max={type === 'number' ? 366 : undefined} maxLength={name === 'label' ? 200 : undefined} /></label>)}
      </div>
      <fieldset><legend>Production and material payments</legend>{costLines.map((line, index) => <div className="decision-cost-line" key={index}>
        <label>Payment {index + 1} description<input value={line.description} maxLength={200} onChange={event => changeCost(index, 'description', event.target.value)} placeholder="e.g. Raw materials" /></label>
        <label>Payment {index + 1} amount (₹)<input inputMode="decimal" value={line.amount} onChange={event => changeCost(index, 'amount', event.target.value)} required /></label>
        <label>Payment {index + 1} date<input type="date" value={line.paymentDate} onChange={event => changeCost(index, 'paymentDate', event.target.value)} required /></label>
        <button type="button" className="secondary" aria-label={`Remove payment ${index + 1}`} onClick={() => { changed(); setCostLines(current => current.filter((_, position) => position !== index)); }}>Remove</button>
      </div>)}<button type="button" className="secondary" disabled={costLines.length >= 100} onClick={() => { changed(); setCostLines(current => [...current, { description: '', amount: '', paymentDate: '' }]); }}>Add payment</button></fieldset>
      <p className="decision-muted">Amounts are in rupees; Indian comma formatting is accepted. The advance is part of the total order value. A delay of 0 skips the stress scenario.</p>
      <div className="decision-actions"><button type="submit">{loading ? 'Checking daily cash…' : 'Analyze order'}</button></div></fieldset>
    </form>}
    {(error || inputError) && <p className="decision-error" role="alert">{inputError || error}</p>}
    {loading && <p role="status">Testing cash coverage and the minimum possible advance…</p>}
    {result && <section aria-label="Order analysis results">
      <div className="decision-metrics"><Metric label="Current lowest cash" value={rupees(result.baseline.worstCashPaise)} /><Metric label="Lowest cash with order" value={rupees(result.withOrder.worstCashPaise)} /><Metric label="Largest additional cash requirement" value={rupees(result.withOrder.maxIncrementalCashRequirementPaise)} /></div>
      <article className="decision-card"><span className={`decision-badge${result.minimumAdvance.possible ? '' : ' partial'}`}>{result.minimumAdvance.possible ? 'Conditional cash feasibility' : 'No feasible advance within order value'}</span><h2>{result.minimumAdvance.possible ? `Minimum advance: ${rupees(result.minimumAdvance.amountPaise)}` : 'Advance alone cannot protect the reserve'}</h2>
        <p>{result.minimumAdvance.possible ? `Assumes advance payment on ${displayDate(form.advanceDate)} and the entered final collection date. The delayed-payment scenario uses your proposed advance.` : result.minimumAdvance.message}</p>
        <p>First new reserve breach caused by the order: <strong>{displayDate(result.withOrder.firstNewBreachDate)}</strong>.</p>
        {result.minimumAdvance.possible && <button type="button" className="secondary" onClick={() => { setForm(current => ({ ...current, advance: inputRupees(result.minimumAdvance.amountPaise) })); changed(); }}>Use this advance in the form</button>}
      </article>
      <section className="decision-card"><h2>Daily cash comparison</h2><CashChart series={series} reserve={result.minimumReservePaise} /><DailyTable series={series} />{result.delayedCustomerScenario && <p>With final payment delayed to {displayDate(result.delayedCustomerScenario.finalCollectionDate)}, lowest cash is {rupees(result.delayedCustomerScenario.worstCashPaise)}.</p>}</section>
      <Notices warnings={result.warnings} assumptions={result.assumptions} />
    </section>}
  </main>;
}
