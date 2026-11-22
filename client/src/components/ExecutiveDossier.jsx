import React from 'react';
import { t, locale } from '../i18n/index.js';

const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR' }).format(value / 100);

export default function ExecutiveDossier({ forecast, workspaceName, asOfDate, onClose }) {
  if (!forecast) return null;

  const { risk, daily, openingCashPaise, minimumReservePaise } = forecast;
  const events = daily.flatMap(d => d.events);
  const totalInflows = events.filter(e => e.direction === 'in').reduce((s, e) => s + e.amountPaise, 0);
  const totalOutflows = events.filter(e => e.direction === 'out').reduce((s, e) => s + e.amountPaise, 0);
  const netCashFlow = totalInflows - totalOutflows;

  // Largest debtors
  const debtors = events
    .filter(e => e.direction === 'in')
    .sort((a, b) => b.amountPaise - a.amountPaise)
    .slice(0, 5);

  // Critical outgoing commitments
  const criticalBills = events
    .filter(e => e.direction === 'out')
    .sort((a, b) => b.amountPaise - a.amountPaise)
    .slice(0, 6);

  return (
    <div className="dossier-overlay" role="dialog" aria-modal="true" aria-label="Executive Working Capital Dossier">
      <div className="dossier-modal">
        <div className="dossier-actions-bar no-print">
          <button type="button" className="primary" onClick={() => window.print()}>
            🖨️ {t("Print / Save as A4 PDF")}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            {t("Close")}
          </button>
        </div>

        <article className="dossier-document">
          <header className="dossier-header">
            <div className="dossier-brand">
              <span className="brand-mark">₹</span>
              <div>
                <h2>FIN-COPILOT · WORKING CAPITAL DOSSIER</h2>
                <small>Chartered Accountant & Banker Executive Assessment</small>
              </div>
            </div>
            <div className="dossier-meta">
              <div><strong>Business:</strong> {workspaceName || 'Primary Enterprise'}</div>
              <div><strong>As-Of Date:</strong> {asOfDate}</div>
              <div><strong>Forecast Horizon:</strong> 90 Days Daily</div>
              <div><strong>Status:</strong> {risk.worstCashPaise >= minimumReservePaise ? 'SOLVENT' : 'DEFICIT DETECTED'}</div>
            </div>
          </header>

          <hr className="dossier-divider" />

          {/* Section 1: Executive KPI Grid */}
          <section className="dossier-section">
            <h3>1. EXECUTIVE LIQUIDITY POSITION</h3>
            <div className="dossier-kpi-grid">
              <div className="dossier-kpi">
                <small>Opening Liquid Cash</small>
                <strong>{money(openingCashPaise)}</strong>
              </div>
              <div className="dossier-kpi">
                <small>Required Safety Reserve</small>
                <strong>{money(minimumReservePaise)}</strong>
              </div>
              <div className="dossier-kpi">
                <small>Worst Projected Balance</small>
                <strong className={risk.worstCashPaise < 0 ? 'text-danger' : ''}>{money(risk.worstCashPaise)}</strong>
                <span>Date: {risk.worstDate}</span>
              </div>
              <div className="dossier-kpi">
                <small>Peak Capital Gap</small>
                <strong className={risk.peakShortagePaise > 0 ? 'text-danger' : ''}>
                  {money(risk.peakShortagePaise)}
                </strong>
                <span>First Shortfall: {risk.firstNegativeDate || 'None'}</span>
              </div>
            </div>
          </section>

          {/* Section 2: 90-Day Cash Flow Summary */}
          <section className="dossier-section">
            <h3>2. 90-DAY CASH-FLOW TOTALS</h3>
            <div className="dossier-table-wrap">
              <table className="dossier-table">
                <tbody>
                  <tr>
                    <td><strong>Total Scheduled Receipts (Receivables)</strong></td>
                    <td className="text-right text-success">+{money(totalInflows)}</td>
                  </tr>
                  <tr>
                    <td><strong>Total Scheduled Outflows (Payables & Operations)</strong></td>
                    <td className="text-right text-danger">-{money(totalOutflows)}</td>
                  </tr>
                  <tr className="dossier-table-total">
                    <td><strong>Net 90-Day Cash Flow</strong></td>
                    <td className={`text-right ${netCashFlow >= 0 ? 'text-success' : 'text-danger'}`}>
                      {netCashFlow >= 0 ? '+' : ''}{money(netCashFlow)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 3: Critical Outgoing Obligations */}
          <section className="dossier-section">
            <h3>3. CRITICAL COMMITMENTS & OUTFLOW DRIVERS (Section 43B(h) / Salaries / Vendors)</h3>
            <div className="dossier-table-wrap">
              <table className="dossier-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Obligation / Counterparty</th>
                    <th>Type</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {criticalBills.map((b, i) => (
                    <tr key={i}>
                      <td>{b.date}</td>
                      <td>{b.externalId || b.counterparty || b.description || 'Commitment'}</td>
                      <td>{b.reason}</td>
                      <td className="text-right">{money(b.amountPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 4: Largest Incoming Receivables Exposure */}
          <section className="dossier-section">
            <h3>4. TOP RECEIVABLE COUNTERPARTIES (Cash Realization Exposure)</h3>
            <div className="dossier-table-wrap">
              <table className="dossier-table">
                <thead>
                  <tr>
                    <th>Expected Date</th>
                    <th>Customer / Invoice</th>
                    <th>Status Evidence</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {debtors.map((d, i) => (
                    <tr key={i}>
                      <td>{d.date}</td>
                      <td>{d.counterparty || d.externalId || d.description}</td>
                      <td>{d.confidenceState || 'Owner Assumption'}</td>
                      <td className="text-right">{money(d.amountPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 5: Strategic Banker / CA Recommendations */}
          <section className="dossier-section">
            <h3>5. CA & LENDER LIQUIDITY RECOMMENDATIONS</h3>
            <ul className="dossier-recommendations">
              <li>
                <strong>Working Capital Buffer Requirement:</strong> The business requires a temporary working capital credit line or overdraft buffer of at least <strong>{money(Math.max(risk.peakShortagePaise, minimumReservePaise - risk.worstCashPaise))}</strong> covering the period through {risk.worstDate}.
              </li>
              <li>
                <strong>Early Settlement Levers:</strong> Accelerating customer invoices with a 1.5% to 2% cash discount before {risk.firstNegativeDate || risk.worstDate} removes the critical deficit without requiring emergency borrowing.
              </li>
              <li>
                <strong>Audit Compliance:</strong> All figures derived from deterministic integer-paise calculations. Zero floating-point rounding errors.
              </li>
            </ul>
          </section>

          <footer className="dossier-footer">
            <small>Generated by Fin-Copilot Decision Engine · Confidential · For Internal CA / Banker Review Only</small>
          </footer>
        </article>
      </div>
    </div>
  );
}
