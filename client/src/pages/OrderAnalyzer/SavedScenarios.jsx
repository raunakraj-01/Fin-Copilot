import { sessionFetch } from '../../services/session.js';
import { t, useLanguage } from '../../i18n/index.js';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
      const response = await sessionFetch(`${decisionApiBase(apiBaseUrl)}/workspaces/${encodeURIComponent(workspaceId)}/orders/scenarios`, {
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

function ScenarioRecord({ scenario, workspaceId, apiBaseUrl, onRecalculated, onEdit }) {
  const [state, setState] = useState({ busy: false, error: '', message: '' });
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), []);
  async function recalculate() {
    if (state.busy) return;
    const controller = new AbortController(); active.current = controller;
    setState({ busy: true, error: '', message: '' });
    try {
      const response = await sessionFetch(`${decisionApiBase(apiBaseUrl)}/workspaces/${encodeURIComponent(workspaceId)}/orders/scenarios/${encodeURIComponent(scenario._id)}/recalculate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || 'Could not recalculate scenario');
      if (!payload._id || !payload.freshness) throw new Error('The server returned an incomplete recalculation');
      if (!controller.signal.aborted) {
        onRecalculated(payload);
        setState({ busy: false, error: '', message: payload.freshness.stale ? 'Recalculated, but cash inputs changed again. Refresh before use.' : 'Recalculated and saved using current cash records. No accounting entries were posted.' });
      }
    } catch (error) { if (!controller.signal.aborted) setState({ busy: false, error: error.message, message: '' }); }
  }
  const stale = scenario.freshness?.stale !== false;
  return <article className="decision-card"><h3>{scenario.label}{t(' · hypothetical')}</h3>
    <p className={stale ? 'issue' : 'decision-muted'}><strong>{stale ? 'Outdated analysis — review before use' : 'Analysis matches current recorded inputs'}</strong></p>
    <p>{scenario.freshness?.message || 'This analysis has no freshness information. Reload or recalculate before use.'}</p>
    <p>{t('Order value: ')}{t(rupees(scenario.orderValuePaise))}{t('. Proposed advance: ')}{t(rupees(scenario.advancePaise))}{t(' on ')}{scenario.advanceDate}{t('. Final collection: ')}{scenario.finalCollectionDate}.</p>
    <p>{t('Minimum advance when saved: ')}{t(scenario.simulatedMinimumAdvancePaise == null ? 'No feasible advance' : rupees(scenario.simulatedMinimumAdvancePaise))}{stale ? ' · historical result; recalculate before relying on it.' : ' · conditional on entered data.'}</p>
    {scenario.analyzedAt && <p>Last calculated: {new Date(scenario.analyzedAt).toLocaleString()} · Cash snapshot: {scenario.analysisContext?.asOfDate} · Delay stress test: {scenario.delayedCollectionDays ?? 0} days</p>}
    <div className="decision-actions">
      <button type="button" disabled={state.busy || scenario.freshness?.datesExpired} onClick={recalculate}>{state.busy ? 'Recalculating…' : 'Recalculate with current ledger'}</button>
      {onEdit && <button type="button" className="secondary" disabled={state.busy} onClick={() => onEdit(scenario)}>Edit order inputs</button>}
    </div>
    {state.error && <p role="alert">{state.error}</p>}{state.message && (!stale || state.message.startsWith('Recalculated, but')) && <p role="status">{state.message}</p>}
    <Notices warnings={scenario.scenarioWarnings || []} />
    {scenario.analysisHistory?.length > 0 && <details><summary>Previous calculations</summary><ul>{scenario.analysisHistory.map((h, i) => <li key={i}>{h.analyzedAt ? new Date(h.analyzedAt).toLocaleString() : 'Legacy calculation'} · Minimum advance: {h.minimumAdvancePaise == null ? 'No feasible advance' : rupees(h.minimumAdvancePaise)} · Snapshot {h.analysisContext?.asOfDate || 'not recorded'}</li>)}</ul></details>}
  </article>;
}

export default function SavedScenarios({ workspaceId, apiBaseUrl, reloadKey, onEdit }) {
  useLanguage();
  const { records, loading, error, load, replaceRecord } = useSavedRecords(workspaceId, apiBaseUrl, 'orders/scenarios', 'scenarios', reloadKey);
  const currentLoad = useRef(load); currentLoad.current = load;
  const enabled = useRef(false);
  useLayoutEffect(() => { enabled.current = false; }, [workspaceId]);
  useLayoutEffect(() => { if (records) enabled.current = true; }, [records]);
  useEffect(() => {
    const refresh = () => { if (enabled.current && !document.hidden) currentLoad.current(true); };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [workspaceId]);
  if (!workspaceId) return null;
  return <section className="decision-card" aria-label={t("Saved order scenarios")}><h2>{t("Saved hypothetical scenarios")}</h2>
    <p>Your latest 50 saved scenarios. Freshness checks refresh every 30 seconds while visible and when you return to this window. Recalculation preserves the order terms and records the previous result in history.</p>
    <button type="button" disabled={loading} onClick={load}>{t(loading ? 'Loading scenarios…' : 'Load saved scenarios')}</button>
    {error && <p role="alert">{t(error)}</p>}{records?.length === 0 && <p>{t("No saved scenarios for this workspace.")}</p>}
    {records?.map(scenario => <ScenarioRecord key={`${workspaceId}:${scenario._id}`} scenario={scenario} workspaceId={workspaceId} apiBaseUrl={apiBaseUrl} onRecalculated={replaceRecord} onEdit={onEdit} />)}
  </section>;
}
