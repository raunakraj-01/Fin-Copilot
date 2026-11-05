// Promise dates are expectations. Only dated, confirmed receipts settle an invoice.
export function promiseState(promise, asOfDate) {
  const remainingPaise = Math.max(0, promise.amountPaise - (promise.receivedPaise || 0));
  const status = promise.closedAs || (!remainingPaise ? 'fulfilled'
    : promise.promisedDate < asOfDate ? 'broken' : promise.receivedPaise ? 'partial' : 'pending');
  return { ...promise, id: String(promise._id || promise.id), remainingPaise, status };
}

export function currentPromises(item, asOfDate) {
  // Legacy settlements can reduce outstanding without a promise allocation. Cap expectations
  // to the ledger's remaining balance so mixed recording methods never invent receipts.
  let available = ['paid', 'cancelled'].includes(item.status) ? 0 : Math.max(0, item.amountPaise - (item.settledPaise || 0));
  return (item.paymentPromises || []).map(p => promiseState(p, asOfDate))
    .filter(p => !p.closedAs).sort((a, b) => a.promisedDate.localeCompare(b.promisedDate) || a.id.localeCompare(b.id))
    .map(p => {
      const forecastPaise = Math.min(available, p.remainingPaise); available -= forecastPaise;
      return { ...p, forecastPaise, status: forecastPaise < p.remainingPaise ? 'review_external_settlement' : p.status };
    });
}

export function itemPromiseStates(item, asOfDate) {
  const active = new Map(currentPromises(item, asOfDate).map(p => [p.id, p]));
  return (item.paymentPromises || []).map(p => active.get(String(p._id || p.id)) || promiseState(p, asOfDate));
}

export function promiseExposure(forecast, cashItems) {
  const outgoings = forecast.daily.flatMap(day => day.events.filter(event => event.direction === 'out')
    .map(event => ({ ...event, closingCashPaise: day.closingCashPaise })));
  return cashItems.filter(item => item.category === 'receivable' && item.confidenceState !== 'needs_review').flatMap(item => currentPromises(item, forecast.asOfDate)
    .filter(p => p.forecastPaise > 0).map(p => {
      const missed = p.promisedDate <= forecast.asOfDate;
      return { cashItemId: String(item.id || item._id), promiseId: p.id, counterparty: item.counterparty,
        externalId: item.externalId, amountPaise: p.forecastPaise, promisedDate: p.promisedDate, status: p.status,
        comparison: missed ? 'Upcoming payments below reserve while this due or overdue receipt is excluded'
          : 'Payments at risk if this receipt does not arrive within the forecast horizon',
        affectedPayments: outgoings.filter(event => (missed || event.date >= p.promisedDate)
          && event.closingCashPaise - (missed ? 0 : p.forecastPaise) < forecast.minimumReservePaise)
          .map(event => ({ id: event.id, date: event.date,
            label: event.externalId || event.description || event.counterparty || event.id,
            amountPaise: event.amountPaise,
            gapPaise: Math.max(0, forecast.minimumReservePaise - event.closingCashPaise + (missed ? 0 : p.forecastPaise)) })),
      };
    }));
}
