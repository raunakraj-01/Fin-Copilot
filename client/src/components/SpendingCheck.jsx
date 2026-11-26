import React, { useEffect, useState } from 'react';
import { api, json } from '../services/api.js';
import { locale } from '../i18n/index.js';

const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR' }).format(value / 100);

function addDaysIso(dateStr, days) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') ? dateStr : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function issuePrompt(issue) {
  if (issue.reasonCode === 'needs_review') return 'Imported record needs date verification.';
  if (issue.reasonCode === 'missing_date') return 'No expected cash date set yet.';
  if (issue.reasonCode === 'overdue') {
    return issue.expectedDate
      ? `Expected date (${issue.expectedDate}) is in the past.`
      : 'Overdue or snapshot-day amount needs a future date.';
  }
  return issue.message;
}

export default function SpendingCheck({ workspaceId, refreshKey, businessRole = 'owner', onNavigate, onDataResolved }) {
  const [horizon, setHorizon] = useState('30');
  const [delay, setDelay] = useState('7');
  const [confirmedFor, setConfirmedFor] = useState('');
  const [amount, setAmount] = useState('');
  const [requestAmount, setRequestAmount] = useState(0);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [dateDrafts, setDateDrafts] = useState({});
  const [batchDate, setBatchDate] = useState('');
  const [cashDraft, setCashDraft] = useState(null);
  const [version, setVersion] = useState(0);

  const confirmationKey = `${workspaceId}:${refreshKey}:${horizon}`;
  const confirmed = confirmedFor === confirmationKey;
  const requestKey = `${confirmationKey}:${delay}:${confirmed}:${requestAmount}:${version}`;
  const result = response?.key === requestKey ? response.value : null;

  const unresolvedIssues = result?.dataQuality?.issues || [];
  const otherIssues = unresolvedIssues.filter(issue => issue.code !== 'CONFIRM_COMMITMENTS');
  const hasOtherBlockingIssue = otherIssues.some(issue => issue.blocking);
  const confirmationOnly = result?.status === 'incomplete' && !result.dataQuality?.commitmentsConfirmed && !hasOtherBlockingIssue;

  const baseAnchorDate = result?.evaluatedOn && result?.asOfDate && result.evaluatedOn > result.asOfDate
    ? result.evaluatedOn
    : (result?.asOfDate || result?.evaluatedOn);
  const tomorrowDate = addDaysIso(baseAnchorDate, 1);
  const nextWeekDate = addDaysIso(baseAnchorDate, 7);
  const effectiveBatchDate = batchDate && result?.asOfDate && batchDate > result.asOfDate ? batchDate : nextWeekDate;

  const staleCashIssue = otherIssues.find(issue => issue.code === 'STALE_CASH' || issue.code === 'FUTURE_CASH');
  const fixableItemIssues = otherIssues.filter(issue => (issue.code === 'EXCLUDED_PAYMENT' || issue.code === 'EXCLUDED_RECEIPT') && issue.itemId);
  const otherNavigationIssues = otherIssues.filter(issue => issue.code === 'BANK_REVIEW' || issue.code === 'PROMISE_ALLOCATION');
  const fallbackTextIssues = otherIssues.filter(issue =>
    issue.code !== 'STALE_CASH' && issue.code !== 'FUTURE_CASH'
    && !((issue.code === 'EXCLUDED_PAYMENT' || issue.code === 'EXCLUDED_RECEIPT') && issue.itemId)
    && issue.code !== 'BANK_REVIEW' && issue.code !== 'PROMISE_ALLOCATION');

  useEffect(() => {
    setCashDraft(null);
    setDateDrafts({});
    setBatchDate('');
    setActionError('');
    setActionNotice('');
  }, [workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    const params = new URLSearchParams({ horizonDays: horizon, delayDays: delay, commitmentsConfirmed: String(confirmed), spendPaise: String(requestAmount) });
    api(`/workspaces/${workspaceId}/spending-check?${params}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setResponse({ key: requestKey, value }); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [workspaceId, requestKey]);

  function refreshAll(noticeText) {
    setActionError('');
    setActionNotice(noticeText);
    setVersion(v => v + 1);
    onDataResolved?.();
  }

  async function saveItemDate(issue, targetDate) {
    if (!targetDate || (result?.asOfDate && targetDate <= result.asOfDate)) {
      setActionError(`Pick a future date after ${result?.asOfDate || 'today'}.`);
      return;
    }
    setBusyKey(issue.itemId);
    setActionError('');
    setActionNotice('');
    try {
      await json(`/workspaces/${workspaceId}/items/${issue.itemId}`, 'PATCH', {
        expectedDate: targetDate,
        confidenceState: 'owner_assumption',
      });
      refreshAll(`Scheduled ${issue.externalId || issue.counterparty || 'record'} for ${targetDate}.`);
    } catch (reason) {
      setActionError(reason.message);
    } finally {
      setBusyKey('');
    }
  }

  async function markItemSettled(issue) {
    const settledPaise = issue.totalAmountPaise ?? ((issue.settledPaise || 0) + issue.amountPaise);
    setBusyKey(issue.itemId);
    setActionError('');
    setActionNotice('');
    try {
      await json(`/workspaces/${workspaceId}/items/${issue.itemId}`, 'PATCH', {
        status: 'paid',
        settledPaise,
      });
      refreshAll(`Marked ${issue.externalId || issue.counterparty || 'record'} as settled.`);
    } catch (reason) {
      setActionError(reason.message);
    } finally {
      setBusyKey('');
    }
  }

  async function scheduleAllItems(targetDate) {
    if (!targetDate || (result?.asOfDate && targetDate <= result.asOfDate)) {
      setActionError(`Pick a future date after ${result?.asOfDate || 'today'}.`);
      return;
    }
    setBusyKey('batch');
    setActionError('');
    setActionNotice('');
    try {
      await Promise.all(fixableItemIssues.map(issue =>
        json(`/workspaces/${workspaceId}/items/${issue.itemId}`, 'PATCH', {
          expectedDate: targetDate,
          confidenceState: 'owner_assumption',
        })));
      refreshAll(`Scheduled all ${fixableItemIssues.length} items for ${targetDate}.`);
    } catch (reason) {
      setActionError(reason.message);
    } finally {
      setBusyKey('');
    }
  }

  async function confirmTodaysCash(event) {
    event.preventDefault();
    const raw = cashDraft ?? (result?.openingCashPaise != null ? String(result.openingCashPaise / 100) : '0');
    if (!/^-?\d+(\.\d{1,2})?$/.test(raw.trim()) || !Number.isSafeInteger(Math.round(Number(raw) * 100))) {
      setActionError('Enter a valid bank balance with at most two decimal places.');
      return;
    }
    const targetDate = result?.evaluatedOn || addDaysIso('', 0);
    setBusyKey('cash');
    setActionError('');
    setActionNotice('');
    try {
      await json(`/workspaces/${workspaceId}`, 'PATCH', {
        asOfDate: targetDate,
        openingCashPaise: Math.round(Number(raw) * 100),
      });
      setCashDraft(null);
      refreshAll(`Updated bank cash snapshot to ${targetDate}.`);
    } catch (reason) {
      setActionError(reason.message);
    } finally {
      setBusyKey('');
    }
  }

  function check(event) {
    event.preventDefault();
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || !Number.isSafeInteger(Math.round(Number(amount) * 100))) {
      setError('Enter a nonnegative rupee amount with at most two decimal places.'); return;
    }
    setRequestAmount(Math.round(Number(amount) * 100));
    setVersion(v => v + 1);
  }

  const purchaseCurrent = amount !== '' && Math.round(Number(amount) * 100) === requestAmount;
  const verdict = result?.status === 'conditional' && purchaseCurrent && result.expected.canSpend != null
    ? (result.expected.canSpend && result.delayed.canSpend
      ? { tone: 'safe', title: `Safe to spend ${money(requestAmount)}`,
        detail: `This payment keeps your cash above your protected reserve even if customer payments arrive ${result.delayDays} days late.` }
      : result.expected.canSpend
        ? { tone: 'caution', title: `Risky if customers pay ${result.delayDays} days late`,
          detail: `Covered if customers pay on time, but drops below your reserve on ${result.delayed.firstBreachAfterSpend} if payments slip.` }
        : { tone: 'danger', title: 'Not safe to spend right now',
          detail: `Paying ${money(requestAmount)} drops your cash below reserve on ${result.expected.firstBreachAfterSpend}. Consider delaying or paying a smaller amount.` })
    : null;

  return <div className="card spending-check" aria-label="Reserve-aware spending check">
    <h2>How much can I spend?</h2>
    <div className="form-grid">
      <label>Planning period<select value={horizon} onChange={e => setHorizon(e.target.value)}>{['7', '30', '60', '90'].map(d => <option key={d} value={d}>{d} days</option>)}</select></label>
      <label>Customer payment delay<select value={delay} onChange={e => setDelay(e.target.value)}>{['7', '15', '30'].map(d => <option key={d} value={d}>{d} days late</option>)}</select></label>
    </div>

    <div className="spending-confirm-box">
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmedFor(e.target.checked ? confirmationKey : '')} /> I included all wages, tax payments, supplier bills, loan payments and other commitments for this period.</label>
      <p>Confirm that this cash snapshot includes all payments already received and all other commitments for the selected period.</p>
    </div>

    {error && <div><p role="alert">{error}</p><button type="button" className="secondary" onClick={() => setVersion(v => v + 1)}>Retry spending check</button></div>}
    {!result && !error && <p role="status">Calculating spending limits…</p>}
    {result && <>
      <p>Cash snapshot: {result.asOfDate} · Through {result.endDate} · Protected reserve: {money(result.minimumReservePaise)}</p>
      {result.status === 'incomplete' && (confirmationOnly
        ? <p role="status" className="notice">Data incomplete until you confirm all commitments. Tick the confirmation above to calculate spending limits.</p>
        : <p role="status" className="issue">Data incomplete. Resolve the data issues listed below.</p>)}

      {actionNotice && <p role="status" className="notice">{actionNotice}</p>}
      {actionError && <p role="alert" className="issue">{actionError}</p>}

      {otherIssues.length > 0 && <div className="spending-fix-panel">
        <h3>Quick fix ({otherIssues.filter(i => i.blocking).length || otherIssues.length} item{otherIssues.length === 1 ? '' : 's'} to review)</h3>
        <p className="spending-fix-lead">Fix these right here so we can calculate your safe spending limit—no need to switch tabs.</p>

        {staleCashIssue && <form className="spending-fix-row" onSubmit={confirmTodaysCash}>
          <div>
            <strong>Bank cash snapshot needs updating</strong>
            <p>{staleCashIssue.message}</p>
          </div>
          {businessRole === 'owner'
            ? <div className="spending-fix-controls">
              <label>Today&apos;s bank balance (₹)
                <input type="number" step="0.01" required
                  value={cashDraft ?? String((result.openingCashPaise ?? 0) / 100)}
                  onChange={e => setCashDraft(e.target.value)} />
              </label>
              <button type="submit" disabled={busyKey === 'cash'}>
                {busyKey === 'cash' ? 'Updating…' : `Confirm balance for ${result.evaluatedOn}`}
              </button>
            </div>
            : <p className="spending-fix-note">Ask the business owner to confirm today&apos;s bank balance.</p>}
        </form>}

        {fixableItemIssues.length > 1 && <div className="spending-fix-batch">
          <span><strong>Fix all {fixableItemIssues.length} dated items in one click:</strong></span>
          <div className="spending-fix-controls">
            <button type="button" className="secondary" disabled={!!busyKey} onClick={() => scheduleAllItems(tomorrowDate)}>
              Schedule all tomorrow ({tomorrowDate})
            </button>
            <button type="button" className="secondary" disabled={!!busyKey} onClick={() => scheduleAllItems(nextWeekDate)}>
              Schedule all +7 days ({nextWeekDate})
            </button>
            <input type="date" aria-label="Schedule all items date" min={tomorrowDate} value={effectiveBatchDate}
              onChange={e => setBatchDate(e.target.value)} />
            <button type="button" disabled={!!busyKey} onClick={() => scheduleAllItems(effectiveBatchDate)}>
              {busyKey === 'batch' ? 'Saving…' : 'Apply to all'}
            </button>
          </div>
        </div>}

        {fixableItemIssues.map(issue => {
          const draftDate = dateDrafts[issue.itemId] || nextWeekDate;
          const isReceipt = issue.category === 'receivable';
          const isBusy = busyKey === issue.itemId || busyKey === 'batch';
          return <div className="spending-fix-row" key={issue.itemId}>
            <div className="spending-fix-meta">
              <span className={`spending-badge ${isReceipt ? 'is-in' : 'is-out'}`}>{isReceipt ? 'Money In' : 'Money Out'}</span>
              <strong>{issue.counterparty || issue.externalId || 'Record'}{issue.externalId && issue.counterparty && issue.externalId !== issue.counterparty ? ` (${issue.externalId})` : ''}</strong>
              <span className="spending-fix-amount">{money(issue.amountPaise)}</span>
              <p>{issuePrompt(issue)}</p>
            </div>
            <div className="spending-fix-controls">
              <button type="button" className="secondary" disabled={isBusy} onClick={() => saveItemDate(issue, tomorrowDate)}>Tomorrow</button>
              <button type="button" className="secondary" disabled={isBusy} onClick={() => saveItemDate(issue, nextWeekDate)}>+7 days</button>
              <input type="date" aria-label={`Expected date for ${issue.externalId || issue.counterparty || issue.itemId}`}
                min={tomorrowDate} value={draftDate}
                onChange={e => setDateDrafts(prev => ({ ...prev, [issue.itemId]: e.target.value }))} />
              <button type="button" disabled={isBusy} onClick={() => saveItemDate(issue, draftDate)}>
                {busyKey === issue.itemId ? 'Saving…' : 'Save date'}
              </button>
              <button type="button" className="secondary" disabled={isBusy} onClick={() => markItemSettled(issue)}>
                {isReceipt ? 'Already received' : 'Already paid'}
              </button>
            </div>
          </div>;
        })}

        {otherNavigationIssues.map((issue, idx) => <div className="spending-fix-row" key={`${issue.code}-${idx}`}>
          <div>
            <strong>{issue.code === 'BANK_REVIEW' ? 'Unmatched bank entry' : 'Payment promise needs review'}</strong>
            <p>{issue.message}{issue.amountPaise > 0 && ` Amount: ${money(issue.amountPaise)}.`}</p>
          </div>
          {onNavigate && issue.code === 'BANK_REVIEW' && <button type="button" className="secondary" onClick={() => onNavigate('setup')}>Review in Setup</button>}
        </div>)}

        {fallbackTextIssues.length > 0 && <div>
          <h4>Data to review</h4>
          <ul>{fallbackTextIssues.map((issue, i) => <li key={`${issue.code}-${i}`}>{issue.message}{issue.amountPaise > 0 && ` Amount: ${money(issue.amountPaise)}.`}</li>)}</ul>
        </div>}
      </div>}

      {verdict && <div className={`spending-verdict is-${verdict.tone}`} role="status">
        <strong>{verdict.title}</strong>
        <p>{verdict.detail}</p>
      </div>}

      <div className="metrics">{[['Expected payments', result.expected], [`Payments ${result.delayDays} days late`, result.delayed]].map(([label, scenario]) => <article key={label} className="card">
        <h3>{label}</h3><strong>{scenario.spendablePaise == null ? 'Unavailable' : money(scenario.spendablePaise)}</strong>
        <p>{scenario.spendablePaise == null
          ? (confirmationOnly ? 'Additional spending limit (tick confirmation above)' : 'Additional spending limit (resolve items above)')
          : 'Additional spending limit'}</p>
        <p>Included receipts: {money(scenario.includedReceiptsPaise)} · Included payments: {money(scenario.includedPaymentsPaise)}</p>
        <p>Lowest projected balance before spending: {money(scenario.minimumBalancePaise)} on {scenario.minimumDate}</p>
        {scenario.reserveGapPaise > 0 && <p className="issue">Existing plan is below reserve by {money(scenario.reserveGapPaise)}. First breach: {scenario.firstReserveBreachDate}.</p>}
        {purchaseCurrent && scenario.canSpend != null && <p>{scenario.canSpend ? 'Your proposed payment preserves the reserve in this scenario.' : `Your proposed payment breaches the reserve on ${scenario.firstBreachAfterSpend}.`} Lowest balance after payment: {money(scenario.afterSpendMinimumPaise)}.</p>}
      </article>)}</div>

      {result.recommendedSpendablePaise != null && <p className="notice"><strong>{result.expected.firstReserveBreachDate || result.delayed.firstReserveBreachDate
        ? 'No additional spending room. The existing plan already falls below reserve.'
        : `Limit that preserves the reserve in both scenarios: ${money(result.recommendedSpendablePaise)}`}</strong></p>}

      <form onSubmit={check} className="form-grid">
        <label>Proposed spending (₹)<input type="number" min="0" step="0.01" value={amount} required onChange={e => setAmount(e.target.value)} /></label>
        <button>Check this payment</button>
      </form>
      {purchaseCurrent && result.status === 'incomplete' && (
        <p className="spending-fix-note" role="status">
          Finish the quick fix / confirmation steps above — we&apos;ll automatically check {money(requestAmount)} once unlocked.
        </p>
      )}

      <details><summary>How this is calculated</summary><ul>{result.assumptions.map(a => <li key={a}>{a}</li>)}</ul></details>
    </>}
  </div>;
}
