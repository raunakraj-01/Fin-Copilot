import { sessionFetch } from '../../services/session.js';
import { t, useLanguage } from '../../i18n/index.js';
import React, { useEffect, useRef, useState } from 'react';
import { decisionApiBase, rupees } from './DecisionUI.jsx';
import { useSavedRecords } from './useSavedRecords.js';

function ActionTracker({ action, outcome, planId, workspaceId, apiBaseUrl, onUpdated }) {
  useLanguage();
  const [status, setStatus] = useState(action.status);
  const [notes, setNotes] = useState(action.ownerNotes || '');
  const [promiseId, setPromiseId] = useState(action.promiseId || '');
  const [feedback, setFeedback] = useState({ busy: false, error: '', message: '' });
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => { setStatus(action.status); setNotes(action.ownerNotes || ''); setPromiseId(action.promiseId || ''); }, [action.status, action.ownerNotes, action.promiseId]);
  async function save(event) {
    event.preventDefault();
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setFeedback({ busy: true, error: '', message: '' });
    try {
      const url = `${decisionApiBase(apiBaseUrl)}/workspaces/${encodeURIComponent(workspaceId)}/rescue/plans/${encodeURIComponent(planId)}/actions/${encodeURIComponent(action.actionId)}`;
      const response = await sessionFetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, ownerNotes: notes,
        ...(promiseId !== (action.promiseId || '') ? { promiseId: promiseId || null } : {}) }), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || 'Could not update action');
      if (!controller.signal.aborted) {
        setFeedback({ busy: false, error: '', message: 'Action updated. Current plan forecast recalculated. Record actual payments in cash records or Payment promises.' });
        onUpdated?.(payload);
      }
    } catch (error) {
      if (!controller.signal.aborted) setFeedback({ busy: false, error: error.message, message: '' });
    }
  }
  return <form onSubmit={save} className="decision-card">
    <p>{outcome?.sourceLabel && `${outcome.sourceLabel} · `}{t(action.type.replaceAll('_', ' '))}: {t(rupees(action.amountPaise))}{t(" on ")}{action.toDate}</p>
    <p>{t("Estimated fee: ")}{t(action.estimatedCostPaise == null ? 'unknown (excluded)' : rupees(action.estimatedCostPaise))} · {t(action.feeDate || 'Legacy snapshot: reanalyze to include dated fees')}</p>
    <fieldset disabled={feedback.busy}><label>{t("Action status")}<select value={status} onChange={event => { setStatus(event.target.value); setFeedback({ busy: false, error: '', message: '' }); }}>
      {['proposed', 'requested', 'agreed', 'rejected', 'completed'].map(value => <option key={value} value={value}>{t(value)}</option>)}
    </select></label>
    {action.type === 'accelerate_collection' && outcome?.availablePromises?.length > 0 && <label>Linked payment promise<select value={promiseId} onChange={e => setPromiseId(e.target.value)}>
      <option value="">No linked promise</option>{outcome.availablePromises.map(p => <option key={p.id} value={p.id}>{rupees(p.amountPaise)} by {p.promisedDate} · {p.status}</option>)}
    </select></label>}
    <label>{t("Owner notes")}<textarea maxLength={2000} value={notes} onChange={event => { setNotes(event.target.value); setFeedback({ busy: false, error: '', message: '' }); }} /></label>
    <button type="submit">{t(feedback.busy ? 'Updating action…' : 'Update action')}</button></fieldset>
    {feedback.message && <p role="status">{t(feedback.message)}</p>}{feedback.error && <p role="alert">{t(feedback.error)}</p>}
    {outcome && <div><p>Current outcome: {outcome.status.replaceAll('_', ' ')} · Remaining action amount: {rupees(outcome.remainingActionPaise)} · New invoice settlements: {rupees(outcome.observedSettlementPaise)}</p>
      {outcome.messages.map((message, i) => <p key={i}>{message}</p>)}</div>}
    {action.history?.length > 0 && <details><summary>Action history</summary><ul>{action.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString()} · {h.fromStatus} → {h.toStatus} · {h.ownerNotes}</li>)}</ul></details>}
  </form>;
}

export default function SavedPlans({ workspaceId, apiBaseUrl, reloadKey }) {
  useLanguage();
  const { records, loading, error, load, replaceRecord } = useSavedRecords(workspaceId, apiBaseUrl, 'rescue/plans', 'plans', reloadKey);
  const currentLoad = useRef(load); currentLoad.current = load;
  const enabled = useRef(false);
  useEffect(() => { enabled.current = false; }, [workspaceId]);
  useEffect(() => { if (records) enabled.current = true; }, [records]);
  useEffect(() => {
    const refresh = () => { if (enabled.current && !document.hidden) currentLoad.current(true); };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [workspaceId]);
  if (!workspaceId) return null;
  return <section className="decision-card" aria-label={t("Saved rescue plans")}><h2>{t("Saved rescue plans")}</h2>
    <p>Current projections recalculate from your ledger, payment promises and action outcomes. Loaded plans refresh every 30 seconds and when you return to this window. Each plan is evaluated separately; forecasts remain conditional.</p>
    <button type="button" disabled={loading} onClick={load}>{t(loading ? 'Loading plans…' : 'Load saved plans')}</button>
    {error && <p role="alert">{t(error)}</p>}{records?.length === 0 && <p>{t("No saved plans for this workspace.")}</p>}
    {records?.map(plan => <article key={plan._id}>
      <h3>{t("Plan from ")}{plan.asOfDate} · {t(plan.feasibility === 'insufficient' ? 'Shortage remains' : 'Conditional on agreement')}</h3>
      <p>{t("Simulated lowest cash when saved: ")}{t(rupees(plan.simulatedWorstCashPaise))}</p>
      {plan.live && <div className="decision-card"><h4>Current plan projection · {plan.live.status.replaceAll('_', ' ')}</h4>
        <p>As of {plan.live.evaluatedAsOfDate} through {plan.live.horizonEnd} · Current records lowest cash: {rupees(plan.live.baseline.minimumCashPaise)} · With agreed actions: {rupees(plan.live.current.minimumCashPaise)}</p>
        <p>First reserve breach: {plan.live.current.firstReserveBreachDate || 'None'} · Remaining cash gap: {rupees(plan.live.current.gapPaise)}</p>
        <p>Cash objective: {plan.live.objective === 'minimum_reserve' ? `maintain ${rupees(plan.live.minimumReservePaise)} reserve` : 'stay at or above zero'}. Action status changes do not settle cash records.</p>
        {plan.live.signals.length > 0 && <ul>{plan.live.signals.map((s, i) => <li key={i}>{s.type.replaceAll('_', ' ')}{s.amountPaise != null && ` · ${rupees(s.amountPaise)}`}{s.date && ` · ${s.date}`}</li>)}</ul>}
        {plan.live.affectedPayments.length > 0 && <div><h4>Payments still exposed</h4><ul>{plan.live.affectedPayments.map((p, i) => <li key={i}>{p.date} · {p.label} · {rupees(p.amountPaise)} · Gap {rupees(p.gapPaise)}</li>)}</ul></div>}
        {plan.live.warnings.length > 0 && <ul>{plan.live.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      </div>}
      {plan.actions.map(action => <ActionTracker key={`${plan._id}:${action.actionId}`} action={action} outcome={plan.live?.actions.find(a => a.actionId === action.actionId)} planId={plan._id} workspaceId={workspaceId} apiBaseUrl={apiBaseUrl}
        onUpdated={replaceRecord} />)}
    </article>)}
  </section>;
}
