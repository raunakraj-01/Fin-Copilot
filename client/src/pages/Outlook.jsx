import { t, useLanguage, locale } from '../i18n/index.js';
import React, { useEffect, useState } from 'react';
import { CartesianGrid, Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import './Outlook/outlook-redesign.css';
import { api } from '../services/api.js';
import PaymentPromises from '../components/PaymentPromises.jsx';
import SpendingCheck from '../components/SpendingCheck.jsx';
import ExecutiveDossier from '../components/ExecutiveDossier.jsx';
import CapitalHealthGauge from '../components/CapitalHealthGauge.jsx';
import WhatIfSimulator from '../components/WhatIfSimulator.jsx';
import EngineeringInspector from '../components/EngineeringInspector.jsx';
import MonteCarloEngine from '../components/MonteCarloEngine.jsx';
import Section43bAuditor from '../components/Section43bAuditor.jsx';
import { exportForecastToCsv, exportToTallyXml } from '../services/exportAudit.js';

const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR' }).format(value / 100);
const compactMoney = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 }).format(value / 100);

export default function Outlook({ workspaceId, onNavigate, user, workspaceName, businessRole = 'owner', isDemo = false, onResetDemo, demoResetBusy = false, promiseDraft, onPromiseDraftConsumed }) {
  useLanguage();
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [forecastRefreshKey, setForecastRefreshKey] = useState(0);
  const [showDossier, setShowDossier] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [showMonteCarlo, setShowMonteCarlo] = useState(false);
  const [showSection43b, setShowSection43b] = useState(false);
  const [horizonDays, setHorizonDays] = useState(90);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    api(`/workspaces/${workspaceId}/forecast`).then(value => { if (active) setForecast(value); })
      .catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [workspaceId, refreshKey, forecastRefreshKey]);

  if (!workspaceId) return <section className="outlook-state"><h1>{t("Cash Outlook")}</h1><p>{t("Create a workspace and import records first.")}</p>
    <button type="button" onClick={() => onNavigate?.('setup')}>{t('Open Setup & Import')}</button></section>;
  if (error) return <section className="outlook-state"><h1>{t("Cash Outlook")}</h1><p role="alert">{t(error)}</p>
    <button type="button" onClick={() => { setError(''); setRefreshKey(value => value + 1); }}>{t('Try again')}</button></section>;
  if (!forecast) return <section className="outlook-state" role="status" aria-label={t('Loading forecast')}>
    <h1>{t("Cash Outlook")}</h1><p>{t("Loading forecast…")}</p><div className="outlook-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
  </section>;
  const { risk } = forecast;
  const events = forecast.daily.flatMap(day => day.events);
  const desk = forecast.cashDesk || {};
  const freshness = desk.dataFreshness || {};
  const issues = desk.unresolvedIssues || { bankRows: [], cashItems: [], totalCount: 0 };
  const bankRows = issues.bankRows || [];
  const cashItems = issues.cashItems || [];
  const reserveDay = forecast.daily.find(day => day.date === risk.firstReserveBreachDate);
  const next30Days = forecast.daily.slice(0, 30);
  const safeToSpendPaise = desk.safeToSpendPaise ?? Math.max(0,
    (next30Days.length ? Math.min(...next30Days.map(day => day.closingCashPaise)) : forecast.openingCashPaise) - forecast.minimumReservePaise);
  const actions = [];
  if (reserveDay) {
    const shortfallPaise = Math.max(0, forecast.minimumReservePaise - reserveDay.closingCashPaise);
    actions.push({ title: `Protect the reserve before ${reserveDay.date}`,
      detail: `Projected cash is ${money(reserveDay.closingCashPaise)} against a ${money(forecast.minimumReservePaise)} reserve.`,
      impact: `Projected reserve gap: ${money(shortfallPaise)}`, page: 'rescue' });
  }
  if (bankRows.length) {
    const amountPaise = bankRows.reduce((sum, row) => sum + (row.amountPaise || 0), 0);
    actions.push({ title: `Review ${bankRows.length} unresolved bank row${bankRows.length === 1 ? '' : 's'}`,
      detail: 'Match the statement to ledger records or record why the remainder is excluded.',
      impact: `Amount awaiting review: ${money(amountPaise)}`, page: 'setup' });
  }
  if (cashItems.length) {
    const amountPaise = cashItems.reduce((sum, item) => sum + (item.amountPaise || 0), 0);
    actions.push({ title: `Resolve ${cashItems.length} cash record issue${cashItems.length === 1 ? '' : 's'}`,
      detail: cashItems.slice(0, 2).map(item => item.externalId || item.counterparty || 'Cash record').join(', '),
      impact: `Cash records involved: ${money(amountPaise)}`, page: 'setup' });
  }
  if (freshness.stale && actions.length < 3) {
    actions.push({ title: 'Refresh cash inputs', detail: `The latest update was ${freshness.staleDays} days ago.`,
      impact: 'Forecast impact is not quantified until the records are refreshed.', page: 'setup' });
  }
  const today = new Intl.DateTimeFormat(locale(), { dateStyle: 'long', timeZone: 'Asia/Kolkata' }).format(new Date());
  const chartData = forecast.daily.slice(0, horizonDays);

  return <section className="cash-outlook outlook-workspace">
    <header className="outlook-heading">
      <div>
        <h1>{t('Cash Outlook')}</h1>
        <p>{workspaceName ? `${workspaceName}. ` : ''}{t('Prepared for')} {user?.name || t('your business')}</p>
      </div>
      <div className="outlook-heading-actions no-print">
        {isDemo && onResetDemo && (
          <button type="button" className="secondary" disabled={demoResetBusy} onClick={onResetDemo}>
            {demoResetBusy ? t('Resetting demo…') : t('Reset demo data')}
          </button>
        )}
        <button type="button" onClick={() => onNavigate?.('orders')}>{t('Check a new buyer')}</button>
      </div>
    </header>

    <p className="outlook-note">{t('Spend headroom uses entered expected dates and current records; receipts are not guaranteed.')}</p>
    <p className="notice outlook-risk-note">{t(risk.explanation)}</p>

    <section className="chart outlook-chart outlook-forecast-panel" aria-labelledby="outlook-forecast-heading">
      <div className="outlook-chart-heading">
        <div><h2 id="outlook-forecast-heading">{t('Daily closing cash forecast')}</h2>
          <p>{t('Today')}: {today}. {t('Cash snapshot')}: {t(desk.snapshotDate || forecast.asOfDate)}</p></div>
        <div className="outlook-chart-controls">
          <div className="horizon-picker no-print" role="group" aria-label="Forecast horizon">
            {[30, 60, 90].map(d => <button key={d} type="button" className={`horizon-btn ${horizonDays === d ? 'active' : ''}`}
              aria-pressed={horizonDays === d} onClick={() => setHorizonDays(d)}>{d} {t('days')}</button>)}
          </div>
          <span className="outlook-chart-range">{chartData[0]?.date} to {chartData.at(-1)?.date}</span>
        </div>
      </div>
      <div className="outlook-chart-plot" role="img" aria-label={t('Daily closing cash forecast')}>
        <span id="outlookCashGrad" className="visually-hidden">{t('Projected closing cash')}</span>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 12, right: 20, left: 15, bottom: 8 }}>
            <CartesianGrid stroke="var(--outlook-rule)" strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={value => value.slice(5)} minTickGap={20} stroke="var(--outlook-rule-strong)" tick={{ fill: 'var(--outlook-muted)' }} />
            <YAxis tickFormatter={compactMoney} stroke="var(--outlook-rule-strong)" tick={{ fill: 'var(--outlook-muted)' }} />
            <ReferenceLine y={0} stroke="var(--outlook-rule-strong)" strokeDasharray="4 4" />
            <ReferenceLine y={forecast.minimumReservePaise || 0} stroke="var(--outlook-accent-bright)" strokeDasharray="3 3" />
            <Tooltip formatter={value => money(value)} contentStyle={{ backgroundColor: 'var(--outlook-surface)', borderColor: 'var(--outlook-rule)', color: 'var(--outlook-ink)' }} labelStyle={{ color: 'var(--outlook-ink)' }} />
            <Area type="monotone" dataKey="closingCashPaise" stroke="var(--outlook-accent-bright)" strokeWidth={2.5}
              fill="var(--outlook-accent-soft)" fillOpacity={0.55} name={t('Closing cash')} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="outlook-chart-key" aria-label={t('Chart key')}>
        <span><i className="outlook-chart-key-cash" aria-hidden="true"></i>{t('Daily closing cash')}</span>
        <span><i className="outlook-chart-key-reserve" aria-hidden="true"></i>{t('Minimum reserve')}</span>
      </div>
    </section>

    <div className="metrics cash-desk-metrics outlook-metrics">
      <div className="card"><small>{t('Safe to spend (next 30 days)')}</small><strong>{t(money(safeToSpendPaise))}</strong><span>{t('Projected low point less the reserve')}</span></div>
      <div className="card"><small>{t('Opening cash at snapshot')}</small><strong>{t(money(forecast.openingCashPaise))}</strong></div>
      <div className={`card outlook-risk${risk.worstCashPaise < 0 ? ' outlook-risk-negative' : ''}`}><small>{t('Lowest projected balance')}</small><strong>{t(money(risk.worstCashPaise))}</strong><span>{t(risk.worstDate)}. {t('First negative day')}: {t(risk.firstNegativeDate || 'None')}</span></div>
      <div className="card"><small>{t('Next reserve breach')}</small><strong>{t(risk.firstReserveBreachDate || 'None')}</strong></div>
    </div>

    <section className="outlook-tools no-print" aria-label={t('Forecast tools')}>
      <div className="outlook-tools-heading"><h2>{t('Tools and exports')}</h2><p>{t('Open an analysis or export the current forecast.')}</p></div>
      <div className="outlook-tool-list">
        <button type="button" className={showSimulator ? 'is-active' : ''} aria-pressed={showSimulator} onClick={() => setShowSimulator(v => !v)}>{showSimulator ? t('Hide Simulator') : t('What-If Simulator')}</button>
        <button type="button" className={showMonteCarlo ? 'is-active' : ''} aria-pressed={showMonteCarlo} onClick={() => setShowMonteCarlo(v => !v)}>{showMonteCarlo ? t('Hide Monte Carlo') : t('Monte Carlo Risk')}</button>
        <button type="button" className={showSection43b ? 'is-active' : ''} aria-pressed={showSection43b} onClick={() => setShowSection43b(v => !v)}>{showSection43b ? t('Hide 43B(h)') : t('Section 43B(h) Auditor')}</button>
        <button type="button" onClick={() => setShowInspector(true)}>{t('CS Architecture')}</button>
        <button type="button" onClick={() => exportToTallyXml(forecast)}>{t('Tally Prime XML')}</button>
        <button type="button" onClick={() => exportForecastToCsv(forecast)}>{t('Export Audit CSV')}</button>
        <button type="button" onClick={() => setShowDossier(true)}>{t('Executive Dossier (A4)')}</button>
      </div>
    </section>

    {showMonteCarlo && <MonteCarloEngine forecast={forecast} onClose={() => setShowMonteCarlo(false)} />}
    {showSection43b && <Section43bAuditor forecast={forecast} onClose={() => setShowSection43b(false)} />}
    {showSimulator && <WhatIfSimulator forecast={forecast} onClose={() => setShowSimulator(false)} />}
    <CapitalHealthGauge forecast={forecast} />

    <div className="card cash-desk-actions" aria-labelledby="cash-actions-heading">
      <h2 id="cash-actions-heading">{t('Prioritized actions')}</h2>
      {actions.length ? <ol>{actions.slice(0, 3).map((action, index) => <li key={`${action.title}-${index}`}>
        <div><strong>{t(action.title)}</strong><p>{t(action.detail)}</p><small>{t(action.impact)}</small></div>
        <button type="button" className="secondary" onClick={() => onNavigate?.(action.page)}>{t('Review')}</button>
      </li>)}</ol> : <p>{t('No urgent actions from the current cash inputs.')}</p>}
      {!!issues.totalCount && <p className="cash-issue-count" role="status">{t(`${issues.totalCount} unresolved data issue${issues.totalCount === 1 ? '' : 's'}`)}</p>}
    </div>
    <section className="outlook-data-freshness" aria-labelledby="outlook-freshness-heading">
      <h2 id="outlook-freshness-heading">{t('Data freshness')}</h2>
      <p>{freshness.stale ? t(`Stale - ${freshness.staleDays} days`) : t('Current')}</p>
      <p>{freshness.lastUpdatedAt ? `${t('Last updated')}: ${new Date(freshness.lastUpdatedAt).toLocaleDateString(locale())}` : t('No source update recorded')}</p>
      <p>{freshness.lastSuccessfulSyncAt ? `${t('Last successful Tally sync')}: ${new Date(freshness.lastSuccessfulSyncAt).toLocaleDateString(locale())}` : t('No successful Tally sync recorded')}</p>
    </section>
    <SpendingCheck key={`spending-${workspaceId}`} workspaceId={workspaceId} refreshKey={refreshKey}
      businessRole={businessRole} isDemo={isDemo} onNavigate={onNavigate} onDataResolved={() => setForecastRefreshKey(value => value + 1)} />
    <PaymentPromises key={workspaceId} workspaceId={workspaceId} onChanged={() => setRefreshKey(value => value + 1)}
      initialDraft={promiseDraft} onDraftConsumed={onPromiseDraftConsumed} />
    {events.length === 0 && <p className="notice">{t("No future cash movements are scheduled. Add or import records on Setup & Import, and check any data warnings below.")}</p>}
    {events.length > 0 && <div className="card"><h2>{t("Scheduled receipts and payments")}</h2><div className="table-scroll"><table>
      <thead><tr><th>{t("Date")}</th><th>{t("Record")}</th><th>{t("Direction")}</th><th>{t("Amount")}</th><th>{t("Evidence")}</th></tr></thead>
      <tbody>{events.map((event, index) => <tr key={`${event.id}-${index}`}>
        <td>{t(event.date)}</td><td>{event.externalId || event.description || event.counterparty || event.id}</td>
        <td>{t(event.direction === 'in' ? 'Receipt' : 'Payment')}</td><td>{t(money(event.amountPaise))}</td>
        <td>{t(event.confidenceState === 'verified' ? 'Verified' : event.confidenceState === 'owner_assumption' ? 'Owner assumption' : 'Scenario')}</td>
      </tr>)}</tbody>
    </table></div></div>}
    {risk.contributingItems.length > 0 && <div className="card"><h2>{t("Largest outgoing drivers")}</h2><ul>{risk.contributingItems.slice(0, 5).map((item, index) =>
      <li key={`${item.cashItemId}-${index}`}>{t(item.date)}: {item.externalId || item.cashItemId}, {t(money(item.amountPaise))}</li>)}</ul></div>}
    {forecast.warnings.length > 0 && <div className="card"><h2>{t("Data warnings")}</h2><ul>{forecast.warnings.map((warning, index) => <li key={index}>{t(warning)}</li>)}</ul></div>}
    {showDossier && <ExecutiveDossier forecast={forecast} asOfDate={forecast.asOfDate} onClose={() => setShowDossier(false)} />}
    {showInspector && <EngineeringInspector onClose={() => setShowInspector(false)} />}
  </section>;
}

