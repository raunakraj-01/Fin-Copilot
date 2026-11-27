import { t, useLanguage, locale } from '../i18n/index.js';
import React, { useEffect, useState } from 'react';
import { api, json } from '../services/api.js';
import ManualRecords from '../components/ManualRecords.jsx';
import AsyncActionButton from '../components/AsyncActionButton.jsx';
import BankReconciliation from '../components/BankReconciliation.jsx';
import BusinessAccess from '../components/BusinessAccess.jsx';

const fields = ['externalId', 'counterparty', 'amountInr', 'settledInr', 'dueDate', 'expectedDate', 'status',
  'mandatory', 'negotiable', 'discretionary', 'maxExtensionDays', 'earliestCollectionDate',
  'maxEarlyCollectionInr', 'estimatedActionCostInr', 'actionCostDate'];
const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR' }).format(value / 100);
const indiaToday = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export default function SetupImport({ workspaceId, onWorkspaceCreated, businessRole = 'owner' }) {
  useLanguage();
  const [form, setForm] = useState({ name: 'My business', businessGstin: '', asOfDate: indiaToday(), openingCashInr: '', minimumReserveInr: '0' });
  const [openingBalanceConfirmed, setOpeningBalanceConfirmed] = useState('');
  const openingBalanceKey = `${form.asOfDate}:${form.openingCashInr}`;
  const [kind, setKind] = useState('receivables');
  const [file, setFile] = useState(null);
  const [xmlPreview, setXmlPreview] = useState(null);
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
    setOpeningBalanceConfirmed(false);
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
    if (openingBalanceConfirmed !== openingBalanceKey) { setMessage('Confirm the opening balance before saving the cash snapshot.'); return; }
    run('workspace', async () => {
      const { workspace } = await json(`/workspaces/${workspaceId}`, 'PATCH', { name: form.name, ...(form.businessGstin ? { businessGstin: form.businessGstin.toUpperCase() } : {}), asOfDate: form.asOfDate,
        openingCashPaise: Math.round(Number(form.openingCashInr) * 100),
        minimumReservePaise: Math.round(Number(form.minimumReserveInr) * 100) });
      setMessage(`Updated cash snapshot and reserve for ${workspace.name}.`);
      onWorkspaceCreated(workspace);
    });
  }

  function handleFileChange(event) {
    const selected = event.target.files?.[0] || null;
    setFile(selected);
    setXmlPreview(null);
    setBatchId('');
    setRows([]);
    setCorrections({});
    setExcluded([]);
    if (!selected || !selected.name.toLowerCase().endsWith('.xml')) return;
    const reader = new FileReader();
    reader.onload = loadEvent => {
      const content = loadEvent.target?.result;
      if (typeof content !== 'string') return;
      const voucherCount = (content.match(/<VOUCHER\b/gi) || []).length;
      const companyMatch = content.match(/<SVCURRENTCOMPANY>(.*?)<\/SVCURRENTCOMPANY>/i);
      setXmlPreview({
        company: companyMatch ? companyMatch[1].trim() : 'Tally Company',
        voucherCount,
        rawXml: content,
      });
    };
    reader.readAsText(selected);
  }

  function inspect(event) {
    event.preventDefault();
    if (!workspaceId || !file) return;
    if (file.name.toLowerCase().endsWith('.xml')) {
      run('inspect', async () => {
        const rawXml = xmlPreview?.rawXml ?? await file.text();
        const result = await json(`/workspaces/${workspaceId}/automation/tally-xml`, 'POST', { xml: rawXml });
        setFile(null);
        setXmlPreview(null);
        setRefreshKey(value => value + 1);
        setMessage(`Imported ${result.appliedCount} Tally XML voucher(s) from ${result.company}.`);
      });
      return;
    }
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
      if (result.duplicateConflicts?.length) setMessage(`Saved ${result.savedCount} records. Skipped ${result.skippedCount}. Duplicate invoice IDs were preserved; ${result.duplicateConflicts.filter(c => c.changed).length} have changed details. Review the existing records before editing.`);
      setRefreshKey(value => value + 1);
      setBatchId(''); setRows([]);
    });
  }

  return <section className="setup-page">
    <h1>{t("Setup & Import")}</h1>
    <p>{t("Set opening cash and reserve, then add or import records.")}</p>
    <form onSubmit={createWorkspace} className="card form-grid">
      <label>{t("Business name")}<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required /></label>
      <label>Business GSTIN (optional)<input value={form.businessGstin} onChange={event => setForm({ ...form, businessGstin: event.target.value.toUpperCase() })} pattern="[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]" maxLength="15" /></label>
      <label>{t("As-of date")}<input type="date" value={form.asOfDate} onChange={event => { setForm({ ...form, asOfDate: event.target.value }); setOpeningBalanceConfirmed(false); }} required /></label>
      <label className="opening-balance-confirmation"><input type="checkbox" checked={openingBalanceConfirmed === openingBalanceKey} onChange={event => setOpeningBalanceConfirmed(event.target.checked ? openingBalanceKey : '')} required />
        {t('I confirm this opening balance matches the bank balance on the selected as-of date.')}</label>
      <label>{t("Opening cash (₹)")}<input type="number" step="0.01" value={form.openingCashInr} onChange={event => setForm({ ...form, openingCashInr: event.target.value })} required /></label>
      <label>{t("Minimum reserve (₹)")}<input type="number" step="0.01" min="0" value={form.minimumReserveInr} onChange={event => setForm({ ...form, minimumReserveInr: event.target.value })} required /></label>
      <div className="form-actions">
        <button disabled={busy || openingBalanceConfirmed !== openingBalanceKey}>{t("Create new workspace")}</button>
        {workspaceId && <button type="button" className="secondary" disabled={busy || businessRole !== 'owner' || openingBalanceConfirmed !== openingBalanceKey} onClick={updateWorkspace}>{t("Save active workspace")}</button>}
      </div>
    </form>
    <p>{t("CSV templates: ")}<a href="/templates/receivables.csv" download>{t("Receivables")}</a> · <a href="/templates/payables.csv" download>{t("Payables")}</a></p>
    <form onSubmit={inspect} className="card form-grid">
      <h2>{t("Import records")}</h2>
      <p>{t("Upload CSV, Excel (.xlsx), Tally XML (.xml), or JSON (.json) files.")}</p>
      {!workspaceId && <p role="status">{t("Create your business workspace above first, then inspect or import your file.")}</p>}
      {!file?.name?.toLowerCase().endsWith('.xml') && (
        <label>{t("Import type")}<select value={kind} onChange={event => setKind(event.target.value)}><option value="receivables">{t("Receivables")}</option><option value="payables">{t("Payables")}</option></select></label>
      )}
      <label>{t("Import file (CSV, XLSX, XML, or JSON)")}<input type="file" accept=".csv,.xlsx,.xml,.json" onChange={handleFileChange} required /></label>
      {xmlPreview && (
        <div className="xml-preview-box">
          <div className="xml-preview-stat"><span>Company:</span><strong>{xmlPreview.company}</strong></div>
          <div className="xml-preview-stat"><span>Vouchers Detected:</span><strong>{xmlPreview.voucherCount} Vouchers</strong></div>
        </div>
      )}
      <AsyncActionButton
        type="submit"
        disabled={busy || !file || !workspaceId}
        busy={busy && activity === 'inspect'}
        idleLabel={file?.name?.toLowerCase().endsWith('.xml') ? t("Import Tally XML") : t("Inspect file")}
        doneLabel={t("File inspected")}
        steps={[t("Reading the file…"), t("Detecting columns…"), t("Suggesting mappings…")]}
      />
    </form>
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
    {workspaceId && <ManualRecords key={`records-${workspaceId}`} workspaceId={workspaceId} refreshKey={refreshKey} />}
    {workspaceId && <BankReconciliation key={`bank-${workspaceId}`} workspaceId={workspaceId} refreshKey={refreshKey} onChanged={() => setRefreshKey(value => value + 1)} />}
    {workspaceId && businessRole === 'owner' && <BusinessAccess key={`access-${workspaceId}`} workspaceId={workspaceId} />}
    {message && <p role="status" className="notice">{t(message)}</p>}
  </section>;
}
