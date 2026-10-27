import { analyzeNewOrder, validateOrder } from './analyze.js';

export function prepareSavedScenario(context, request, buildForecast) {
  const order = validateOrder(request);
  const result = analyzeNewOrder(context, order, buildForecast);
  return {
    label: order.label?.trim() || 'Prospective order',
    orderValuePaise: order.orderValuePaise,
    advancePaise: order.advancePaise,
    advanceDate: order.advanceDate,
    finalCollectionDate: order.finalCollectionDate,
    costLines: order.costLines.map(line => ({ ...line, description: line.description?.trim() || 'Order cost' })),
    simulatedMinimumAdvancePaise: result.minimumAdvance.possible ? result.minimumAdvance.amountPaise : null,
    scenarioWarnings: [...result.warnings,
      'Hypothetical scenario only; no sales, receipts or payments have been posted',
      `Calculated from the cash snapshot on ${result.asOfDate} through ${result.forecastEndDate}, with reserve ${result.minimumReservePaise} paise. Reanalyze against current records before use.`,
      ...(result.minimumAdvance.possible ? [] : [result.minimumAdvance.message]),
      ...(order.delayedCollectionDays ? [`A ${order.delayedCollectionDays}-day delay was tested during analysis; the saved dates and minimum advance describe the original payment terms.`] : []),
    ],
  };
}
