/**
 * Fin-Copilot Statutory Liquidity & Indian MSME Audit Exporter
 * Includes protection against CSV Formula Injection (CWE-1236)
 * and native Tally Prime XML envelope generation.
 */

function sanitizeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Neutralize spreadsheet formula injection characters: =, +, -, @, tab, CR
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

function escapeCsvRow(cols) {
  return cols.map(c => {
    const sanitized = sanitizeCsvCell(c);
    if (/[",\n\r]/.test(sanitized)) {
      return `"${sanitized.replace(/"/g, '""')}"`;
    }
    return sanitized;
  }).join(',');
}

export function exportForecastToCsv(forecast, workspaceName = 'Fin-Copilot Workspace') {
  if (!forecast || !forecast.daily) return;

  const headerRows = [
    ['FIN-COPILOT STATUTORY LIQUIDITY AUDIT SCHEDULE'],
    ['Business Name', workspaceName],
    ['As-Of Date', forecast.asOfDate],
    ['Opening Liquid Cash (INR)', (forecast.openingCashPaise / 100).toFixed(2)],
    ['Required Safety Reserve (INR)', ((forecast.minimumReservePaise || 0) / 100).toFixed(2)],
    ['Worst Projected Balance (INR)', (forecast.risk.worstCashPaise / 100).toFixed(2)],
    ['Worst Projected Date', forecast.risk.worstDate || 'N/A'],
    ['First Negative Breach Date', forecast.risk.firstNegativeDate || 'None in 90 Days'],
    ['Compliance Standard', 'Section 43B(h) Income Tax Act 1961 & MSMED Act 2006'],
    [''],
    ['Date', 'Opening Cash (INR)', 'Daily Inflow (INR)', 'Daily Outflow (INR)', 'Closing Cash (INR)', 'Reserve Status', 'Scheduled Events'],
  ];

  const dataRows = forecast.daily.map(d => {
    const inflow = (d.events || []).filter(e => e.direction === 'in').reduce((s, e) => s + e.amountPaise, 0);
    const outflow = (d.events || []).filter(e => e.direction === 'out').reduce((s, e) => s + e.amountPaise, 0);
    const closing = d.closingCashPaise;
    const opening = closing - inflow + outflow;
    const reserveStatus = closing < 0 ? 'CRITICAL DEFICIT' : closing < (forecast.minimumReservePaise || 0) ? 'RESERVE BREACH' : 'SOLVENT';
    const eventSummary = (d.events || []).map(e => `${e.externalId || e.counterparty || 'Event'}: ${(e.amountPaise / 100).toFixed(0)} (${e.direction})`).join('; ');

    return [
      d.date,
      (opening / 100).toFixed(2),
      (inflow / 100).toFixed(2),
      (outflow / 100).toFixed(2),
      (closing / 100).toFixed(2),
      reserveStatus,
      eventSummary,
    ];
  });

  const csvRows = [...headerRows, ...dataRows].map(r => escapeCsvRow(r));
  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csvRows.join('\r\n'));
  const link = document.createElement('a');
  link.setAttribute('href', csvContent);
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
      standards: ['Section 43B(h) Income Tax Act 1961', 'MSMED Act 2006 (45-Day Payment Norm)', 'RBI Master Direction on Priority Sector MSME'],
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

/**
 * Tally Prime XML Export
 * Generates an XML payload conforming to Tally.ERP 9 / Tally Prime XML Import format.
 * Enables Indian CAs and accountants to load the liquidity commitments directly into Tally.
 */
export function exportToTallyXml(forecast, workspaceName = 'Fin-Copilot Workspace') {
  if (!forecast || !forecast.daily) return;

  const events = forecast.daily.flatMap(d => d.events || []);
  const dateFormatted = forecast.asOfDate.replace(/-/g, '');

  let vouchersXml = '';
  events.forEach((ev, idx) => {
    const vDate = (ev.date || forecast.asOfDate).replace(/-/g, '');
    const amount = (ev.amountPaise / 100).toFixed(2);
    const vType = ev.direction === 'in' ? 'Receipt' : 'Payment';
    const ledger = ev.counterparty || ev.description || (ev.direction === 'in' ? 'Sundry Debtors' : 'Sundry Creditors');

    vouchersXml += `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="${vType}" ACTION="Create" OBJVIEW="Accounting Voucher View">
          <DATE>${vDate}</DATE>
          <VOUCHERTYPENAME>${vType}</VOUCHERTYPENAME>
          <VOUCHERNUMBER>FC-${vDate}-${idx + 1}</VOUCHERNUMBER>
          <NARRATION>Fin-Copilot forecast commitment: ${ev.externalId || 'Scheduled'}</NARRATION>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${ledger}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${ev.direction === 'in' ? 'No' : 'Yes'}</ISDEEMEDPOSITIVE>
            <AMOUNT>${ev.direction === 'in' ? amount : `-${amount}`}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Bank Account</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${ev.direction === 'in' ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
            <AMOUNT>${ev.direction === 'in' ? `-${amount}` : amount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>`;
  });

  const tallyXml = `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${workspaceName.replace(/[<>&]/g, '')}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        ${vouchersXml}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

  const dataStr = 'data:application/xml;charset=utf-8,' + encodeURIComponent(tallyXml);
  const link = document.createElement('a');
  link.setAttribute('href', dataStr);
  link.setAttribute('download', `FinCopilot_TallyPrime_Export_${dateFormatted}.xml`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
