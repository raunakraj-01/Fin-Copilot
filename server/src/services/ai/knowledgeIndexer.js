import { buildForecast } from '../finance/forecast.js';

export const money = value => `${value < 0 ? '−' : ''}₹${new Intl.NumberFormat('en-IN').format(Math.floor(Math.abs(value) / 100))}.${String(Math.abs(value) % 100).padStart(2, '0')}`;
export const days = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

/**
 * Indexes heterogeneous workspace records into structured Knowledge Units (KUs).
 * Designed for low-latency, deterministic hybrid retrieval (Lexical + Temporal + Entity).
 */
export function buildKnowledgeIndex(context) {
  const asOfDate = context.asOfDate || new Date().toISOString().slice(0, 10);
  const kus = [];

  // 1. Receivables Knowledge Units (Invoices, debtors, aging)
  const openReceivables = (context.cashItems || []).filter(
    item => item.category === 'receivable' && !['paid', 'cancelled'].includes(item.status) && item.amountPaise > (item.settledPaise || 0)
  );

  openReceivables.forEach((item, idx) => {
    const netPaise = item.amountPaise - (item.settledPaise || 0);
    const overdueDays = item.dueDate ? days(asOfDate, item.dueDate) : 0;
    const isOverdue = overdueDays > 0;
    const agingBucket = overdueDays > 60 ? '>60 days' : overdueDays > 30 ? '31-60 days' : overdueDays > 0 ? '1-30 days' : 'Current';
    const risk = overdueDays > 30 ? 'high' : overdueDays > 0 ? 'medium' : 'low';
    const extId = item.externalId || `REC-${idx + 1}`;

    kus.push({
      kuId: `REC-${item.id || idx}`,
      category: 'receivable',
      title: `Invoice ${extId} (${item.counterparty})`,
      counterparty: item.counterparty,
      amountPaise: netPaise,
      formattedAmount: money(netPaise),
      date: item.dueDate,
      expectedDate: item.expectedDate,
      overdueDays,
      isOverdue,
      agingBucket,
      risk,
      text: `Customer Receivable from ${item.counterparty}: Invoice ${extId} for ${money(netPaise)}. Due date: ${item.dueDate || 'Unspecified'}. Status: ${isOverdue ? `${overdueDays} days overdue (${agingBucket})` : 'Current / not yet due'}. Expected cash date: ${item.expectedDate || 'Unconfirmed'}.`,
      metadata: { invoiceId: extId, counterparty: item.counterparty, netPaise, dueDate: item.dueDate, overdueDays }
    });
  });

  // 2. Payables & Section 43B(h) Knowledge Units
  const openPayables = (context.cashItems || []).filter(
    item => item.category === 'payable' && !['paid', 'cancelled'].includes(item.status) && item.amountPaise > (item.settledPaise || 0)
  );

  openPayables.forEach((item, idx) => {
    const netPaise = item.amountPaise - (item.settledPaise || 0);
    const daysUntilDue = item.dueDate ? days(item.dueDate, asOfDate) : 0;
    const isOverdue = daysUntilDue < 0;
    const sec43bStatus = isOverdue ? 'Disallowed (Overdue)' : daysUntilDue <= 7 ? 'Critical Window (<7 Days)' : 'Statutory Compliant';
    const taxPenaltyPaise = Math.round(netPaise * 0.3); // 30% corporate income tax disallowance
    const extId = item.externalId || `PAY-${idx + 1}`;

    kus.push({
      kuId: `PAY-${item.id || idx}`,
      category: 'payable',
      title: `Vendor Bill ${extId} (${item.counterparty})`,
      counterparty: item.counterparty,
      amountPaise: netPaise,
      formattedAmount: money(netPaise),
      date: item.dueDate,
      daysUntilDue,
      isOverdue,
      sec43bStatus,
      taxPenaltyPaise,
      risk: isOverdue ? 'high' : daysUntilDue <= 7 ? 'medium' : 'low',
      text: `Supplier Payable to ${item.counterparty}: Bill ${extId} for ${money(netPaise)}. Due date: ${item.dueDate}. Section 43B(h) MSME compliance: ${sec43bStatus}. If delayed beyond statutory limit, 30% disallowance tax hit is ${money(taxPenaltyPaise)}.`,
      metadata: { billId: extId, counterparty: item.counterparty, netPaise, dueDate: item.dueDate, sec43bStatus, taxPenaltyPaise }
    });
  });

  // 3. Forecast Runway & Liquidity Risk Knowledge Units
  try {
    const forecast = buildForecast(context);
    const { worstCashPaise, worstDate, firstNegativeDate, firstReserveBreachDate } = forecast.risk || {};
    kus.push({
      kuId: 'FORECAST-RUNWAY',
      category: 'runway',
      title: '90-Day Liquidity Forecast & Runway',
      counterparty: 'Internal Treasury',
      amountPaise: worstCashPaise || 0,
      formattedAmount: money(worstCashPaise || 0),
      date: worstDate || asOfDate,
      firstNegativeDate,
      firstReserveBreachDate,
      risk: worstCashPaise < 0 ? 'high' : 'low',
      text: `Cash Runway Snapshot: Opening cash balance is ${money(forecast.openingCashPaise || 0)}. Minimum required reserve is ${money(forecast.minimumReservePaise || 0)}. Lowest projected cash balance is ${money(worstCashPaise || 0)} on ${worstDate || 'N/A'}. First negative cash breach date: ${firstNegativeDate || 'None in 90 days'}. First reserve breach date: ${firstReserveBreachDate || 'None in 90 days'}.`,
      metadata: { openingCashPaise: forecast.openingCashPaise, worstCashPaise, worstDate, firstNegativeDate }
    });
  } catch {}

  // 4. Statutory Tax Calendar Knowledge Units (GST GSTR-3B & Advance Tax)
  const [yearStr, monthStr] = asOfDate.split('-');
  const currYear = Number(yearStr);
  const currMonth = Number(monthStr);

  // Generate statutory tax landmarks for next 2 months
  for (let mOffset = 0; mOffset <= 2; mOffset++) {
    const targetMonth = ((currMonth - 1 + mOffset) % 12) + 1;
    const targetYear = currYear + Math.floor((currMonth - 1 + mOffset) / 12);
    const mPad = String(targetMonth).padStart(2, '0');

    // GSTR-3B on 20th
    const gstr3bDate = `${targetYear}-${mPad}-20`;
    kus.push({
      kuId: `TAX-GSTR3B-${gstr3bDate}`,
      category: 'tax',
      title: `GSTR-3B GST Return & Tax Clearance (${mPad}/${targetYear})`,
      counterparty: 'GST Department (CBIC)',
      date: gstr3bDate,
      risk: 'medium',
      text: `Statutory Indian Tax Deadline: GSTR-3B return filing and net cash GST payment due on ${gstr3bDate}. Net cash tax liability must be settled via Electronic Cash Ledger. Non-payment locks E-Way Bill generation.`,
      metadata: { code: 'GST-3B', date: gstr3bDate }
    });

    // Advance Tax on 15th if March, June, September, December
    if ([3, 6, 9, 12].includes(targetMonth)) {
      const advTaxDate = `${targetYear}-${mPad}-15`;
      kus.push({
        kuId: `TAX-ADV-${advTaxDate}`,
        category: 'tax',
        title: `Advance Tax Instalment (${mPad}/${targetYear})`,
        counterparty: 'Income Tax Department (CBDT)',
        date: advTaxDate,
        risk: 'medium',
        text: `Statutory Advance Tax Deadline: Mandatory quarterly instalment due on ${advTaxDate} under Income Tax Act Sections 208/211. Delay attracts Sections 234B/C penal interest.`,
        metadata: { code: 'ADV-TAX', date: advTaxDate }
      });
    }
  }

  // 5. Recurring Expenses Knowledge Units
  (context.recurringRules || []).forEach((rule, idx) => {
    kus.push({
      kuId: `REC-EXP-${rule.id || idx}`,
      category: 'recurring',
      title: `Recurring Expense: ${rule.description}`,
      counterparty: rule.description,
      amountPaise: rule.amountPaise,
      formattedAmount: money(rule.amountPaise),
      date: `Day ${rule.dayOfMonth} monthly`,
      text: `Fixed recurring expense: ${rule.description} of ${money(rule.amountPaise)} scheduled on day ${rule.dayOfMonth} of every month. Mandatory: ${rule.mandatory ? 'Yes' : 'Discretionary'}.`,
      metadata: { description: rule.description, amountPaise: rule.amountPaise, dayOfMonth: rule.dayOfMonth }
    });
  });

  return kus;
}

