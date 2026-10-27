import React, { useEffect, useRef, useState } from 'react';
import { decisionApiBase, rupees } from './DecisionUI.jsx';
import { useSavedRecords } from './useSavedRecords.js';

function ActionTracker({ action, planId, workspaceId, apiBaseUrl }) {
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
    <p>{action.type.replaceAll('_', ' ')}: {rupees(action.amountPaise)} on {action.toDate}</p>
    <fieldset disabled={feedback.busy}><label>Action status<select value={status} onChange={event => { setStatus(event.target.value); setFeedback({ busy: false, error: '', message: '' }); }}>
      {['proposed', 'requested', 'agreed', 'rejected', 'completed'].map(value => <option key={value} value={value}>{value}</option>)}
    </select></label>
    <label>Owner notes<textarea maxLength={2000} value={notes} onChange={event => { setNotes(event.target.value); setFeedback({ busy: false, error: '', message: '' }); }} /></label>
    <button type="submit">{feedback.busy ? 'Updating action…' : 'Update action'}</button></fieldset>
    {feedback.message && <p role="status">{feedback.message}</p>}{feedback.error && <p role="alert">{feedback.error}</p>}
  </form>;
}

export default function SavedPlans({ workspaceId, apiBaseUrl, reloadKey }) {
  const { records, loading, error, load } = useSavedRecords(workspaceId, apiBaseUrl, 'rescue/plans', 'plans', reloadKey);
  if (!workspaceId) return null;
  return <section className="decision-card" aria-label="Saved rescue plans"><h2>Saved rescue plans</h2>
    <p>Track your latest 50 proposals. Action statuses are owner records; they do not settle invoices or change the forecast. Saved cash figures are snapshots and may be out of date.</p>
    <button type="button" disabled={loading} onClick={load}>{loading ? 'Loading plans…' : 'Load saved plans'}</button>
    {error && <p role="alert">{error}</p>}{records?.length === 0 && <p>No saved plans for this workspace.</p>}
    {records?.map(plan => <article key={plan._id}>
      <h3>Plan from {plan.asOfDate} · {plan.feasibility === 'insufficient' ? 'Shortage remains' : 'Conditional on agreement'}</h3>
      <p>Simulated lowest cash when saved: {rupees(plan.simulatedWorstCashPaise)}</p>
      {plan.actions.map(action => <ActionTracker key={`${plan._id}:${action.actionId}:${plan.updatedAt}`} action={action} planId={plan._id} workspaceId={workspaceId} apiBaseUrl={apiBaseUrl} />)}
    </article>)}
  </section>;
}
