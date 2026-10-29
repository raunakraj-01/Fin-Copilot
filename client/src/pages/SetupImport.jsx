import { t, useLanguage, locale } from '../i18n/index.js';
import React, { useEffect, useState } from 'react';
import { api, json } from '../services/api.js';
import ManualRecords from '../components/ManualRecords.jsx';
import AsyncActionButton from '../components/AsyncActionButton.jsx';

const fields = ['externalId', 'counterparty', 'amountInr', 'settledInr', 'dueDate', 'expectedDate', 'status',
  'mandatory', 'negotiable', 'discretionary', 'maxExtensionDays', 'earliestCollectionDate',
  'maxEarlyCollectionInr', 'estimatedActionCostInr', 'actionCostDate'];
const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR' }).format(value / 100);

export default function SetupImport({ workspaceId, onWorkspaceCreated }) {
  useLanguage();
  const [form, setForm] = useState({ name: 'Demo Packaging Supplier', businessGstin: '', asOfDate: '2026-11-01', openingCashInr: '200000', minimumReserveInr: '0' });
  const [kind, setKind] = useState('receivables');
  const [file, setFile] = useState(null);
  const [batchId, setBatchId] = useState('');
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [rows, setRows] = useState([]);
  const [corrections, setCorrections] = useState({});
  const [excluded, setExcluded] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setBatchId(''); setRows([]); setCorrections({}); setExcluded([]);
    api(`/workspaces/${workspaceId}`).then(({ workspace }) => {
      if (active) setForm({ name: workspace.name, businessGstin: workspace.businessGstin || '', asOfDate: workspace.asOfDate,
        openingCashInr: String(workspace.openingCashPaise / 100),
        minimumReserveInr: String(workspace.minimumReservePaise / 100) });
    }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [workspaceId]);

  async function run(name, action) {
    setBusy(true); setActivity(name); setMessage('');
    try { await action(); } catch (error) { setMessage(error.message); }
    finally { setBusy(false); setActivity(''); }
  }

  function createWorkspace(event) {
    event.preventDefault();
    run('workspace', async () => {
      const { workspace } = await json('/workspaces', 'POST', { name: form.name, ...(form.businessGstin ? { businessGstin: form.businessGstin.toUpperCase() } : {}), asOfDate: form.asOfDate,
        openingCashPaise: Math.round(Number(form.openingCashInr) * 100),
        minimumReservePaise: Math.round(Number(form.minimumReserveInr) * 100) });
      onWorkspaceCreated(workspace);
      setMessage(`Workspace created: ${workspace.name}`);
    });
  }

  function updateWorkspace() {
    run('workspace', async () => {
      const { workspace } = await json(`/workspaces/${workspaceId}`, 'PATCH', { name: form.name, ...(form.businessGstin ? { businessGstin: form.businessGstin.toUpperCase() } : {}), asOfDate: form.asOfDate,
        openingCashPaise: Math.round(Number(form.openingCashInr) * 100),
        minimumReservePaise: Math.round(Number(form.minimumReserveInr) * 100) });
      setMessage(`Updated cash snapshot and reserve for ${workspace.name}.`);
      onWorkspaceCreated(workspace);
    });
  }

  function useSeed() {
    run('seed', async () => {
      const id = '650000000000000000000001';
      const { workspace } = await api(`/workspaces/${id}`);
      onWorkspaceCreated(workspace);
      setMessage(`Using seeded workspace: ${workspace.name}`);
    });
  }

  function inspect(event) {
    event.preventDefault();
    run('inspect', async () => {
      const body = new FormData(); body.append('kind', kind); body.append('file', file);
      const result = await api(`/workspaces/${workspaceId}/imports/inspect`, { method: 'POST', body });
      setBatchId(result.batchId); setHeaders(result.headers); setMapping(result.suggestedMapping);
      setRows([]); setCorrections({}); setExcluded([]);
      setMessage(`Inspected ${file.name}. Review the column mapping.`);
    });
  }

  function validateBatch() {
    run('validate', async () => {
      const result = await json(`/workspaces/${workspaceId}/imports/${batchId}/validate`, 'POST', { mapping });
      setRows(result.rows);
      setMessage(`${result.counts.accepted} accepted, ${result.counts.needsReview} need review, ${result.counts.rejected} rejected.`);
    });
  }

  function commitBatch() {
    run('commit', async () => {
      const result = await json(`/workspaces/${workspaceId}/imports/${batchId}/commit`, 'POST', {
        corrections: Object.entries(corrections).map(([rowNumber, values]) => ({ rowNumber: Number(rowNumber), values })),
        excludedRowNumbers: excluded,
      });
      setMessage(`Saved ${result.savedCount} records. Skipped ${result.skippedCount}.`);
      setRefreshKey(value => value + 1);
      setBatchId(''); setRows([]);
    });
  }

  return <section>
    <h1>{t("Setup & Import")}</h1>
    <p>{t("Use synthetic records for this demo. Enter opening cash and reserve in Indian rupees.")}</p>
    <form onSubmit={createWorkspace} className="card form-grid">
      <label>{t("Business name")}<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required /></label>
      <label>Business GSTIN (optional)<input value={form.businessGstin} onChange={event => setForm({ ...form, businessGstin: event.target.value.toUpperCase() })} pattern="[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]" maxLength="15" /></label>
      <label>{t("As-of date")}<input type="date" value={form.asOfDate} onChange={event => setForm({ ...form, asOfDate: event.target.value })} required /></label>
      <label>{t("Opening cash (₹)")}<input type="number" step="0.01" value={form.openingCashInr} onChange={event => setForm({ ...form, openingCashInr: event.target.value })} required /></label>
      <label>{t("Minimum reserve (₹)")}<input type="number" step="0.01" min="0" value={form.minimumReserveInr} onChange={event => setForm({ ...form, minimumReserveInr: event.target.value })} required /></label>
      <div className="form-actions">
        <button disabled={busy}>{t("Create new workspace")}</button>
        {workspaceId && <button type="button" className="secondary" disabled={busy} onClick={updateWorkspace}>{t("Save active workspace")}</button>}
      </div>
    </form>
    <div className="page-actions"><button type="button" className="secondary" disabled={busy} onClick={useSeed}>{t("Use seeded demo workspace")}</button></div>
    {workspaceId && <>
      <p>{t("Active workspace: ")}<code>{workspaceId}</code></p>
      <p>{t("CSV templates: ")}<a href="/templates/receivables.csv" download>{t("Receivables")}</a> · <a href="/templates/payables.csv" download>{t("Payables")}</a></p>
      <form onSubmit={inspect} className="card form-grid">
        <label>{t("Import type")}<select value={kind} onChange={event => setKind(event.target.value)}><option value="receivables">{t("Receivables")}</option><option value="payables">{t("Payables")}</option></select></label>
        <label>{t("CSV or XLSX file")}<input type="file" accept=".csv,.xlsx" onChange={event => setFile(event.target.files[0])} required /></label>
        <AsyncActionButton type="submit" disabled={busy || !file} busy={busy && activity === 'inspect'} idleLabel={t("Inspect file")} doneLabel={t("File inspected")} steps={[t("Reading the file…"), t("Detecting columns…"), t("Suggesting mappings…")]} />
      </form>
    </>}
    {batchId && <div className="card">
      <h2>{t("Column mapping")}</h2>
      <div className="form-grid">{fields.map(field => <label key={field}>{t(field)}
        <select value={mapping[field] || ''} onChange={event => { setMapping({ ...mapping, [field]: event.target.value }); setRows([]); setCorrections({}); }}>
          <option value="">{t("Unmapped")}</option>{headers.map(header => <option key={header} value={header}>{header}</option>)}
        </select></label>)}</div>
      <AsyncActionButton disabled={busy} busy={busy && activity === 'validate'} onClick={validateBatch} idleLabel={t("Validate rows")} doneLabel={t("Review ready")} steps={[t("Validating rows…"), t("Checking dates and amounts…"), t("Flagging uncertain records…")]} />
    </div>}
    {rows.length > 0 && <div className="card">
      <h2>{t("Review rows")}</h2>
      <p>{t("Correct flagged cells or exclude the row before committing. Accepted rows will be saved with entered expected dates.")}</p>
      {rows.map(row => <details key={row.rowNumber} open={row.state !== 'accepted'}>
        <summary>{t("Row ")}{t(row.rowNumber)}: {row.item.externalId || 'No ID'} · {t(row.item.amountPaise === undefined ? 'Invalid amount' : money(row.item.amountPaise))} · {t(row.state)}</summary>
        {row.issues.map(issue => <p className="issue" key={`${issue.field}-${issue.code}`}>{t(issue.field)}: {t(issue.message)}</p>)}
        <label><input type="checkbox" checked={excluded.includes(row.rowNumber)} onChange={event => setExcluded(event.target.checked ? [...excluded, row.rowNumber] : excluded.filter(number => number !== row.rowNumber))} />{t(" Exclude row")}</label>
        <div className="form-grid">{fields.map(field => <label key={field}>{t(field)}{t(!mapping[field] && ' (manual)')}
          <input value={corrections[row.rowNumber]?.[field] ?? row.values[mapping[field]] ?? ''}
            onChange={event => setCorrections({ ...corrections, [row.rowNumber]: { ...corrections[row.rowNumber], [field]: event.target.value } })} />
        </label>)}</div>
      </details>)}
      <AsyncActionButton disabled={busy} busy={busy && activity === 'commit'} onClick={commitBatch} idleLabel={t("Commit reviewed rows")} doneLabel={t("Import complete")} steps={[t("Saving reviewed rows…"), t("Updating cash records…"), t("Refreshing forecast…")]} />
    </div>}
    {workspaceId && <ManualRecords workspaceId={workspaceId} refreshKey={refreshKey} />}
    {message && <p role="status" className="notice">{t(message)}</p>}
  </section>;
}