/**
 * Hybrid lexical, entity, and metadata scoring engine.
 * Ranks Knowledge Units with zero external network overhead.
 */
export function retrieveKnowledgeUnits(kus, query, options = {}) {
  const { entity = null, limit = 5 } = options;
  const qClean = query.toLowerCase();
  const queryTokens = qClean.split(/[\s,?!;.:]+/).filter(w => w.length > 2);

  // Intent keyword mappings
  const isOverdueQuery = /overdue|collect|debt|pending|baki|बकाया|who owes|unpaid/i.test(qClean);
  const isTaxQuery = /tax|gst|gstr|3b|advance tax|43b|msme|disallowance|tax hit|टैक्स/i.test(qClean);
  const isRunwayQuery = /runway|cash|balance|negative|deficit|when.*run out|low|zero|deficit/i.test(qClean);
  const isVendorQuery = /vendor|supplier|pay|payable|bill|dues|खर्च/i.test(qClean);

  const scored = kus.map(ku => {
    let score = 0;
    const kuText = ku.text.toLowerCase();
    const kuTitle = ku.title.toLowerCase();
    const kuCounterparty = (ku.counterparty || '').toLowerCase();

    // 1. Direct Entity Match (Highest Weight: +20)
    if (entity && kuCounterparty.includes(entity.toLowerCase())) {
      score += 25;
    }
    if (kuCounterparty && qClean.includes(kuCounterparty)) {
      score += 20;
    }

    // 2. Intent-Category Alignment (+10)
    if (isOverdueQuery && ku.category === 'receivable') {
      score += 10;
      if (ku.isOverdue) score += 15; // Extra boost to overdue receivables
    }
    if (isTaxQuery && (ku.category === 'tax' || ku.category === 'payable')) {
      score += 15;
    }
    if (isRunwayQuery && ku.category === 'runway') {
      score += 20;
    }
    if (isVendorQuery && (ku.category === 'payable' || ku.category === 'recurring')) {
      score += 12;
    }

    // 3. Keyword / Token Frequency Match (+2 per token match)
    queryTokens.forEach(token => {
      if (kuTitle.includes(token)) score += 4;
      else if (kuText.includes(token)) score += 2;
    });

    // 4. Magnitude / Financial Materiality Bonus
    if (ku.amountPaise && ku.amountPaise > 10000000) score += 3; // > ₹1 Lakh
    if (ku.risk === 'high') score += 2;

    return { ku, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter(item => item.score > 0).slice(0, limit).map(item => item.ku);
}
