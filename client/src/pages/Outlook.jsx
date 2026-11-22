import { t, useLanguage, locale } from '../i18n/index.js';
import React, { useEffect, useState } from 'react';
import { CartesianGrid, Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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

export default function Outlook({ workspaceId, onNavigate }) {
  useLanguage();
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
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
  }, [workspaceId, refreshKey]);

  if (!workspaceId) return <section><h1>{t("Cash Outlook")}</h1><p>{t("Create a workspace and import records first.")}</p>
    <button type="button" onClick={() => onNavigate?.('setup')}>{t('Open Setup & Import')}</button></section>;
  if (error) return <section><h1>{t("Cash Outlook")}</h1><p role="alert">{t(error)}</p></section>;
  if (!forecast) return <section><h1>{t("Cash Outlook")}</h1><p>{t("Loading forecast…")}</p></section>;
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

  return <section className="cash-outlook">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
      <div>
        <h1>{t("Cash Outlook")}</h1>
        <p>{t('Today')}: {today} | {t('Cash snapshot')}: {t(desk.snapshotDate || forecast.asOfDate)}</p>
        <p className="cash-desk-caption">{t('Spend headroom uses entered expected dates and current records; receipts are not guaranteed.')}</p>
      </div>
    </div>

    {/* Structured Command Toolbar */}
    <div className="outlook-command-bar no-print" role="toolbar" aria-label="Outlook analytics and export tools">
      {/* Group 1: Risk & Simulation Sandbox */}
      <div className="command-group">
        <span className="command-group-title">{t("Simulations")}</span>
        <div className="command-group-buttons">
          <button
            type="button"
            className={`command-btn ${showSimulator ? 'active' : ''}`}
            onClick={() => setShowSimulator(v => !v)}
            title="Interactive Customer Delay & Emergency Outflow Sandbox"
          >
            <span className="btn-icon">🔬</span> {showSimulator ? t("Hide Simulator") : t("What-If Simulator")}
          </button>
          <button
            type="button"
            className={`command-btn ${showMonteCarlo ? 'active' : ''}`}
            onClick={() => setShowMonteCarlo(v => !v)}
            title="1,000-Path Gaussian Delay Stochastic Risk Simulation"
          >
            <span className="btn-icon">🎲</span> {showMonteCarlo ? t("Hide Monte Carlo") : t("Monte Carlo Risk (1k)")}
          </button>
        </div>
      </div>

      {/* Group 2: Compliance & Audit */}
      <div className="command-group">
        <span className="command-group-title">{t("Compliance & Audit")}</span>
        <div className="command-group-buttons">
          <button
            type="button"
            className={`command-btn ${showSection43b ? 'active' : ''}`}
            onClick={() => setShowSection43b(v => !v)}
            title="Section 43B(h) 30% Tax Penalty & MSMED Act Penal Interest Auditor"
          >
            <span className="btn-icon">⚖️</span> {showSection43b ? t("Hide 43B(h)") : t("Section 43B(h) Auditor")}
          </button>
          <button
            type="button"
            className="command-btn"
            onClick={() => setShowInspector(true)}
            title="Algorithmic Complexity, Safety Invariant Proofs & Live Benchmarks"
          >
            <span className="btn-icon">⚡</span> {t("CS Architecture")}
          </button>
        </div>
      </div>

      {/* Group 3: Institutional Exports & ERP Bridges */}
      <div className="command-group">
        <span className="command-group-title">{t("Export & ERP")}</span>
        <div className="command-group-buttons">
          <button
            type="button"
            className="command-btn"
            onClick={() => exportToTallyXml(forecast)}
            title="Generate Native Tally.ERP 9 / Tally Prime XML Import Vouchers"
          >
            <span className="btn-icon">📦</span> {t("Tally Prime XML")}
          </button>
          <button
            type="button"
            className="command-btn"
            onClick={() => exportForecastToCsv(forecast)}
            title="Export 90-Day Liquidity Schedule to CSV with CWE-1236 Sanitization"
          >
            <span className="btn-icon">📥</span> {t("Export Audit CSV")}
          </button>
          <button
            type="button"
            className="command-btn"
            onClick={() => setShowDossier(true)}
            title="Generate A4 Printable Working Capital Dossier for CAs and Bankers"
          >
            <span className="btn-icon">📑</span> {t("Executive Dossier (A4)")}
          </button>
        </div>
      </div>
    </div>

    <p className="notice">{t(risk.explanation)}</p>

    {/* Capital Health Scorecard Gauge */}
    <CapitalHealthGauge forecast={forecast} />

    {/* Stochastic Monte Carlo Simulation Engine */}
    {showMonteCarlo && <MonteCarloEngine forecast={forecast} onClose={() => setShowMonteCarlo(false)} />}

    {/* Section 43B(h) Statutory Compliance Auditor */}
    {showSection43b && <Section43bAuditor forecast={forecast} onClose={() => setShowSection43b(false)} />}

    {/* Interactive What-If Scenario Sandbox */}
    {showSimulator && <WhatIfSimulator forecast={forecast} onClose={() => setShowSimulator(false)} />}

    <div className="metrics cash-desk-metrics">
      <div className="card"><small>{t('Safe to spend (next 30 days)')}</small><strong>{t(money(safeToSpendPaise))}</strong><span>{t('Projected low point less the reserve')}</span></div>
      <div className="card"><small>{t('Opening cash at snapshot')}</small><strong>{t(money(forecast.openingCashPaise))}</strong></div>
      <div className="card"><small>{t('Next reserve breach')}</small><strong>{t(risk.firstReserveBreachDate || 'None')}</strong></div>
      <div className={`card cash-freshness${freshness.stale ? ' cash-freshness-stale' : ''}`}>
        <small>{t('Data freshness')}</small>
        <strong>{freshness.stale ? t(`Stale - ${freshness.staleDays} days`) : t('Current')}</strong>
        <span>{freshness.lastUpdatedAt ? `${t('Last updated')} ${new Date(freshness.lastUpdatedAt).toLocaleDateString(locale())}` : t('No source update recorded')}</span>
        <span>{freshness.lastSuccessfulSyncAt ? `${t('Last successful Tally sync')}: ${new Date(freshness.lastSuccessfulSyncAt).toLocaleDateString(locale())}` : t('No successful Tally sync recorded')}</span>
      </div>
    </div>
    <div className="card cash-desk-actions" aria-labelledby="cash-actions-heading">
      <h2 id="cash-actions-heading">{t('Prioritized actions')}</h2>
      {actions.length ? <ol>{actions.slice(0, 3).map((action, index) => <li key={`${action.title}-${index}`}>
        <div><strong>{t(action.title)}</strong><p>{t(action.detail)}</p><small>{t(action.impact)}</small></div>
        <button type="button" className="secondary" onClick={() => onNavigate?.(action.page)}>{t('Review')}</button>
      </li>)}</ol> : <p>{t('No urgent actions from the current cash inputs.')}</p>}
      {!!issues.totalCount && <p className="cash-issue-count" role="status">{t(`${issues.totalCount} unresolved data issue${issues.totalCount === 1 ? '' : 's'}`)}</p>}
    </div>
    <SpendingCheck key={`spending-${workspaceId}`} workspaceId={workspaceId} refreshKey={refreshKey} />
    <div className="metrics cash-risk-metrics">
      <div className="card"><small>{t("First negative day")}</small><strong>{t(risk.firstNegativeDate || 'None')}</strong></div>
      <div className={`card outlook-risk${risk.worstCashPaise < 0 ? ' outlook-risk-negative' : ''}`}><small>{t("Worst balance")}</small><strong>{t(money(risk.worstCashPaise))}</strong><span>{t(risk.worstDate)}</span></div>
    </div>
    <PaymentPromises key={workspaceId} workspaceId={workspaceId} onChanged={() => setRefreshKey(value => value + 1)} />
    {events.length === 0 && <p className="notice">{t("No future cash movements are scheduled. Add or import records on Setup & Import, and check any data warnings below.")}</p>}
    {events.length > 0 && <div className="card"><h2>{t("Scheduled receipts and payments")}</h2><div className="table-scroll"><table>
      <thead><tr><th>{t("Date")}</th><th>{t("Record")}</th><th>{t("Direction")}</th><th>{t("Amount")}</th><th>{t("Evidence")}</th></tr></thead>
      <tbody>{events.map((event, index) => <tr key={`${event.id}-${index}`}>
        <td>{t(event.date)}</td><td>{event.externalId || event.description || event.counterparty || event.id}</td>
        <td>{t(event.direction === 'in' ? 'Receipt' : 'Payment')}</td><td>{t(money(event.amountPaise))}</td>
        <td>{t(event.confidenceState === 'verified' ? 'Verified' : event.confidenceState === 'owner_assumption' ? 'Owner assumption' : 'Scenario')}</td>
      </tr>)}</tbody>
    </table></div></div>}
    <section className="chart outlook-chart">
      <div className="outlook-chart-heading">
        <h2>{t("Daily closing cash forecast")}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="horizon-picker no-print" role="group" aria-label="Forecast horizon">
            {[30, 60, 90].map(d => (
              <button
                key={d}
                type="button"
                className={`horizon-btn ${horizonDays === d ? 'active' : ''}`}
                onClick={() => setHorizonDays(d)}
              >
                {d}D
              </button>
            ))}
          </div>
          <span>{chartData[0]?.date} – {chartData.at(-1)?.date}</span>
        </div>
      </div>
      <div className="outlook-chart-plot" role="img" aria-label={t("Daily closing cash forecast")}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 12, right: 20, left: 15, bottom: 8 }}>
            <defs>
              <linearGradient id="outlookCashGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#275e80" stopOpacity={0.28} />
                <stop offset="95%" stopColor="#275e80" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
            <XAxis dataKey="date" tickFormatter={value => value.slice(5)} minTickGap={20} />
            <YAxis tickFormatter={value => `${Math.round(value / 100000)}k`} />
            <ReferenceLine y={0} stroke="#a43d41" strokeDasharray="4 4" />
            <ReferenceLine y={forecast.minimumReservePaise || 0} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: 'Reserve', fill: '#f59e0b', fontSize: 11, position: 'right' }} />
            <Tooltip formatter={value => money(value)} />
            <Area type="monotone" dataKey="closingCashPaise" stroke="#275e80" strokeWidth={2.8} fillOpacity={1} fill="url(#outlookCashGrad)" name={t("Closing cash")} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
    {risk.contributingItems.length > 0 && <div className="card"><h2>{t("Largest outgoing drivers")}</h2><ul>{risk.contributingItems.slice(0, 5).map((item, index) =>
      <li key={`${item.cashItemId}-${index}`}>{t(item.date)} · {item.externalId || item.cashItemId} · {t(money(item.amountPaise))}</li>)}</ul></div>}
    {forecast.warnings.length > 0 && <div className="card"><h2>{t("Data warnings")}</h2><ul>{forecast.warnings.map((warning, index) => <li key={index}>{t(warning)}</li>)}</ul></div>}
    {showDossier && <ExecutiveDossier forecast={forecast} asOfDate={forecast.asOfDate} onClose={() => setShowDossier(false)} />}
    {showInspector && <EngineeringInspector onClose={() => setShowInspector(false)} />}
  </section>;
}

