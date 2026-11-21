import React, { useMemo } from 'react';
import { t, locale } from '../i18n/index.js';

const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value / 100);

export default function Section43bAuditor({ forecast, onClose }) {
  // Analyze all outgoing obligations from the forecast
  const auditAnalysis = useMemo(() => {
    if (!forecast || !forecast.daily) return null;
    const asOfDate = forecast.asOfDate;
    const events = forecast.daily.flatMap(d => d.events || []).filter(e => e.direction === 'out');

    let totalMsmePayablesPaise = 0;
    let compliantPaise = 0;
    let atRiskPaise = 0;
    let disallowedPaise = 0;

    const classifiedPayables = events.map(e => {
      totalMsmePayablesPaise += e.amountPaise;
      const daysUntilDue = Math.floor((Date.parse(`${e.date}T00:00:00Z`) - Date.parse(`${asOfDate}T00:00:00Z`)) / 86400000);

      let status = 'compliant';
      let statusLabel = 'Statutory Safe (Within Window)';
      let badgeClass = 'text-success';

      if (daysUntilDue < 0) {
        // Already overdue
        status = 'disallowed';
        statusLabel = 'Section 43B(h) Disallowed (Overdue)';
        badgeClass = 'text-danger';
        disallowedPaise += e.amountPaise;
      } else if (daysUntilDue <= 7) {
        status = 'at_risk';
        statusLabel = 'Critical Statutory Window (< 7 Days)';
        badgeClass = 'text-warning';
        atRiskPaise += e.amountPaise;
      } else {
        compliantPaise += e.amountPaise;
      }

      return {
        ...e,
        daysUntilDue,
        status,
        statusLabel,
        badgeClass,
        taxPenaltyPaise: Math.round(e.amountPaise * 0.3), // 30% corporate income tax rate penalty
      };
    });

    const potentialTaxHitPaise = Math.round(disallowedPaise * 0.3);

    return {
      totalMsmePayablesPaise,
      compliantPaise,
      atRiskPaise,
      disallowedPaise,
      potentialTaxHitPaise,
      classifiedPayables,
    };
  }, [forecast]);

  if (!auditAnalysis) return null;

  return (
    <div className="card section-43b-card">
      <div className="section-43b-header">
        <div>
          <span className="section-43b-kicker">INDIAN STATUTORY TAX AUDIT</span>
          <h2>Section 43B(h) MSME Compliance Auditor</h2>
          <p className="section-43b-caption">
            Under Section 43B(h) of the Income Tax Act 1961, payments to registered MSME suppliers delayed beyond 15/45 days are disallowed as business expense, triggering an immediate 30% corporate tax penalty on unpaid sums.
          </p>
        </div>
        {onClose && (
          <button type="button" className="secondary" onClick={onClose}>
            ✕ Close Auditor
          </button>
        )}
      </div>

      {/* KPI Summary Cards */}
      <div className="section-43b-kpis">
        <div className="stat-kpi">
          <small>Total Scheduled Payables</small>
          <strong>{money(auditAnalysis.totalMsmePayablesPaise)}</strong>
          <span>90-Day Vendor Commitments</span>
        </div>

        <div className="stat-kpi">
          <small>Disallowed / Overdue Payables</small>
          <strong className={auditAnalysis.disallowedPaise > 0 ? 'text-danger' : 'text-success'}>
            {money(auditAnalysis.disallowedPaise)}
          </strong>
          <span>Immediate Tax Disallowance Risk</span>
        </div>

        <div className="stat-kpi">
          <small>Estimated Income Tax Penalty (30%)</small>
          <strong className={auditAnalysis.potentialTaxHitPaise > 0 ? 'text-danger' : 'text-success'}>
            {money(auditAnalysis.potentialTaxHitPaise)}
          </strong>
          <span>Potential Additional Tax Liability</span>
        </div>

        <div className="stat-kpi">
          <small>Critical Window (&lt; 7 Days)</small>
          <strong className={auditAnalysis.atRiskPaise > 0 ? 'text-warning' : 'text-success'}>
            {money(auditAnalysis.atRiskPaise)}
          </strong>
          <span>Must Settle to Avoid Disallowance</span>
        </div>
      </div>

      {/* Audit Schedule Table */}
      <div className="table-scroll" style={{ marginTop: 16 }}>
        <table className="decision-table">
          <thead>
            <tr>
              <th>Due Date</th>
              <th>Supplier / Bill Reference</th>
              <th>Payable Amount</th>
              <th>Statutory Status</th>
              <th>Window Remaining</th>
              <th>Disallowance Tax Hit (30%)</th>
            </tr>
          </thead>
          <tbody>
            {auditAnalysis.classifiedPayables.length === 0 ? (
              <tr>
                <td colSpan="6">No outgoing supplier payables scheduled in the forecast period.</td>
              </tr>
            ) : (
              auditAnalysis.classifiedPayables.map((item, idx) => (
                <tr key={`${item.id}-${idx}`}>
                  <td>{item.date}</td>
                  <td><strong>{item.externalId || item.counterparty || item.description || 'Vendor Bill'}</strong></td>
                  <td>{money(item.amountPaise)}</td>
                  <td>
                    <span className={`status-pill ${item.badgeClass}`}>
                      {item.statusLabel}
                    </span>
                  </td>
                  <td>
                    {item.daysUntilDue < 0
                      ? `${Math.abs(item.daysUntilDue)} days overdue ⚠️`
                      : item.daysUntilDue === 0
                      ? 'Due Today'
                      : `${item.daysUntilDue} days left`}
                  </td>
                  <td>
                    {item.status === 'disallowed' ? (
                      <span className="text-danger font-mono font-bold">+{money(item.taxPenaltyPaise)}</span>
                    ) : (
                      <span className="text-muted font-mono">₹0 (Protected)</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
