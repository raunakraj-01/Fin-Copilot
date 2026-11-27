/**
 * Autonomous Morning Cash Briefing Service
 * Generates an executive daily cash snapshot and WhatsApp briefing payload
 * designed for Indian MSME business owners before morning operations commence.
 */

import { buildForecast } from '../finance/forecast.js';
import { recommendCollections, rupees } from '../finance/followups.js';
import { loadDecisionContext } from '../rescue/decisionContext.js';
import { clientOrigin } from '../auth.js';

export function formatIndianCurrency(amountPaise) {
  const inr = (amountPaise || 0) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(inr);
}

export async function generateMorningBrief(workspaceId, asOfDate = new Date().toISOString().slice(0, 10)) {
  const context = await loadDecisionContext(workspaceId);
  const forecast = buildForecast({ ...context, asOfDate });
  
  // Find today's events or first day
  const todayEntry = forecast.daily.find(d => d.date === asOfDate) || forecast.daily[0] || {
    date: asOfDate,
    openingCashPaise: context.openingCashPaise || 0,
    closingCashPaise: context.openingCashPaise || 0,
    inflowPaise: 0,
    outflowPaise: 0,
    events: [],
  };

  const openingCashPaise = todayEntry.openingCashPaise ?? context.openingCashPaise ?? 0;
  const todayInflowsPaise = todayEntry.inflowPaise ?? 0;
  const todayOutflowsPaise = todayEntry.outflowPaise ?? 0;
  const closingCashPaise = todayEntry.closingCashPaise ?? openingCashPaise;
  const minimumReservePaise = context.minimumReservePaise || 0;

  // 30-Day Safe-To-Spend Headroom
  const next30Days = forecast.daily.slice(0, 30);
  const lowest30DayCash = next30Days.length ? Math.min(...next30Days.map(d => d.closingCashPaise)) : openingCashPaise;
  const safeToSpendPaise = Math.max(0, lowest30DayCash - minimumReservePaise);

  // Recommendations & Top Debtor Priority
  const followups = recommendCollections(context);
  const topPriority = followups.suggestions[0] || null;

  // Section 43B(h) Statutory Overdue Count (Invoices past 15/45 days)
  const statutoryRisks = context.cashItems.filter(item => {
    if (item.category !== 'receivable' || item.status === 'paid') return false;
    const daysPast = Math.round((Date.parse(asOfDate) - Date.parse(item.dueDate)) / 86400000);
    return daysPast >= 15;
  });

  const formattedDate = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(`${asOfDate}T00:00:00Z`));

  // Build clean, high-impact WhatsApp Message Body
  const lines = [
    `🛡️ *Fin-Copilot Morning Cash Brief*`,
    `📅 ${formattedDate} | ${context.workspaceName || 'Enterprise'}`,
    ``,
    `💰 *Opening Cash:* ${formatIndianCurrency(openingCashPaise)}`,
    `📈 *Inflows Expected Today:* ${formatIndianCurrency(todayInflowsPaise)}`,
    `📉 *Outflows Expected Today:* ${formatIndianCurrency(todayOutflowsPaise)}`,
    `🛡️ *30-Day Safe-to-Spend:* ${formatIndianCurrency(safeToSpendPaise)}`,
  ];

  if (topPriority) {
    lines.push(``);
    lines.push(`📞 *Priority Call Today:*`);
    lines.push(`• *${topPriority.counterparty}* (${topPriority.externalId}): ${formatIndianCurrency(topPriority.outstandingPaise)} overdue.`);
    lines.push(`  _${topPriority.reason}_`);
  }

  if (statutoryRisks.length > 0) {
    const totalRiskPaise = statutoryRisks.reduce((sum, item) => sum + (item.amountPaise - (item.settledPaise || 0)), 0);
    lines.push(``);
    lines.push(`⚖️ *Section 43B(h) Statutory Alert:*`);
    lines.push(`• ${statutoryRisks.length} buyer receivable(s) (${formatIndianCurrency(totalRiskPaise)}) past 15/45-day tax disallowance limit.`);
  }

  lines.push(``);
  lines.push(`👉 *Live Risk Center:* ${clientOrigin().replace(/\/$/, '')}/cash-outlook`);

  const whatsappText = lines.join('\n');
  const encodedWhatsappUrl = `https://wa.me/?text=${encodeURIComponent(whatsappText)}`;

  return {
    asOfDate,
    formattedDate,
    workspaceName: context.workspaceName,
    metrics: {
      openingCashPaise,
      todayInflowsPaise,
      todayOutflowsPaise,
      closingCashPaise,
      minimumReservePaise,
      safeToSpendPaise,
    },
    topPriority,
    statutoryRisksCount: statutoryRisks.length,
    whatsappText,
    whatsappUrl: encodedWhatsappUrl,
    generatedAt: new Date().toISOString(),
  };
}
