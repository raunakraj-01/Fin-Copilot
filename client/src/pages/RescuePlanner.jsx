import { sessionFetch } from '../services/session.js';
import { t, useLanguage } from '../i18n/index.js';
import React, { useEffect, useRef, useState } from 'react';
import { CashChart, DailyTable, Metric, Notices, decisionApiBase, displayDate, rupees, useAnalysis } from './RescuePlanner/DecisionUI.jsx';
import SavedPlans from './RescuePlanner/SavedPlans.jsx';
import AsyncActionButton from '../components/AsyncActionButton.jsx';
import ParetoFrontier from '../components/ParetoFrontier.jsx';

const actionLabels = { accelerate_collection: 'Request early collection', defer_payable: 'Request supplier extension', delay_expense: 'Postpone discretionary expense' };

export default function RescuePlanner({ workspaceId, apiBaseUrl, onOpenOffer }) {
  useLanguage();
  const [objective, setObjective] = useState('nonnegative');
  const [savedVersion, setSavedVersion] = useState(0);
  const [saveState, setSaveState] = useState({ planId: null, busy: false, message: '', error: '' });
  const saveController = useRef(null);
  const { result, error, loading, run, clear } = useAnalysis(workspaceId, 'rescue', apiBaseUrl);
  const shownPlans = result ? result.plans.length ? result.plans : result.partialMitigations : [];
  useEffect(() => {
    saveController.current?.abort();
    setSaveState({ planId: null, busy: false, message: '', error: '' });
    return () => saveController.current?.abort();
  }, [workspaceId]);
  async function savePlan(plan) {
    saveController.current?.abort();
    const controller = new AbortController();
    saveController.current = controller;
    setSaveState({ planId: plan.planId, busy: true, message: '', error: '' });
    try {
      const response = await sessionFetch(`${decisionApiBase(apiBaseUrl)}/workspaces/${encodeURIComponent(workspaceId)}/rescue/plans`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective, actions: plan.actions }), signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || 'Could not save this plan');
      if (!controller.signal.aborted) {
        setSaveState({ planId: plan.planId, busy: false, message: 'Plan saved as a proposal. Cash records were not changed.', error: '' });
        setSavedVersion(value => value + 1);
      }
    } catch (saveError) {
      if (!controller.signal.aborted) setSaveState({ planId: plan.planId, busy: false, message: '', error: saveError.message || 'Could not save this plan' });
    }
  }
  return <main className="decision-page">
    <header><h1>{t("Build a cash rescue plan")}</h1><p className="decision-intro">{t("Compare earlier collections and flexible payment dates against your reserve.")}</p></header>
    {!workspaceId ? <div className="decision-empty">{t("Create or select a workspace, verify its records, then return to find rescue options.")}</div> : <section className="decision-card"><div className="decision-controls">
      <label>{t("Cash objective")}<select value={objective} disabled={loading} onChange={event => { saveController.current?.abort(); setObjective(event.target.value); clear(); setSaveState({ planId: null, busy: false, message: '', error: '' }); }}><option value="nonnegative">{t("Keep cash at or above zero")}</option><option value="minimum_reserve">{t("Preserve the minimum reserve")}</option></select></label>
      <AsyncActionButton onClick={() => { saveController.current?.abort(); setSaveState({ planId: null, busy: false, message: '', error: '' }); run({ objective, maxCandidates: 12, maxPlans: 3 }); }} disabled={loading} busy={loading} idleLabel={t("Find rescue options")} doneLabel={t("Options ready")} steps={[t("Finding risky options…"), t("Testing collection timing…"), t("Comparing payment deferrals…"), t("Ranking practical plans…")]} />
    </div><p className="decision-muted">{t("Uses only owner-permitted changes to open invoices and payments. Viewing a plan does not change your records.")}</p></section>}
    {error && <p className="decision-error" role="alert">{t(error)}</p>}
    {loading && <p role="status">{t("Checking candidate combinations across every forecast day…")}</p>}
    {result && <section aria-label={t("Rescue analysis results")}>
      <div className="decision-metrics"><Metric label={t("Current lowest cash")} value={rupees(result.baseline.worstCashPaise)} note={displayDate(result.baseline.worstDate)} /><Metric label={t("First negative day")} value={displayDate(result.baseline.firstNegativeDate)} /><Metric label={t("Actions considered")} value={result.candidateCount} note={`${result.evaluatedCombinationCount ?? '—'} combinations evaluated`} /></div>
      {result.message && <p className="decision-notice" role="status">{t(result.message)}</p>}
      {result.rankingRationale && <p className="decision-muted">{t(result.rankingRationale)}</p>}
      {shownPlans.length > 1 && <ParetoFrontier plans={shownPlans} baselineWorstCashPaise={result.baseline.worstCashPaise} reservePaise={result.minimumReservePaise || 0} />}
      {shownPlans.map((plan, index) => {
        const series = [{ label: 'Current forecast', daily: result.baseline.daily, color: '#68747c' }, { label: 'Conditional plan', daily: plan.daily, color: '#275e80' }];
        return <article className="decision-card" key={plan.planId}>
          <span className={`decision-badge${plan.fullyFeasible ? '' : ' partial'}`}>{t(plan.fullyFeasible ? 'Conditional plan · agreement required' : 'Partial mitigation · shortage remains')}</span>
          <h2>{t(plan.fullyFeasible ? 'Plan' : 'Mitigation')} {t(index + 1)}</h2>
          <div className="decision-metrics"><Metric label={t("Lowest cash after actions")} value={rupees(plan.worstCashPaiseAfter)} /><Metric label={t("Known estimated costs")} value={rupees(plan.knownActionCostPaise)} note={plan.containsUnknownCosts ? 'Additional unknown fees are excluded' : 'Deducted on the displayed fee dates'} /></div>
          {plan.partialReason && <p>{t(plan.partialReason)}{t(". Remaining breach: ")}{t(displayDate(plan.firstBreachAfter))}.</p>}
          <ol className="decision-action-list">{plan.actions.map(action => <li key={`${action.cashItemId}-${action.type}`}><strong>{t(actionLabels[action.type])}</strong>{t(" for ")}{action.externalId || action.cashItemId}: {t(rupees(action.amountPaise))}{t(", from ")}{displayDate(action.fromDate)}{t(" to ")}{displayDate(action.toDate)}{t(". Estimated fee: ")}{t(action.estimatedCostPaise == null ? 'unknown (excluded)' : `${rupees(action.estimatedCostPaise)} on ${displayDate(action.feeDate)}`)}{t(". Requires agreement.")}{action.type === 'accelerate_collection' && <button type="button" className="secondary" onClick={() => onOpenOffer?.(action)}>Draft WhatsApp offer</button>}</li>)}</ol>
          <button type="button" disabled={saveState.busy} onClick={() => savePlan(plan)}>{t(saveState.busy && saveState.planId === plan.planId ? 'Saving proposal…' : 'Save proposed plan')}</button>
          {saveState.planId === plan.planId && saveState.message && <p role="status">{t(saveState.message)}</p>}
          {saveState.planId === plan.planId && saveState.error && <p className="decision-error" role="alert">{t(saveState.error)}</p>}
          <CashChart series={series} reserve={result.objective === 'minimum_reserve' ? result.minimumReservePaise ?? 0 : 0} /><DailyTable series={series} /><Notices warnings={plan.warnings} />
        </article>;
      })}
      {!!result.candidates?.length && <details className="decision-details"><summary>{t("All candidate actions and constraints")}</summary><ul>{result.candidates.map(action => <li key={action.cashItemId}>{action.externalId || action.cashItemId}: {t(actionLabels[action.type])}, {t(rupees(action.amountPaise))}{t(" on ")}{displayDate(action.toDate)}{t(". Original expected date: ")}{displayDate(action.fromDate)}.</li>)}</ul></details>}
      <Notices warnings={result.warnings} assumptions={result.assumptions} />
    </section>}
    <SavedPlans key={`${workspaceId}:${apiBaseUrl}`} workspaceId={workspaceId} apiBaseUrl={apiBaseUrl} reloadKey={savedVersion} />
  </main>;
}
