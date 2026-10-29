import { t, useLanguage } from '../i18n/index.js';
import React, { useEffect, useRef, useState } from 'react';
import { CashChart, DailyTable, Metric, Notices, decisionApiBase, displayDate, rupees, useAnalysis } from './RescuePlanner/DecisionUI.jsx';
import AsyncActionButton from '../components/AsyncActionButton.jsx';

const sourceLink = id => `#cash-source-${encodeURIComponent(id)}`;

function Explanations({ workspaceId, apiBaseUrl, report }) {
  useLanguage();
  const [state, setState] = useState({ busy: false, result: null, error: '' });
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), []);
  async function explain(question) {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setState({ busy: true, result: null, error: '' });
    try {
      const response = await fetch(`${decisionApiBase(apiBaseUrl)}/workspaces/${encodeURIComponent(workspaceId)}/shock/explain`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ ...(report.counterparty ? { counterparty: report.counterparty } : {}), delayDays: report.delayDays, question }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || 'Could not explain this result');
      if (!controller.signal.aborted) setState({ busy: false, result, error: '' });
    } catch (error) {
      if (!controller.signal.aborted) setState({ busy: false, result: null, error: error.message });
    }
  }
  return <section className="decision-card" aria-label={t("Evidence-backed explanations")}>
    <span className="decision-kicker">{t("Evidence-backed copilot")}</span><h2>{t("Understand the decision")}</h2>
    <p>{t("Ask about the current records. Every amount comes from the cash engine; AI can select relevant evidence when configured.")}</p>
    <div className="decision-controls">{[['shortage', 'Why is cash short?'], ['collection', 'Which collection helps most?'], ['stress', 'Why does a plan fail under stress?']].map(([id, label]) => <button key={id} disabled={state.busy} onClick={() => explain(id)}>{t(label)}</button>)}</div>
    {state.busy && <p role="status">{t("Preparing a source-backed explanation…")}</p>}
    {state.error && <p role="alert" className="decision-error">{t(state.error)}</p>}
    {state.result && <div role="status"><h3>{t(state.result.question)}</h3><p className="decision-muted">{t(state.result.notice)}</p>
      <ul>{state.result.facts.map(fact => <li key={fact.id}><p>{t(fact.text)}</p>
        {fact.sourceIds.map(id => <a key={id} href={sourceLink(id)} className="shock-source">{state.result.sources.find(source => source.id === id)?.label || id}</a>)}
      </li>)}</ul><Notices warnings={state.result.warnings} /></div>}
  </section>;
}

