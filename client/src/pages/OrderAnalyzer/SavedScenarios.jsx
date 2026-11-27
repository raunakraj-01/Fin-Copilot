import { readJsonSafe, sessionFetch } from '../../services/session.js';
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
      const payload = await readJsonSafe(response);
      if (!response.ok) throw new Error(payload?.error?.message || 'Could not save scenario');
      if (!payload?._id) throw new Error('The server did not confirm a saved scenario');
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

function ScenarioRecord({ scenario, workspaceId, apiBaseUrl, onRecalculated, onTracked, onEdit, businessRole }) {
  const [state, setState] = useState({ busy: false, trackingBusy: false, error: '', message: '' });
  const [trackingStatus, setTrackingStatus] = useState(scenario.trackingStatus || 'prospective');
  const [trackingNote, setTrackingNote] = useState(scenario.trackingNote || '');
  useEffect(() => { setTrackingStatus(scenario.trackingStatus || 'prospective'); setTrackingNote(scenario.trackingNote || ''); }, [scenario.trackingStatus, scenario.trackingNote]);
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), []);
  async function recalculate() {
    if (state.busy || state.trackingBusy) return;
    const controller = new AbortController(); active.current = controller;
    setState({ busy: true, error: '', message: '' });
    try {
      const response = await sessionFetch(`${decisionApiBase(apiBaseUrl)}/workspaces/${encodeURIComponent(workspaceId)}/orders/scenarios/${encodeURIComponent(scenario._id)}/recalculate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal,
      });
      const payload = await readJsonSafe(response);
      if (!response.ok) throw new Error(payload?.error?.message || 'Could not recalculate scenario');
      if (!payload?._id || !payload.freshness) throw new Error('The server returned an incomplete recalculation');
      if (!controller.signal.aborted) {
        onRecalculated(payload);
        setState({ busy: false, error: '', message: payload.freshness.stale ? 'Recalculated, but cash inputs changed again. Refresh before use.' : 'Recalculated and saved using current cash records. No accounting entries were posted.' });
      }
    } catch (error) { if (!controller.signal.aborted) setState({ busy: false, error: error.message, message: '' }); }
  }
  async function saveTracking(event) {
    event.preventDefault();
    if (state.trackingBusy || state.busy) return;
    setState(current => ({ ...current, trackingBusy: true, error: '', message: '' }));
    try {
      const response = await sessionFetch(`${decisionApiBase(apiBaseUrl)}/workspaces/${encodeURIComponent(workspaceId)}/orders/scenarios/${encodeURIComponent(scenario._id)}/tracking`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: trackingStatus, note: trackingNote }),
      });
      const payload = await readJsonSafe(response);
      if (!response.ok) throw new Error(payload?.error?.message || 'Could not update order tracking');
      setTrackingNote(payload.scenario.trackingNote || '');
      setState(current => ({ ...current, trackingBusy: false, message: 'Order progress saved. Cash records remain unchanged.' }));
      onTracked({ ...scenario, ...payload.scenario });
    } catch (error) { setState(current => ({ ...current, trackingBusy: false, error: error.message })); }
  }
  const stale = scenario.freshness?.stale !== false;
  return <article className="decision-card"><h3>{scenario.label}{t(' · hypothetical')}</h3>
    <p className={stale ? 'issue' : 'decision-muted'}><strong>{stale ? 'Outdated analysis — review before use' : 'Analysis matches current recorded inputs'}</strong></p>
    <p>{scenario.freshness?.message || 'This analysis has no freshness information. Reload or recalculate before use.'}</p>
    <p>{t('Order value: ')}{t(rupees(scenario.orderValuePaise))}{t('. Proposed advance: ')}{t(rupees(scenario.advancePaise))}{t(' on ')}{scenario.advanceDate}{t('. Final collection: ')}{scenario.finalCollectionDate}.</p>
    <p>{t('Minimum advance when saved: ')}{t(scenario.simulatedMinimumAdvancePaise == null ? 'No feasible advance' : rupees(scenario.simulatedMinimumAdvancePaise))}{stale ? ' · historical result; recalculate before relying on it.' : ' · conditional on entered data.'}</p>
    {scenario.analyzedAt && <p>Last calculated: {new Date(scenario.analyzedAt).toLocaleString()} · Cash snapshot: {scenario.analysisContext?.asOfDate} · Delay stress test: {scenario.delayedCollectionDays ?? 0} days</p>}
    {businessRole === 'owner' && <form className="order-tracking-form" onSubmit={saveTracking}>
      <label>Order progress<select value={trackingStatus} onChange={event => setTrackingStatus(event.target.value)}>
        <option value="prospective">Prospective</option><option value="terms_requested">Terms requested</option><option value="accepted">Accepted</option>
        <option value="in_production">In production</option><option value="delivered">Delivered</option><option value="awaiting_collection">Awaiting final collection</option>
        <option value="completed">Completed</option><option value="cancelled">Cancelled</option>
      </select></label>
      <label>Progress note<input maxLength="500" value={trackingNote} onChange={event => setTrackingNote(event.target.value)} placeholder="e.g. Customer confirmed advance terms" /></label>
      <button type="submit" className="secondary" disabled={state.trackingBusy || state.busy}>{state.trackingBusy ? 'Saving progress…' : 'Save order progress'}</button>
      <p className="decision-muted">Progress is an owner note for follow-through. It does not record a payment or change the cash forecast.</p>
      {scenario.trackingUpdatedAt && <p className="decision-muted">Updated {new Date(scenario.trackingUpdatedAt).toLocaleString()}{scenario.trackingHistory?.length ? ` · ${scenario.trackingHistory.length} update(s) recorded` : ''}</p>}
    </form>}
    <div className="decision-actions">
      <button type="button" disabled={state.busy || state.trackingBusy || scenario.freshness?.datesExpired} onClick={recalculate}>{state.busy ? 'Recalculating…' : 'Recalculate with current ledger'}</button>
      {onEdit && <button type="button" className="secondary" disabled={state.busy || state.trackingBusy} onClick={() => onEdit(scenario)}>Edit order inputs</button>}
    </div>
    {state.error && <p role="alert">{state.error}</p>}{state.message && <p role="status">{state.message}</p>}
    <Notices warnings={scenario.scenarioWarnings || []} />
    {scenario.analysisHistory?.length > 0 && <details><summary>Previous calculations</summary><ul>{scenario.analysisHistory.map((h, i) => <li key={i}>{h.analyzedAt ? new Date(h.analyzedAt).toLocaleString() : 'Legacy calculation'} · Minimum advance: {h.minimumAdvancePaise == null ? 'No feasible advance' : rupees(h.minimumAdvancePaise)} · Snapshot {h.analysisContext?.asOfDate || 'not recorded'}</li>)}</ul></details>}
  </article>;
}

export default function SavedScenarios({ workspaceId, apiBaseUrl, reloadKey, onEdit, businessRole = 'owner' }) {
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
    {records?.map(scenario => <ScenarioRecord key={`${workspaceId}:${scenario._id}`} scenario={scenario} workspaceId={workspaceId} apiBaseUrl={apiBaseUrl} onRecalculated={replaceRecord} onTracked={replaceRecord} onEdit={onEdit} businessRole={businessRole} />)}
  </section>;
}
