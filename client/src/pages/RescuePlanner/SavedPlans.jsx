import { t, useLanguage } from '../../i18n/index.js';
import React, { useEffect, useRef, useState } from 'react';
import { decisionApiBase, rupees } from './DecisionUI.jsx';
import { useSavedRecords } from './useSavedRecords.js';

function ActionTracker({ action, planId, workspaceId, apiBaseUrl }) {
  useLanguage();
  const [status, setStatus] = useState(action.status);
  const [notes, setNotes] = useState(action.ownerNotes || '');
  const [feedback, setFeedback] = useState({ busy: false, error: '', message: '' });
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), []);
  async function save(event) {
    event.preventDefault();
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setFeedback({ busy: true, error: '', message: '' });
    try {
      const url = `${decisionApiBase(apiBaseUrl)}/workspaces/${encodeURIComponent(workspaceId)}/rescue/plans/${encodeURIComponent(planId)}/actions/${encodeURIComponent(action.actionId)}`;
      const response = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, ownerNotes: notes }), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || 'Could not update action');
      if (!controller.signal.aborted) setFeedback({ busy: false, error: '', message: 'Action updated. Record any actual payment separately in your cash records.' });
    } catch (error) {
      if (!controller.signal.aborted) setFeedback({ busy: false, error: error.message, message: '' });
    }
  }
  return <form onSubmit={save} className="decision-card">
    <p>{t(action.type.replaceAll('_', ' '))}: {t(rupees(action.amountPaise))}{t(" on ")}{action.toDate}</p>
    <p>{t("Estimated fee: ")}{t(action.estimatedCostPaise == null ? 'unknown (excluded)' : rupees(action.estimatedCostPaise))} · {t(action.feeDate || 'Legacy snapshot: reanalyze to include dated fees')}</p>
    <fieldset disabled={feedback.busy}><label>{t("Action status")}<select value={status} onChange={event => { setStatus(event.target.value); setFeedback({ busy: false, error: '', message: '' }); }}>
      {['proposed', 'requested', 'agreed', 'rejected', 'completed'].map(value => <option key={value} value={value}>{t(value)}</option>)}
    </select></label>
    <label>{t("Owner notes")}<textarea maxLength={2000} value={notes} onChange={event => { setNotes(event.target.value); setFeedback({ busy: false, error: '', message: '' }); }} /></label>
    <button type="submit">{t(feedback.busy ? 'Updating action…' : 'Update action')}</button></fieldset>
    {feedback.message && <p role="status">{t(feedback.message)}</p>}{feedback.error && <p role="alert">{t(feedback.error)}</p>}
  </form>;
}

export default function SavedPlans({ workspaceId, apiBaseUrl, reloadKey }) {
  useLanguage();
  const { records, loading, error, load } = useSavedRecords(workspaceId, apiBaseUrl, 'rescue/plans', 'plans', reloadKey);
  if (!workspaceId) return null;
  return <section className="decision-card" aria-label={t("Saved rescue plans")}><h2>{t("Saved rescue plans")}</h2>
    <p>{t("Track your latest 50 proposals. Action statuses are owner records; they do not settle invoices or change the forecast. Saved cash figures are snapshots and may be out of date.")}</p>
    <button type="button" disabled={loading} onClick={load}>{t(loading ? 'Loading plans…' : 'Load saved plans')}</button>
    {error && <p role="alert">{t(error)}</p>}{records?.length === 0 && <p>{t("No saved plans for this workspace.")}</p>}
    {records?.map(plan => <article key={plan._id}>
      <h3>{t("Plan from ")}{plan.asOfDate} · {t(plan.feasibility === 'insufficient' ? 'Shortage remains' : 'Conditional on agreement')}</h3>
      <p>{t("Simulated lowest cash when saved: ")}{t(rupees(plan.simulatedWorstCashPaise))}</p>
      {plan.actions.map(action => <ActionTracker key={`${plan._id}:${action.actionId}:${plan.updatedAt}`} action={action} planId={plan._id} workspaceId={workspaceId} apiBaseUrl={apiBaseUrl} />)}
    </article>)}
  </section>;
}