export default function CashShockLab({ workspaceId, apiBaseUrl }) {
  useLanguage();
  const [customers, setCustomers] = useState([]);
  const [counterparty, setCounterparty] = useState('');
  const [delayDays, setDelayDays] = useState(7);
  const { result, loading, error, run, clear } = useAnalysis(workspaceId, 'shock', apiBaseUrl);
  useEffect(() => {
    setCustomers([]); setCounterparty(''); setDelayDays(7);
    if (workspaceId) run({ delayDays: 7 });
  }, [workspaceId, apiBaseUrl]);
  useEffect(() => {
    if (result) { setCustomers(result.customers); setCounterparty(result.counterparty || ''); }
  }, [result]);
  const series = result ? [{ label: 'Original forecast', daily: result.baseline.daily, color: '#5e83ae' },
    { label: `${result.delayDays}-day customer delay`, daily: result.stressed.daily, color: '#9a5b4b' }] : [];
  return <main className="decision-page">
    <header><span className="decision-kicker">{t("CashFlow Copilot · Stress testing")}</span><h1>{t("Cash Shock Lab")}</h1>
      <p className="decision-intro">{t("Can your cash plan withstand a late customer payment? Test the delay, inspect your rescue plans, and decide which collection to pursue first.")}</p></header>
    {!workspaceId ? <p className="decision-empty">{t("Create or select a workspace in Setup & Import to test its cash plan.")}</p> : <section className="decision-card">
      <div className="decision-controls"><label>{t("Customer")}<select disabled={loading || !customers.length} value={counterparty} onChange={event => { setCounterparty(event.target.value); clear(); }}>
        {!customers.length && <option value="">{t("No dated customer receipts")}</option>}{customers.map(customer => <option key={customer}>{customer}</option>)}
      </select></label><label>{t("Payment delay")}<select value={delayDays} disabled={loading} onChange={event => { setDelayDays(Number(event.target.value)); clear(); }}>
        {[7, 15, 30].map(days => <option key={days} value={days}>{t(days)}{t(" days")}</option>)}</select></label>
        <AsyncActionButton disabled={loading} busy={loading} onClick={() => run({ ...(counterparty ? { counterparty } : {}), delayDays })} idleLabel={t("Run stress test")} doneLabel={t("Stress test ready")} steps={[t("Testing cash resilience…"), t("Rebuilding daily forecast…"), t("Stressing rescue options…"), t("Ranking collection moves…")]} /></div>
      <p className="decision-muted">{t("All dated receipts from this customer move together. Your stored records stay unchanged.")}</p>
    </section>}
    {loading && <p role="status">{t("Calculating the full forecast and checking the top rescue plans…")}</p>}
    {error && <p className="decision-error" role="alert">{t(error)}</p>}
    {result && <>
      <p>{t("Scenario snapshot: ")}<strong>{displayDate(result.asOfDate)}</strong>{t(" through ")}{t(displayDate(result.forecastEndDate))}{t(". Reserve: ")}{t(rupees(result.minimumReservePaise))}.</p>
      <div className="decision-metrics"><Metric label={t("Original peak gap")} value={rupees(result.baseline.peakGapPaise)} note={`${result.baseline.breachDays} days below reserve`} />
        <Metric label={t("Peak gap after delay")} value={rupees(result.stressed.peakGapPaise)} note={`${result.stressed.breachDays} days below reserve`} />
        <Metric label={t("First breach after delay")} value={displayDate(result.stressed.firstReserveBreachDate)} /></div>
      <section className="decision-card"><h2>{t("What changes when payment slips?")}</h2><CashChart series={series} reserve={result.minimumReservePaise} /><DailyTable series={series} />
        {result.movedReceipts.length > 0 && <ul>{result.movedReceipts.map(item => <li key={item.cashItemId}><a href={sourceLink(item.cashItemId)}>{item.externalId || item.cashItemId}</a>: {t(rupees(item.amountPaise))}{t(" moves from ")}{displayDate(item.fromDate)}{t(" to ")}{displayDate(item.toDate)}{t(item.outsideHorizon ? ' — beyond this forecast' : '')}.</li>)}</ul>}
      </section>
      <section aria-label={t("Rescue resilience")}><h2>{t("Does the rescue still work?")}</h2><p>{t("Top baseline plans tested against 7-, 15-, and 30-day delays. Passing a scenario is conditional on its assumptions; it is not a probability.")}</p>
        {!result.plans.length && <p className="decision-notice">{t(result.baseline.peakGapPaise ? 'No improving rescue was found under the entered constraints.' : 'The original forecast needs no rescue. The delayed forecast may still expose a shortage.')}</p>}
        {result.plans.map(plan => {
          const selected = plan.scenarios.find(scenario => scenario.delayDays === result.delayDays);
          const comparison = [{ label: 'Plan before delay', daily: plan.daily, color: '#5e83ae' }, { label: 'Plan after delay', daily: selected.daily, color: '#9a5b4b' }];
          return <article className="decision-card" key={plan.planId}><span className={`decision-badge${selected.passes ? '' : ' partial'}`}>{t(plan.passingScenarios)}{t(" of 3 scenarios pass")}</span><h3>{plan.label}</h3>
            <ul>{plan.actions.map(action => <li key={action.cashItemId}><a href={sourceLink(action.cashItemId)}>{action.externalId || action.cashItemId}</a>: {t(action.type.replaceAll('_', ' '))} · {t(rupees(action.amountPaise))}{t(" on ")}{displayDate(action.toDate)}{t(". Fee ")}{t(action.estimatedCostPaise == null ? 'unknown (excluded)' : `${rupees(action.estimatedCostPaise)} on ${displayDate(action.feeDate)}`)}.</li>)}</ul>
            <div className="decision-table-wrap"><table><caption>{t("Rescue under each customer delay")}</caption><thead><tr><th>{t("Delay")}</th><th>{t("Result")}</th><th>{t("Peak gap")}</th><th>{t("First reserve breach")}</th></tr></thead><tbody>{plan.scenarios.map(scenario => <tr key={scenario.delayDays}><th>{t(scenario.delayDays)}{t(" days")}</th><td>{t(scenario.passes ? 'Conditional pass' : 'Reserve breached')}{t(scenario.receiptsBeyondHorizon > 0 ? ' · receipts beyond horizon' : '')}</td><td>{t(rupees(scenario.peakGapPaise))}</td><td>{t(displayDate(scenario.firstReserveBreachDate))}</td></tr>)}</tbody></table></div>
            <CashChart series={comparison} reserve={result.minimumReservePaise} /><DailyTable series={comparison} />
            <Notices warnings={plan.containsUnknownCosts ? ['Unknown fees are excluded; a conditional pass may change when fees are confirmed.'] : []} />
          </article>;
        })}
      </section>
      <section aria-label={t("Collection priorities")}><h2>{t("Whom should I call first?")}</h2><p>{t("Ranked against the original forecast by shortage days removed, then peak-gap reduction. Each card assumes agreement. Benefits from separate cards cannot be added together.")}</p>
        {!result.priorities.length && <p className="decision-notice">{t("No evaluated early collection improves the original cash position. Check collection limits and dates in Setup.")}</p>}
        {result.priorities.map((action, index) => <article className="decision-card" key={action.cashItemId}><span className="decision-kicker">{t("Priority ")}{t(index + 1)}</span><h3>{action.counterparty}</h3><p><a href={sourceLink(action.cashItemId)}>{action.externalId || action.cashItemId}</a>{t(" · Request ")}{t(rupees(action.amountPaise))}{t(" on ")}{displayDate(action.toDate)}.</p>
          <div className="decision-metrics"><Metric label={t("Shortage days removed")} value={action.breachDaysReduced} /><Metric label={t("Peak gap reduction")} value={rupees(action.peakGapReductionPaise)} /><Metric label={t("Remaining peak gap")} value={rupees(action.remainingGapPaise)} /></div>
          <p>{t("Estimated fee: ")}{t(action.estimatedCostPaise == null ? 'unknown; excluded from this estimate' : `${rupees(action.estimatedCostPaise)} on ${displayDate(action.feeDate)}`)}.</p>
          <details className="decision-details"><summary>{t("Draft collection request")}</summary><p>{t("Hello ")}{action.counterparty}{t(", could you arrange ")}{t(rupees(action.amountPaise))}{t(" against ")}{action.externalId || 'this invoice'}{t(" by ")}{displayDate(action.toDate)}{t("? Please confirm the amount and payment date so we can plan our upcoming commitments. Thank you.")}</p><small>{t("Draft only. Review and send it yourself after confirming the terms.")}</small></details>
        </article>)}
      </section>
      <Explanations workspaceId={workspaceId} apiBaseUrl={apiBaseUrl} report={result} />
      <section className="decision-card"><h2>{t("Source records")}</h2><div className="decision-table-wrap"><table><caption>{t("Records used in this analysis")}</caption><thead><tr><th>{t("Record")}</th><th>{t("Counterparty")}</th><th>{t("Outstanding")}</th><th>{t("Expected date")}</th><th>{t("Evidence")}</th></tr></thead><tbody>{result.sources.map(source => <tr key={source.id} id={`cash-source-${encodeURIComponent(source.id)}`} tabIndex={-1}><th>{source.label}</th><td>{source.counterparty}</td><td>{t(rupees(source.outstandingPaise))}</td><td>{displayDate(source.expectedDate)}</td><td>{t(source.confidenceState.replaceAll('_', ' '))}</td></tr>)}</tbody></table></div></section>
      <Notices warnings={result.warnings} assumptions={result.assumptions} />
    </>}
  </main>;
}
