import React, { useState } from 'react';
import { CashChart, DailyTable, Metric, Notices, displayDate, rupees, useAnalysis } from './RescuePlanner/DecisionUI.jsx';

const actionLabels = { accelerate_collection: 'Request early collection', defer_payable: 'Request supplier extension', delay_expense: 'Postpone discretionary expense' };

export default function RescuePlanner({ workspaceId, apiBaseUrl }) {
  const [objective, setObjective] = useState('nonnegative');
  const { result, error, loading, run, clear } = useAnalysis(workspaceId, 'rescue', apiBaseUrl);
  const shownPlans = result ? result.plans.length ? result.plans : result.partialMitigations : [];
  return <main className="decision-page">
    <header><span className="decision-kicker">CashFlow Copilot · Decision support</span><h1>Build a cash rescue plan</h1><p className="decision-intro">Explore earlier customer collections and flexible payment dates. Every option is checked across the entire cash forecast and remains conditional on agreement.</p></header>
    {!workspaceId ? <div className="decision-empty">Create or select a workspace, verify its records, then return to find rescue options.</div> : <section className="decision-card"><div className="decision-controls">
      <label>Cash objective<select value={objective} disabled={loading} onChange={event => { setObjective(event.target.value); clear(); }}><option value="nonnegative">Keep cash at or above zero</option><option value="minimum_reserve">Preserve the minimum reserve</option></select></label>
      <button onClick={() => run({ objective, maxCandidates: 12, maxPlans: 3 })} disabled={loading}>{loading ? 'Testing possible plans…' : 'Find rescue options'}</button>
    </div><p className="decision-muted">Uses only owner-permitted changes to open invoices and payments. Viewing a plan does not change your records.</p></section>}
    {error && <p className="decision-error" role="alert">{error}</p>}
    {loading && <p role="status">Checking candidate combinations across every forecast day…</p>}
    {result && <section aria-label="Rescue analysis results">
      <div className="decision-metrics"><Metric label="Current lowest cash" value={rupees(result.baseline.worstCashPaise)} note={displayDate(result.baseline.worstDate)} /><Metric label="First negative day" value={displayDate(result.baseline.firstNegativeDate)} /><Metric label="Actions considered" value={result.candidateCount} note={`${result.evaluatedCombinationCount ?? '—'} combinations evaluated`} /></div>
      {result.message && <p className="decision-notice" role="status">{result.message}</p>}
      {result.rankingRationale && <p className="decision-muted">{result.rankingRationale}</p>}
      {shownPlans.map((plan, index) => {
        const series = [{ label: 'Current forecast', daily: result.baseline.daily, color: '#94604e' }, { label: 'Conditional plan', daily: plan.daily, color: '#176c61' }];
        return <article className="decision-card" key={plan.planId}>
          <span className={`decision-badge${plan.fullyFeasible ? '' : ' partial'}`}>{plan.fullyFeasible ? 'Conditional plan · agreement required' : 'Partial mitigation · shortage remains'}</span>
          <h2>{plan.fullyFeasible ? 'Plan' : 'Mitigation'} {index + 1}</h2>
          <div className="decision-metrics"><Metric label="Lowest cash after actions" value={rupees(plan.worstCashPaiseAfter)} /><Metric label="Known estimated costs" value={rupees(plan.knownActionCostPaise)} note={plan.containsUnknownCosts ? 'Additional costs are unknown' : 'Fee payment dates are not modeled'} /></div>
          {plan.partialReason && <p>{plan.partialReason}. Remaining breach: {displayDate(plan.firstBreachAfter)}.</p>}
          <ol className="decision-action-list">{plan.actions.map(action => <li key={`${action.cashItemId}-${action.type}`}><strong>{actionLabels[action.type]}</strong> for {action.externalId || action.cashItemId}: {rupees(action.amountPaise)}, from {displayDate(action.fromDate)} to {displayDate(action.toDate)}. Estimated cost: {action.estimatedCostPaise == null ? 'unknown' : rupees(action.estimatedCostPaise)}. Requires agreement.</li>)}</ol>
          <CashChart series={series} reserve={result.objective === 'minimum_reserve' ? result.minimumReservePaise ?? 0 : 0} /><DailyTable series={series} /><Notices warnings={plan.warnings} />
        </article>;
      })}
      {!!result.candidates?.length && <details className="decision-details"><summary>All candidate actions and constraints</summary><ul>{result.candidates.map(action => <li key={action.cashItemId}>{action.externalId || action.cashItemId}: {actionLabels[action.type]}, {rupees(action.amountPaise)} on {displayDate(action.toDate)}. Original expected date: {displayDate(action.fromDate)}.</li>)}</ul></details>}
      <Notices warnings={result.warnings} assumptions={result.assumptions} />
    </section>}
  </main>;
}
