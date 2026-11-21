import React, { useMemo, useState } from 'react';
import { t, locale } from '../i18n/index.js';

const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value / 100);

// RBI Repo Rate benchmarked statutory MSME penal interest rate (3x RBI Bank Rate ~ 20.25% p.a.)
const MSMED_PENAL_ANNUAL_RATE = 0.2025;

export default function Section43bAuditor({ forecast, onClose }) {
  const [activeTab, setActiveTab] = useState('payables'); // 'payables' | 'receivables' | 'tax_calendar'
  const [selectedRecipientPhone, setSelectedRecipientPhone] = useState('');

  // Analyze both payables (43B(h) disallowance risk) and receivables (MSMED Act Section 16 interest claims)
  const auditAnalysis = useMemo(() => {
    if (!forecast || !forecast.daily) return null;
    const asOfDate = forecast.asOfDate;
    const allEvents = forecast.daily.flatMap(d => d.events || []);

    const payables = allEvents.filter(e => e.direction === 'out');
    const receivables = allEvents.filter(e => e.direction === 'in');

    // 1. Payables Analysis (Expense Disallowance)
    let totalMsmePayablesPaise = 0;
    let compliantPaise = 0;
    let atRiskPaise = 0;
    let disallowedPaise = 0;

    const classifiedPayables = payables.map(e => {
      totalMsmePayablesPaise += e.amountPaise;
      const daysUntilDue = Math.floor((Date.parse(`${e.date}T00:00:00Z`) - Date.parse(`${asOfDate}T00:00:00Z`)) / 86400000);

      let status = 'compliant';
      let statusLabel = 'Statutory Safe (Within Window)';
      let badgeClass = 'text-success';

      if (daysUntilDue < 0) {
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

    // 2. Receivables Analysis (MSMED Act Section 16 Penal Interest Claims)
    let totalOverdueReceivablesPaise = 0;
    let totalStatutoryInterestAccruedPaise = 0;

    const classifiedReceivables = receivables.map(e => {
      const daysOverdue = Math.max(0, Math.floor((Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${e.date}T00:00:00Z`)) / 86400000));
      const isOverdue = daysOverdue > 0;
      
      // Monthly compounding interest formula: P * ((1 + r/12)^(months) - 1)
      const monthsOverdue = daysOverdue / 30.0;
      const interestPaise = isOverdue
        ? Math.round(e.amountPaise * (Math.pow(1 + MSMED_PENAL_ANNUAL_RATE / 12, monthsOverdue) - 1))
        : 0;

      if (isOverdue) {
        totalOverdueReceivablesPaise += e.amountPaise;
        totalStatutoryInterestAccruedPaise += interestPaise;
      }

      return {
        ...e,
        daysOverdue,
        isOverdue,
        interestPaise,
        statutoryTotalPaise: e.amountPaise + interestPaise,
      };
    });

    // 3. Indian Statutory Tax Calendar Shocks (GSTR-3B on 20th, Advance Tax, TDS on 7th)
    const statutoryDates = [];
    const forecastDates = forecast.daily.map(d => d.date);
    
    forecastDates.forEach(dateStr => {
      const [year, month, day] = dateStr.split('-').map(Number);
      const dayNum = Number(day);
      const dailyPoint = forecast.daily.find(d => d.date === dateStr);
      const closingCashPaise = dailyPoint ? dailyPoint.closingCashPaise : 0;

      if (dayNum === 20) {
        statutoryDates.push({
          date: dateStr,
          title: 'GSTR-3B Monthly Return Filing & Cash Tax Payment',
          statutoryCode: 'GST Section 39',
          description: 'Net cash GST liability must be cleared via Electronic Cash Ledger. Default freezes E-Way Bill generation.',
          projectedCashPaise: closingCashPaise,
          urgency: closingCashPaise < (forecast.minimumReservePaise || 0) ? 'high' : 'normal',
        });
      } else if (dayNum === 15 && [6, 9, 12, 3].includes(month)) {
        statutoryDates.push({
          date: dateStr,
          title: `Advance Tax Instalment (Q${month === 6 ? '1' : month === 9 ? '2' : month === 12 ? '3' : '4'})`,
          statutoryCode: 'Income Tax Sec 208/211',
          description: 'Mandatory quarterly corporate advance tax payment. Non-payment attracts Section 234B/C penal interest.',
          projectedCashPaise: closingCashPaise,
          urgency: closingCashPaise < (forecast.minimumReservePaise || 0) ? 'high' : 'normal',
        });
      } else if (dayNum === 7) {
        statutoryDates.push({
          date: dateStr,
          title: 'TDS / TCS Deposit Deadline',
          statutoryCode: 'Income Tax Sec 200',
          description: 'Monthly tax deducted at source deposited to Central Government. 1.5% interest per month for delay.',
          projectedCashPaise: closingCashPaise,
          urgency: 'normal',
        });
      }
    });

    return {
      totalMsmePayablesPaise,
      compliantPaise,
      atRiskPaise,
      disallowedPaise,
      potentialTaxHitPaise,
      classifiedPayables,
      totalOverdueReceivablesPaise,
      totalStatutoryInterestAccruedPaise,
      classifiedReceivables,
      statutoryDates,
    };
  }, [forecast]);

  if (!auditAnalysis) return null;

  const buildWhatsAppNotice = (item) => {
    const invRef = item.externalId || item.counterparty || 'Invoice';
    const principal = money(item.amountPaise);
    const interest = money(item.interestPaise);
    const total = money(item.statutoryTotalPaise);
    const buyer = item.counterparty || 'Finance Team';

    const text = `*STATUTORY DEMAND NOTICE: MSMED ACT 2006 & IT ACT SEC 43B(h)*\n\n` +
      `Dear ${buyer},\n` +
      `This is a formal communication regarding Invoice *${invRef}* for *${principal}*, which is now *${item.daysOverdue} days overdue*.\n\n` +
      `Please note the statutory implications under Indian Law:\n` +
      `1. *Section 16, MSMED Act 2006*: Delayed payment attracts mandatory compound interest at 3x RBI Bank Rate (${(MSMED_PENAL_ANNUAL_RATE * 100).toFixed(2)}% p.a.). Accrued statutory interest to date: *${interest}*. Total Claim: *${total}*.\n` +
      `2. *Section 43B(h), Income Tax Act 1961*: Unpaid dues to registered MSME suppliers beyond 15/45 days are disallowed as business deductions in your corporate tax assessment, triggering an immediate 30% tax penalty on your company.\n\n` +
      `Kindly arrange RTGS/NEFT settlement immediately to prevent legal referral to the MSME Samadhaan Facilitation Council.\n\n` +
      `Regards,\nAccounts & Finance Department`;

    return `https://wa.me/${selectedRecipientPhone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
  };

  return (
    <div className="card section-43b-card">
      <div className="section-43b-header">
        <div>
          <span className="section-43b-kicker">INDIAN STATUTORY & TAX JURISPRUDENCE</span>
          <h2>Section 43B(h) & MSMED Statutory Auditor</h2>
          <p className="section-43b-caption">
            Comprehensive Indian compliance cockpit: manage Section 43B(h) 30% tax disallowance risks, enforce Section 16 MSMED Act 3x RBI rate penal interest on delayed buyers, and monitor monthly GST cash outflow dates.
          </p>
        </div>
        {onClose && (
          <button type="button" className="secondary" onClick={onClose}>
            ✕ Close Auditor
          </button>
        )}
      </div>

      {/* Mode Switcher Tabs */}
      <div className="horizon-picker" style={{ marginBottom: 16, width: 'fit-content' }}>
        <button
          type="button"
          className={activeTab === 'payables' ? 'active' : ''}
          onClick={() => setActiveTab('payables')}
        >
          🛡️ Payables Tax Disallowance (Sec 43B(h))
        </button>
        <button
          type="button"
          className={activeTab === 'receivables' ? 'active' : ''}
          onClick={() => setActiveTab('receivables')}
        >
          ⚖️ Buyer Overdue & Legal Notice (MSMED Act)
        </button>
        <button
          type="button"
          className={activeTab === 'tax_calendar' ? 'active' : ''}
          onClick={() => setActiveTab('tax_calendar')}
        >
          🗓️ Indian Statutory Tax Calendar (GSTR-3B / Adv. Tax)
        </button>
      </div>

      {/* TAB 1: PAYABLES AUDIT */}
      {activeTab === 'payables' && (
        <>
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
              <span>Potential Tax Liability Added Back</span>
            </div>

            <div className="stat-kpi">
              <small>Critical Window (&lt; 7 Days)</small>
              <strong className={auditAnalysis.atRiskPaise > 0 ? 'text-warning' : 'text-success'}>
                {money(auditAnalysis.atRiskPaise)}
              </strong>
              <span>Must Settle to Protect 100% Deduction</span>
            </div>
          </div>

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
        </>
      )}

      {/* TAB 2: RECEIVABLES RECOVERY LEVERAGE */}
      {activeTab === 'receivables' && (
        <>
          <div className="section-43b-kpis">
            <div className="stat-kpi">
              <small>Overdue Buyer Receivables</small>
              <strong className={auditAnalysis.totalOverdueReceivablesPaise > 0 ? 'text-danger' : 'text-success'}>
                {money(auditAnalysis.totalOverdueReceivablesPaise)}
              </strong>
              <span>Subject to MSMED Act Penalties</span>
            </div>

            <div className="stat-kpi">
              <small>Statutory Penal Interest Accrued</small>
              <strong className="text-warning">
                {money(auditAnalysis.totalStatutoryInterestAccruedPaise)}
              </strong>
              <span>3x RBI Rate (20.25% p.a. Compounded)</span>
            </div>

            <div className="stat-kpi">
              <small>Total Statutory Claim Amount</small>
              <strong>
                {money(auditAnalysis.totalOverdueReceivablesPaise + auditAnalysis.totalStatutoryInterestAccruedPaise)}
              </strong>
              <span>Principal + Section 16 Interest</span>
            </div>

            <div className="stat-kpi">
              <small>Default WhatsApp Mobile</small>
              <input
                type="tel"
                placeholder="+919876543210"
                value={selectedRecipientPhone}
                onChange={e => setSelectedRecipientPhone(e.target.value)}
                style={{ padding: '4px 8px', fontSize: '13px', marginTop: 4, width: '100%' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>For 1-click legal notice dispatch</span>
            </div>
          </div>

          <div className="table-scroll" style={{ marginTop: 16 }}>
            <table className="decision-table">
              <thead>
                <tr>
                  <th>Due Date</th>
                  <th>Customer / Invoice</th>
                  <th>Principal Outstanding</th>
                  <th>Overdue Age</th>
                  <th>Sec 16 Interest (20.25%)</th>
                  <th>Total Legal Claim</th>
                  <th>Legal Dispatch</th>
                </tr>
              </thead>
              <tbody>
                {auditAnalysis.classifiedReceivables.filter(r => r.isOverdue).length === 0 ? (
                  <tr>
                    <td colSpan="7">No customer receivables are currently overdue. All buyers paying on schedule.</td>
                  </tr>
                ) : (
                  auditAnalysis.classifiedReceivables.filter(r => r.isOverdue).map((item, idx) => (
                    <tr key={`${item.id}-${idx}`}>
                      <td>{item.date}</td>
                      <td><strong>{item.externalId || item.counterparty || 'Invoice'}</strong></td>
                      <td>{money(item.amountPaise)}</td>
                      <td><span className="text-danger font-bold">{item.daysOverdue} days</span></td>
                      <td className="text-warning font-mono font-bold">+{money(item.interestPaise)}</td>
                      <td className="font-mono font-bold">{money(item.statutoryTotalPaise)}</td>
                      <td>
                        <a
                          href={buildWhatsAppNotice(item)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="button secondary"
                          style={{ fontSize: '12px', padding: '4px 10px', textDecoration: 'none', display: 'inline-block' }}
                        >
                          💬 Send Legal Nudge
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* TAB 3: INDIAN STATUTORY TAX CALENDAR */}
      {activeTab === 'tax_calendar' && (
        <div style={{ marginTop: 8 }}>
          <p className="section-43b-caption">
            In Indian MSME operations, tax outflow dates cause recurring systemic cash crunches. Overdue GST locks the E-Way bill portal, halting shipments. Fin-Copilot synchronizes statutory tax payment checkpoints with your daily liquidity.
          </p>
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table className="decision-table">
              <thead>
                <tr>
                  <th>Statutory Date</th>
                  <th>Tax Compliance Mandate</th>
                  <th>Jurisdiction / Code</th>
                  <th>Operational Impact</th>
                  <th>Projected Cash on Date</th>
                  <th>Liquidity Risk</th>
                </tr>
              </thead>
              <tbody>
                {auditAnalysis.statutoryDates.length === 0 ? (
                  <tr>
                    <td colSpan="6">No statutory tax dates fall within the selected forecast window.</td>
                  </tr>
                ) : (
                  auditAnalysis.statutoryDates.map((item, idx) => (
                    <tr key={`${item.date}-${idx}`}>
                      <td><strong>{item.date}</strong></td>
                      <td>{item.title}</td>
                      <td><code>{item.statutoryCode}</code></td>
                      <td><small>{item.description}</small></td>
                      <td className={item.projectedCashPaise < 0 ? 'text-danger font-mono font-bold' : 'font-mono'}>
                        {money(item.projectedCashPaise)}
                      </td>
                      <td>
                        <span className={`status-pill ${item.urgency === 'high' ? 'text-danger' : 'text-success'}`}>
                          {item.urgency === 'high' ? '⚠️ High Cash Crunch Risk' : '✓ Liquidity Adequate'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
