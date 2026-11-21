export function exportForecastToCsv(forecast, workspaceName = 'Fin-Copilot Workspace') {
  if (!forecast || !forecast.daily) return;

  const rows = [
    ['FIN-COPILOT STATUTORY LIQUIDITY AUDIT SCHEDULE'],
    ['Business Name', workspaceName],
    ['As-Of Date', forecast.asOfDate],
    ['Opening Liquid Cash (INR)', (forecast.openingCashPaise / 100).toFixed(2)],
    ['Required Safety Reserve (INR)', ((forecast.minimumReservePaise || 0) / 100).toFixed(2)],
    ['Worst Projected Balance (INR)', (forecast.risk.worstCashPaise / 100).toFixed(2)],
    ['Worst Projected Date', forecast.risk.worstDate || 'N/A'],
    ['First Negative Breach Date', forecast.risk.firstNegativeDate || 'None in 90 Days'],
    [''],
    ['Date', 'Opening Cash (INR)', 'Daily Inflow (INR)', 'Daily Outflow (INR)', 'Closing Cash (INR)', 'Reserve Status', 'Scheduled Events'],
  ];

  forecast.daily.forEach(d => {
    const inflow = (d.events || []).filter(e => e.direction === 'in').reduce((s, e) => s + e.amountPaise, 0);
    const outflow = (d.events || []).filter(e => e.direction === 'out').reduce((s, e) => s + e.amountPaise, 0);
    const closing = d.closingCashPaise;
    const opening = closing - inflow + outflow;
    const reserveStatus = closing < 0 ? 'CRITICAL DEFICIT' : closing < (forecast.minimumReservePaise || 0) ? 'RESERVE BREACH' : 'SOLVENT';
    const eventSummary = (d.events || []).map(e => `${e.externalId || e.counterparty || 'Event'}: ${(e.amountPaise / 100).toFixed(0)} (${e.direction})`).join('; ');

    rows.push([
      d.date,
      (opening / 100).toFixed(2),
      (inflow / 100).toFixed(2),
      (outflow / 100).toFixed(2),
      (closing / 100).toFixed(2),
      reserveStatus,
      `"${eventSummary.replace(/"/g, '""')}"`,
    ]);
  });

  const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(r => r.join(',')).join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `FinCopilot_Audit_Schedule_${forecast.asOfDate}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportForecastToJson(forecast, workspaceName = 'Fin-Copilot Workspace') {
  if (!forecast) return;
  const payload = {
    metadata: {
      generatedAt: new Date().toISOString(),
      system: 'Fin-Copilot v2.4 (Statutory Indian MSME Decision Layer)',
      business: workspaceName,
      asOfDate: forecast.asOfDate,
      standards: ['Section 43B(h) Income Tax Act 1961', 'MSMED Act 2006 (45-Day Payment Norm)'],
    },
    riskProfile: forecast.risk,
    cashDeskSummary: forecast.cashDesk,
    dailyProjection: forecast.daily,
  };

  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
  const link = document.createElement('a');
  link.setAttribute('href', dataStr);
  link.setAttribute('download', `FinCopilot_Audit_Dossier_${forecast.asOfDate}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
