import React, { useEffect, useRef, useState } from 'react';
import { decisionApiBase, rupees, Notices } from '../RescuePlanner/DecisionUI.jsx';
import { useSavedRecords } from '../RescuePlanner/useSavedRecords.js';

export function SaveScenario({ order, workspaceId, apiBaseUrl, onSaved }) {
  const [state, setState] = useState({ busy: false, saved: null, error: '' });
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), []);
  async function save() {
    const controller = new AbortController(); active.current = controller;
    setState({ busy: true, saved: null, error: '' });
    try {
      const response = await fetch(`${decisionApiBase(apiBaseUrl)}/workspaces/${encodeURIComponent(workspaceId)}/orders/scenarios`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order), signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || 'Could not save scenario');
      if (!payload._id) throw new Error('The server did not confirm a saved scenario');
      if (!controller.signal.aborted) { setState({ busy: false, saved: payload, error: '' }); onSaved(); }
    } catch (error) {
      if (!controller.signal.aborted) setState({ busy: false, saved: null, error: error.message });
    }
  }
  return <div><button type="button" disabled={state.busy || !!state.saved} onClick={save}>{state.busy ? 'Saving scenario…' : state.saved ? 'Scenario saved' : 'Save hypothetical scenario'}</button>
    {state.saved && <p role="status">Saved as hypothetical. Recalculated minimum advance: {state.saved.simulatedMinimumAdvancePaise == null ? 'no feasible advance' : rupees(state.saved.simulatedMinimumAdvancePaise)}. No accounting entries were posted.</p>}
    {state.error && <p role="alert">{state.error}</p>}
  </div>;
}

export default function SavedScenarios({ workspaceId, apiBaseUrl, reloadKey }) {
  const { records, loading, error, load } = useSavedRecords(workspaceId, apiBaseUrl, 'orders/scenarios', 'scenarios', reloadKey);
  if (!workspaceId) return null;
  return <section className="decision-card" aria-label="Saved order scenarios"><h2>Saved hypothetical scenarios</h2>
    <p>Your latest 50 saved scenarios. Reanalyze against current cash records before making a decision.</p>
    <button type="button" disabled={loading} onClick={load}>{loading ? 'Loading scenarios…' : 'Load saved scenarios'}</button>
    {error && <p role="alert">{error}</p>}{records?.length === 0 && <p>No saved scenarios for this workspace.</p>}
    {records?.map(scenario => <article key={scenario._id}><h3>{scenario.label} · hypothetical</h3>
      <p>Order value: {rupees(scenario.orderValuePaise)}. Proposed advance: {rupees(scenario.advancePaise)} on {scenario.advanceDate}. Final collection: {scenario.finalCollectionDate}.</p>
      <p>Minimum advance when saved: {scenario.simulatedMinimumAdvancePaise == null ? 'No feasible advance' : rupees(scenario.simulatedMinimumAdvancePaise)}.</p>
      <Notices warnings={scenario.scenarioWarnings} />
    </article>)}
  </section>;
}
