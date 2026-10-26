import { useState } from 'react';
import { api, json } from '../services/api.js';

const fields = ['externalId', 'counterparty', 'amountInr', 'settledInr', 'dueDate', 'expectedDate', 'status',
  'mandatory', 'negotiable', 'discretionary', 'maxExtensionDays', 'earliestCollectionDate',
  'maxEarlyCollectionInr', 'estimatedActionCostInr'];
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100);

export default function SetupImport({ workspaceId, onWorkspaceCreated }) {
  const [form, setForm] = useState({ name: 'Demo Packaging Supplier', asOfDate: '2026-11-01', openingCashInr: '200000', minimumReserveInr: '0' });
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

  async function run(action) {
    setBusy(true); setMessage('');
    try { await action(); } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  function createWorkspace(event) {
    event.preventDefault();
    run(async () => {
      const { workspace } = await json('/workspaces', 'POST', { name: form.name, asOfDate: form.asOfDate,
        openingCashPaise: Math.round(Number(form.openingCashInr) * 100),
        minimumReservePaise: Math.round(Number(form.minimumReserveInr) * 100) });
      onWorkspaceCreated(workspace.id);
      setMessage(`Workspace created: ${workspace.name}`);
    });
  }

  function useSeed() {
    run(async () => {
      const id = '650000000000000000000001';
      const { workspace } = await api(`/workspaces/${id}`);
      onWorkspaceCreated(workspace.id);
      setMessage(`Using seeded workspace: ${workspace.name}`);
    });
  }

  function inspect(event) {
    event.preventDefault();
    run(async () => {
      const body = new FormData(); body.append('kind', kind); body.append('file', file);
      const result = await api(`/workspaces/${workspaceId}/imports/inspect`, { method: 'POST', body });
      setBatchId(result.batchId); setHeaders(result.headers); setMapping(result.suggestedMapping);
      setRows([]); setCorrections({}); setExcluded([]);
      setMessage(`Inspected ${file.name}. Review the column mapping.`);
    });
  }

  function validateBatch() {
    run(async () => {
      const result = await json(`/workspaces/${workspaceId}/imports/${batchId}/validate`, 'POST', { mapping });
      setRows(result.rows);
      setMessage(`${result.counts.accepted} accepted, ${result.counts.needsReview} need review, ${result.counts.rejected} rejected.`);
    });
  }

  function commitBatch() {
    run(async () => {
      const result = await json(`/workspaces/${workspaceId}/imports/${batchId}/commit`, 'POST', {
        corrections: Object.entries(corrections).map(([rowNumber, values]) => ({ rowNumber: Number(rowNumber), values })),
        excludedRowNumbers: excluded,
      });
      setMessage(`Saved ${result.savedCount} records. Skipped ${result.skippedCount}.`);
      setBatchId(''); setRows([]);
    });
  }

  return <section>
    <h1>Setup & Import</h1>
    <p>Use synthetic records for this demo. Enter opening cash and reserve in Indian rupees.</p>
    <form onSubmit={createWorkspace} className="card form-grid">
      <label>Business name<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required /></label>
      <label>As-of date<input type="date" value={form.asOfDate} onChange={event => setForm({ ...form, asOfDate: event.target.value })} required /></label>
      <label>Opening cash (₹)<input type="number" step="0.01" value={form.openingCashInr} onChange={event => setForm({ ...form, openingCashInr: event.target.value })} required /></label>
      <label>Minimum reserve (₹)<input type="number" step="0.01" min="0" value={form.minimumReserveInr} onChange={event => setForm({ ...form, minimumReserveInr: event.target.value })} required /></label>
      <button disabled={busy}>Create workspace</button>
    </form>
    <button type="button" disabled={busy} onClick={useSeed}>Use seeded demo workspace</button>
    {workspaceId && <>
      <p>Active workspace: <code>{workspaceId}</code></p>
      <form onSubmit={inspect} className="card form-grid">
        <label>Import type<select value={kind} onChange={event => setKind(event.target.value)}><option value="receivables">Receivables</option><option value="payables">Payables</option></select></label>
        <label>CSV or XLSX file<input type="file" accept=".csv,.xlsx" onChange={event => setFile(event.target.files[0])} required /></label>
        <button disabled={busy || !file}>Inspect file</button>
      </form>
    </>}
    {batchId && <div className="card">
      <h2>Column mapping</h2>
      <div className="form-grid">{fields.map(field => <label key={field}>{field}
        <select value={mapping[field] || ''} onChange={event => { setMapping({ ...mapping, [field]: event.target.value }); setRows([]); }}>
          <option value="">Unmapped</option>{headers.map(header => <option key={header} value={header}>{header}</option>)}
        </select></label>)}</div>
      <button disabled={busy} onClick={validateBatch}>Validate rows</button>
    </div>}
    {rows.length > 0 && <div className="card">
      <h2>Review rows</h2>
      <p>Correct flagged cells or exclude the row before committing. Accepted rows will be saved with entered expected dates.</p>
      {rows.map(row => <details key={row.rowNumber} open={row.state !== 'accepted'}>
        <summary>Row {row.rowNumber}: {row.item.externalId || 'No ID'} · {row.item.amountPaise === undefined ? 'Invalid amount' : money(row.item.amountPaise)} · {row.state}</summary>
        {row.issues.map(issue => <p className="issue" key={`${issue.field}-${issue.code}`}>{issue.field}: {issue.message}</p>)}
        <label><input type="checkbox" checked={excluded.includes(row.rowNumber)} onChange={event => setExcluded(event.target.checked ? [...excluded, row.rowNumber] : excluded.filter(number => number !== row.rowNumber))} /> Exclude row</label>
        <div className="form-grid">{fields.filter(field => mapping[field]).map(field => <label key={field}>{field}
          <input value={corrections[row.rowNumber]?.[mapping[field]] ?? row.values[mapping[field]] ?? ''}
            onChange={event => setCorrections({ ...corrections, [row.rowNumber]: { ...corrections[row.rowNumber], [mapping[field]]: event.target.value } })} />
        </label>)}</div>
      </details>)}
      <button disabled={busy} onClick={commitBatch}>Commit reviewed rows</button>
    </div>}
    {message && <p role="status" className="notice">{message}</p>}
  </section>;
}
