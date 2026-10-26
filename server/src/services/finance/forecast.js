const DAY_MS = 86_400_000;

function dayNumber(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date: ${date}`);
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid date: ${date}`);
  }
  return value / DAY_MS;
}

function dateFromDay(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function buildForecast({
  asOfDate, horizonDays = 90, openingCashPaise, minimumReservePaise = 0,
  cashItems = [], recurringRules = [], additionalEvents = [],
}) {
  const start = dayNumber(asOfDate);
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 366) throw new Error('Invalid horizonDays');
  if (!Number.isSafeInteger(openingCashPaise) || !Number.isSafeInteger(minimumReservePaise) || minimumReservePaise < 0) {
    throw new Error('Invalid cash or reserve amount');
  }

  const events = [];
  const warnings = [];
  const addEvent = (event) => {
    const day = dayNumber(event.date);
    if (!Number.isSafeInteger(event.amountPaise) || event.amountPaise < 0) throw new Error('Invalid event amount');
    if (!['in', 'out'].includes(event.direction)) throw new Error('Invalid event direction');
    // Opening cash is an as-of-date snapshot, so only later movements are added.
    if (day > start && day < start + horizonDays) events.push(event);
  };

  for (const item of cashItems) {
    if (['paid', 'cancelled'].includes(item.status)) continue;
    if (item.confidenceState === 'needs_review') {
      warnings.push(`Cash item ${item.externalId || item.id || item._id || 'unknown'} needs verification`);
      continue;
    }
    const amount = item.amountPaise - (item.settledPaise || 0);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid cash item settlement');
    if (!amount) continue;
    if (!item.expectedDate) {
      warnings.push(`Cash item ${item.externalId || item.id || item._id || 'unknown'} needs an expected date`);
      continue;
    }
    if (dayNumber(item.expectedDate) <= start) {
      warnings.push(`Cash item ${item.externalId || item.id || item._id || 'unknown'} needs a future expected date`);
      continue;
    }
    if (!['receivable', 'payable', 'expense'].includes(item.category)) throw new Error('Invalid cash item category');
    addEvent({
      id: String(item.id || item._id || item.externalId), cashItemId: String(item.id || item._id || item.externalId),
      externalId: item.externalId, date: item.expectedDate,
      direction: item.category === 'receivable' ? 'in' : 'out', amountPaise: amount,
      reason: item.category === 'receivable' ? 'customer_invoice' : item.category === 'payable' ? 'supplier_bill' : 'expense',
    });
  }

  for (const rule of recurringRules) {
    if (rule.active === false) continue;
    if (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 28) throw new Error('Invalid recurring dayOfMonth');
    for (let day = start; day < start + horizonDays; day++) {
      const date = dateFromDay(day);
      if (Number(date.slice(8)) === rule.dayOfMonth && date >= rule.startsOn && (!rule.endsOn || date <= rule.endsOn)) {
        addEvent({ id: `${rule.id || rule._id}:${date}`, sourceId: String(rule.id || rule._id), date,
          direction: 'out', amountPaise: rule.amountPaise, reason: 'recurring_expense', description: rule.description });
      }
    }
  }
  for (const event of additionalEvents) addEvent(event);

  const daily = [];
  let cash = openingCashPaise;
  let firstNegativeDate = null;
  let firstReserveBreachDate = null;
  let worstCashPaise = Infinity;
  let worstDate = asOfDate;
  for (let day = start; day < start + horizonDays; day++) {
    const date = dateFromDay(day);
    const dayEvents = events.filter(event => event.date === date);
    const receiptsPaise = dayEvents.filter(event => event.direction === 'in').reduce((sum, event) => sum + event.amountPaise, 0);
    const paymentsPaise = dayEvents.filter(event => event.direction === 'out').reduce((sum, event) => sum + event.amountPaise, 0);
    cash += receiptsPaise - paymentsPaise;
    if (!Number.isSafeInteger(cash)) throw new Error('Forecast balance exceeds safe integer range');
    daily.push({ date, receiptsPaise, paymentsPaise, closingCashPaise: cash, events: dayEvents });
    if (cash < 0 && !firstNegativeDate) firstNegativeDate = date;
    if (cash < minimumReservePaise && !firstReserveBreachDate) firstReserveBreachDate = date;
    if (cash < worstCashPaise) { worstCashPaise = cash; worstDate = date; }
  }

  const forecast = {
    asOfDate, openingCashPaise, minimumReservePaise, horizonDays, daily,
    risk: { firstNegativeDate, firstReserveBreachDate, worstCashPaise, worstDate,
      peakShortagePaise: Math.max(0, -worstCashPaise), contributingItems: [] },
    warnings, assumptions: ['Expected dates are user inputs, not guaranteed collection dates'],
  };
  forecast.risk.contributingItems = explainRisk(forecast, cashItems).contributingItems;
  return forecast;
}

export function explainRisk(forecast, _cashItems = []) {
  const cutoff = [forecast.risk.firstNegativeDate, forecast.risk.firstReserveBreachDate].filter(Boolean).sort()[0] || forecast.risk.worstDate;
  return { contributingItems: forecast.daily.flatMap(day => day.date <= cutoff ? day.events : [])
    .filter(event => event.direction === 'out')
    .sort((a, b) => b.amountPaise - a.amountPaise)
    .map(event => ({ cashItemId: event.cashItemId || event.sourceId || event.id, externalId: event.externalId,
      amountPaise: event.amountPaise, date: event.date, direction: event.direction })) };
}
