import React from 'react';
import { t, locale } from '../i18n/index.js';

export function computeResilienceScore(forecast) {
  if (!forecast) return { score: 50, breakdown: {}, grade: 'B', label: 'Neutral' };
  const { risk, openingCashPaise, minimumReservePaise, daily = [], cashDesk = {} } = forecast;

  // 1. Runway & Breach Factor (Max 40 points)
  let runwayPts = 40;
  if (risk.firstNegativeDate) {
    const daysToNegative = Math.max(0, Math.floor((Date.parse(`${risk.firstNegativeDate}T00:00:00Z`) - Date.parse(`${forecast.asOfDate}T00:00:00Z`)) / 86400000));
    if (daysToNegative <= 7) runwayPts = 5;
    else if (daysToNegative <= 15) runwayPts = 15;
    else if (daysToNegative <= 30) runwayPts = 25;
    else runwayPts = 32;
  }

  // 2. Reserve Buffer Margin (Max 30 points)
  let reservePts = 30;
  if (risk.worstCashPaise < 0) {
    reservePts = 0;
  } else if (risk.worstCashPaise < minimumReservePaise) {
    reservePts = Math.round(15 * (risk.worstCashPaise / Math.max(1, minimumReservePaise)));
  }

  // 3. Debtor Concentration & Liquidity Diversity (Max 20 points)
  const inflowEvents = daily.flatMap(d => d.events || []).filter(e => e.direction === 'in');
  const totalInflow = inflowEvents.reduce((s, e) => s + e.amountPaise, 0);
  let concentrationPts = 20;
  if (totalInflow > 0 && inflowEvents.length > 0) {
    const maxSingleDebtor = Math.max(...inflowEvents.map(e => e.amountPaise));
    const topDebtorShare = maxSingleDebtor / totalInflow;
    if (topDebtorShare > 0.6) concentrationPts = 8;
    else if (topDebtorShare > 0.4) concentrationPts = 14;
    else concentrationPts = 20;
  }

  // 4. Data Freshness & Traceability (Max 10 points)
  const staleDays = cashDesk?.dataFreshness?.staleDays ?? 0;
  let freshnessPts = 10;
  if (staleDays > 14) freshnessPts = 2;
  else if (staleDays > 7) freshnessPts = 5;

  const totalScore = Math.max(0, Math.min(100, runwayPts + reservePts + concentrationPts + freshnessPts));

  let grade = 'A';
  let label = 'Robust Shield';
  let color = '#10b981'; // Emerald
  if (totalScore < 40) {
    grade = 'D';
    label = 'Critical Shortfall Risk';
    color = '#ef4444'; // Red
  } else if (totalScore < 60) {
    grade = 'C';
    label = 'Liquidity Stressed';
    color = '#f59e0b'; // Amber
  } else if (totalScore < 80) {
    grade = 'B';
    label = 'Adequate Headroom';
    color = '#3b82f6'; // Blue
  }

  return {
    score: totalScore,
    grade,
    label,
    color,
    breakdown: {
      runway: { score: runwayPts, max: 40, label: 'Runway & Deficit Distance' },
      reserve: { score: reservePts, max: 30, label: 'Safety Buffer Protection' },
      concentration: { score: concentrationPts, max: 20, label: 'Debtor Diversification' },
      freshness: { score: freshnessPts, max: 10, label: 'Ledger Audit Freshness' },
    },
  };
}

export default function CapitalHealthGauge({ forecast }) {
  const result = computeResilienceScore(forecast);
  const { score, grade, label, color, breakdown } = result;

  // Arc calculation
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * (circumference * 0.75);

  return (
    <div className="card capital-health-card">
      <div className="capital-health-header">
        <div>
          <span className="health-badge-kicker">FINANCIAL RESILIENCE INDEX</span>
          <h2>Capital Health Scorecard</h2>
          <p className="health-caption">
            Deterministic liquidity resilience model evaluating runway horizon, reserve preservation, and debtor exposure.
          </p>
        </div>
        <div className="health-grade-pill" style={{ borderColor: color, color }}>
          Grade {grade} · {label}
        </div>
      </div>

      <div className="capital-health-body">
        {/* Circular Gauge */}
        <div className="gauge-container" role="img" aria-label={`Capital Health Score ${score} out of 100`}>
          <svg className="gauge-svg" viewBox="0 0 140 140">
            {/* Background track */}
            <circle
              className="gauge-track"
              cx="70"
              cy="70"
              r={radius}
              strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
              strokeDashoffset="0"
              transform="rotate(135 70 70)"
            />
            {/* Active metric bar */}
            <circle
              className="gauge-bar"
              cx="70"
              cy="70"
              r={radius}
              stroke={color}
              strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
              strokeDashoffset={strokeDashoffset}
              transform="rotate(135 70 70)"
            />
          </svg>
          <div className="gauge-center-label">
            <span className="gauge-score-value">{score}</span>
            <span className="gauge-score-sub">/ 100</span>
          </div>
        </div>

        {/* Sub-Metric Factor Breakdown */}
        <div className="health-factors-list">
          {Object.entries(breakdown).map(([key, item]) => {
            const pct = Math.round((item.score / item.max) * 100);
            return (
              <div key={key} className="health-factor-row">
                <div className="health-factor-meta">
                  <span className="factor-name">{item.label}</span>
                  <span className="factor-val">
                    {item.score} / {item.max} pts
                  </span>
                </div>
                <div className="factor-progress-track">
                  <div
                    className="factor-progress-fill"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: pct > 75 ? '#10b981' : pct > 45 ? '#f59e0b' : '#ef4444',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
