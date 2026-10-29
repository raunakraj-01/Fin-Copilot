import { t, useLanguage } from '../../i18n/index.js';
import React, { useEffect, useRef, useState } from 'react';
import { decisionApiBase, rupees, Notices } from '../RescuePlanner/DecisionUI.jsx';
import { useSavedRecords } from '../RescuePlanner/useSavedRecords.js';

export function SaveScenario({ order, workspaceId, apiBaseUrl, onSaved }) {
  useLanguage();
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
  return <div><button type="button" disabled={state.busy || !!state.saved} onClick={save}>{t(state.busy ? 'Saving scenario…' : state.saved ? 'Scenario saved' : 'Save hypothetical scenario')}</button>
    {state.saved && <p role="status">{t("Saved as hypothetical. Recalculated minimum advance: ")}{t(state.saved.simulatedMinimumAdvancePaise == null ? 'no feasible advance' : rupees(state.saved.simulatedMinimumAdvancePaise))}{t(". No accounting entries were posted.")}</p>}
    {state.error && <p role="alert">{t(state.error)}</p>}
  </div>;
}

export default function SavedScenarios({ workspaceId, apiBaseUrl, reloadKey }) {
  useLanguage();
  const { records, loading, error, load } = useSavedRecords(workspaceId, apiBaseUrl, 'orders/scenarios', 'scenarios', reloadKey);
  if (!workspaceId) return null;
  return <section className="decision-card" aria-label={t("Saved order scenarios")}><h2>{t("Saved hypothetical scenarios")}</h2>
    <p>{t("Your latest 50 saved scenarios. Reanalyze against current cash records before making a decision.")}</p>
    <button type="button" disabled={loading} onClick={load}>{t(loading ? 'Loading scenarios…' : 'Load saved scenarios')}</button>
    {error && <p role="alert">{t(error)}</p>}{records?.length === 0 && <p>{t("No saved scenarios for this workspace.")}</p>}
    {records?.map(scenario => <article key={scenario._id}><h3>{scenario.label}{t(" · hypothetical")}</h3>
      <p>{t("Order value: ")}{t(rupees(scenario.orderValuePaise))}{t(". Proposed advance: ")}{t(rupees(scenario.advancePaise))}{t(" on ")}{scenario.advanceDate}{t(". Final collection: ")}{scenario.finalCollectionDate}.</p>
      <p>{t("Minimum advance when saved: ")}{t(scenario.simulatedMinimumAdvancePaise == null ? 'No feasible advance' : rupees(scenario.simulatedMinimumAdvancePaise))}.</p>
      <Notices warnings={scenario.scenarioWarnings} />
    </article>)}
  </section>;
}
