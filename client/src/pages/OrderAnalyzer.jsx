import { t, useLanguage } from '../i18n/index.js';
import React, { useRef, useState } from 'react';
import { CashChart, DailyTable, Metric, Notices, displayDate, rupees, useAnalysis } from './RescuePlanner/DecisionUI.jsx';
import { inputRupees, parseRupees } from './OrderAnalyzer/money.js';
import SavedScenarios, { SaveScenario } from './OrderAnalyzer/SavedScenarios.jsx';
import AsyncActionButton from '../components/AsyncActionButton.jsx';

export default function OrderAnalyzer({ workspaceId, apiBaseUrl }) {
  useLanguage();
  const [form, setForm] = useState({ label: '', orderValue: '', advance: '0', advanceDate: '', finalCollectionDate: '', delayedCollectionDays: '14' });
  const [costLines, setCostLines] = useState([{ description: '', amount: '', paymentDate: '' }]);
  const [inputError, setInputError] = useState('');
  const [editNotice, setEditNotice] = useState('');
  const formRef = useRef(null);
  const [analyzedOrder, setAnalyzedOrder] = useState(null);
  const [savedVersion, setSavedVersion] = useState(0);
  const { result, error, loading, run, clear } = useAnalysis(workspaceId, 'orders', apiBaseUrl);
  function changed() { clear(); setInputError(''); setEditNotice(''); }
  const change = event => { changed(); setForm(current => ({ ...current, [event.target.name]: event.target.value })); };
  const changeCost = (index, field, value) => { changed(); setCostLines(current => current.map((line, position) => position === index ? { ...line, [field]: value } : line)); };
  function editSaved(scenario) {
    changed(); setAnalyzedOrder(null);
    setForm({ label: scenario.label, orderValue: inputRupees(scenario.orderValuePaise), advance: inputRupees(scenario.advancePaise),
      advanceDate: scenario.advanceDate, finalCollectionDate: scenario.finalCollectionDate, delayedCollectionDays: String(scenario.delayedCollectionDays ?? 0) });
    setCostLines(scenario.costLines.map(line => ({ description: line.description || '', amount: inputRupees(line.amountPaise), paymentDate: line.paymentDate })));
    setEditNotice('Saved order loaded into the form. Review its dates and terms, then analyze again. Saving creates a separate scenario.');
    formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }
  async function analyze(event) {
    event.preventDefault();
    setInputError('');
    try {
      const order = {
        label: form.label || 'Prospective order', orderValuePaise: parseRupees(form.orderValue), advancePaise: parseRupees(form.advance),
        advanceDate: form.advanceDate, finalCollectionDate: form.finalCollectionDate,
        costLines: costLines.map(line => ({ description: line.description || 'Order cost', amountPaise: parseRupees(line.amount), paymentDate: line.paymentDate })),
        delayedCollectionDays: Number(form.delayedCollectionDays),
      };
      setAnalyzedOrder(order);
      await run(order);
    } catch (cause) { setInputError(cause.message); }
  }
  const series = result ? [
    { label: 'Current forecast', daily: result.baseline.daily, color: '#68747c' },
    { label: 'Proposed terms', daily: result.withOrder.daily, color: '#275e80' },
    { label: 'Delayed final payment', daily: result.delayedCustomerScenario?.daily, color: '#a45143' },
    { label: 'Minimum advance terms', daily: result.minimumAdvance.scenario?.daily, color: '#4b7768' },
  ] : [];
  return <main className="decision-page">
    <header><h1>{t("Can this order fit your cash plan?")}</h1><p className="decision-intro">{t("Compare production costs, payment timing, and the required advance against your reserve.")}</p></header>
    {!workspaceId ? <div className="decision-empty">{t("Create or select a workspace first. Your opening cash, reserve, and existing obligations are needed for this analysis.")}</div> : <form ref={formRef} onSubmit={analyze} className="decision-card">
      <fieldset disabled={loading}><div className="decision-form-grid">
        {[
          ['label', 'Order label', 'text'], ['orderValue', 'Order value (₹)', 'text'], ['advance', 'Proposed advance (₹)', 'text'],
          ['advanceDate', 'Advance date', 'date'], ['finalCollectionDate', 'Final collection date', 'date'], ['delayedCollectionDays', 'Delay stress test (days)', 'number'],
        ].map(([name, label, type]) => <label key={name}>{t(label)}<input name={name} type={type} value={form[name]} onChange={change} required={name !== 'label'} inputMode={['orderValue', 'advance'].includes(name) ? 'decimal' : undefined} min={type === 'number' ? 0 : undefined} max={type === 'number' ? 366 : undefined} maxLength={name === 'label' ? 200 : undefined} /></label>)}
      </div>
      <fieldset><legend>{t("Production and material payments")}</legend>{costLines.map((line, index) => <div className="decision-cost-line" key={index}>
        <label>{t("Payment ")}{t(index + 1)}{t(" description")}<input value={line.description} maxLength={200} onChange={event => changeCost(index, 'description', event.target.value)} placeholder={t("e.g. Raw materials")} /></label>
        <label>{t("Payment ")}{t(index + 1)}{t(" amount (₹)")}<input inputMode="decimal" value={line.amount} onChange={event => changeCost(index, 'amount', event.target.value)} required /></label>
        <label>{t("Payment ")}{t(index + 1)}{t(" date")}<input type="date" value={line.paymentDate} onChange={event => changeCost(index, 'paymentDate', event.target.value)} required /></label>
        <button type="button" className="secondary" aria-label={`Remove payment ${index + 1}`} onClick={() => { changed(); setCostLines(current => current.filter((_, position) => position !== index)); }}>{t("Remove")}</button>
      </div>)}<button type="button" className="secondary" disabled={costLines.length >= 100} onClick={() => { changed(); setCostLines(current => [...current, { description: '', amount: '', paymentDate: '' }]); }}>{t("Add payment")}</button></fieldset>
      <p className="decision-muted">{t("Amounts are in rupees; Indian comma formatting is accepted. The advance is part of the total order value. A delay of 0 skips the stress scenario.")}</p>
      <div className="decision-actions"><AsyncActionButton type="submit" busy={loading} idleLabel={t("Analyze order")} doneLabel={t("Analysis ready")} steps={[t("Checking daily cash…"), t("Adding production payments…"), t("Stressing customer delay…"), t("Finding minimum advance…")]} /></div></fieldset>
    </form>}
    {(error || inputError) && <p className="decision-error" role="alert">{t(inputError || error)}</p>}
    {editNotice && <p role="status">{editNotice}</p>}
    {loading && <p role="status">{t("Testing cash coverage and the minimum possible advance…")}</p>}
    {result && <section aria-label={t("Order analysis results")}>
      <div className="decision-metrics"><Metric label={t("Current lowest cash")} value={rupees(result.baseline.worstCashPaise)} /><Metric label={t("Lowest cash with order")} value={rupees(result.withOrder.worstCashPaise)} /><Metric label={t("Largest additional cash requirement")} value={rupees(result.withOrder.maxIncrementalCashRequirementPaise)} /></div>
      <article className="decision-card"><span className={`decision-badge${result.minimumAdvance.possible ? '' : ' partial'}`}>{t(result.minimumAdvance.possible ? 'Conditional cash feasibility' : 'No feasible advance within order value')}</span><h2>{t(result.minimumAdvance.possible ? `Minimum advance: ${rupees(result.minimumAdvance.amountPaise)}` : 'Advance alone cannot protect the reserve')}</h2>
        <p>{result.minimumAdvance.possible ? `Assumes advance payment on ${displayDate(form.advanceDate)} and the entered final collection date. The delayed-payment scenario uses your proposed advance.` : result.minimumAdvance.message}</p>
        <p>{t("First new reserve breach caused by the order: ")}<strong>{t(displayDate(result.withOrder.firstNewBreachDate))}</strong>.</p>
        {result.minimumAdvance.possible && <button type="button" className="secondary" onClick={() => { setForm(current => ({ ...current, advance: inputRupees(result.minimumAdvance.amountPaise) })); changed(); }}>{t("Use this advance in the form")}</button>}
      </article>
      <section className="decision-card"><h2>{t("Daily cash comparison")}</h2><CashChart series={series} reserve={result.minimumReservePaise} /><DailyTable series={series} />{result.delayedCustomerScenario && <p>{t("With final payment delayed to ")}{displayDate(result.delayedCustomerScenario.finalCollectionDate)}{t(", lowest cash is ")}{t(rupees(result.delayedCustomerScenario.worstCashPaise))}.</p>}</section>
      {result.negotiationEnvelope?.length > 0 && <section className="decision-card" aria-label={t("Negotiation terms envelope")}>
        <span className="decision-kicker">{t("Contract strategy")}</span>
        <h2>{t("Negotiation Envelope (What terms should I offer?)")}</h2>
        <p className="decision-muted">{t("Explore combinations of customer advance and payment timing. Highlighted rows preserve your minimum reserve.")}</p>
        <div className="table-scroll"><table className="decision-table">
          <thead><tr><th>{t("Advance %")}</th><th>{t("Advance Amount")}</th><th>{t("Payment Delay")}</th><th>{t("Final Date")}</th><th>{t("Reserve Status")}</th><th>{t("Worst Cash")}</th><th>{t("Action")}</th></tr></thead>
          <tbody>{result.negotiationEnvelope.map((opt, idx) => <tr key={idx}>
            <td><strong>{opt.advancePct}%</strong>{opt.isMinimumAdvance ? ` (${t("Min")})` : ''}</td>
            <td>{t(rupees(opt.advancePaise))}</td>
            <td>{opt.delayDays === 0 ? t("On time") : `+${opt.delayDays} ${t("days")}`}</td>
            <td>{displayDate(opt.finalCollectionDate)}</td>
            <td><span className={`decision-badge${opt.preservesReserve ? '' : ' partial'}`}>{t(opt.preservesReserve ? 'Preserves reserve' : 'Reserve breached')}</span></td>
            <td>{t(rupees(opt.worstCashPaise))}</td>
            <td><button type="button" className="secondary" onClick={() => { setForm(current => ({ ...current, advance: inputRupees(opt.advancePaise), delayedCollectionDays: String(opt.delayDays) })); changed(); }}>{t("Apply")}</button></td>
          </tr>)}</tbody>
        </table></div>
      </section>}
      <Notices warnings={result.warnings} assumptions={result.assumptions} />
      <SaveScenario key={`${workspaceId}:${apiBaseUrl}`} order={analyzedOrder} workspaceId={workspaceId} apiBaseUrl={apiBaseUrl} onSaved={() => setSavedVersion(value => value + 1)} />
    </section>}
    <SavedScenarios key={`${workspaceId}:${apiBaseUrl}`} workspaceId={workspaceId} apiBaseUrl={apiBaseUrl} reloadKey={savedVersion} onEdit={editSaved} />
  </main>;
}
