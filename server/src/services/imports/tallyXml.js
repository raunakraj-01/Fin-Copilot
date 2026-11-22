/**
 * TallyPrime XML Voucher & Master Parser
 * Parses standard Tally.ERP 9 and TallyPrime XML export documents (<ENVELOPE><BODY>...)
 * into strongly-typed, integer-paise financial items for Fin-Copilot.
 */

export function parseTallyXml(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') {
    throw new Error('Valid XML string is required');
  }

  // Extract Company Name
  const companyMatch = xmlString.match(/<SVCURRENTCOMPANY>(.*?)<\/SVCURRENTCOMPANY>/i);
  const companyName = companyMatch ? companyMatch[1].trim() : 'Tally Company';

  // Extract all <VOUCHER> blocks
  const voucherRegex = /<VOUCHER\b([^>]*)>([\s\S]*?)<\/VOUCHER>/gi;
  const vouchers = [];
  let match;

  while ((match = voucherRegex.exec(xmlString)) !== null) {
    const voucherAttrs = match[1];
    const voucherBody = match[2];

    // Determine Voucher Type
    const typeAttrMatch = voucherAttrs.match(/VCHTYPE="([^"]+)"/i);
    const typeTagMatch = voucherBody.match(/<VOUCHERTYPENAME>(.*?)<\/VOUCHERTYPENAME>/i);
    const rawType = (typeTagMatch ? typeTagMatch[1] : typeAttrMatch ? typeAttrMatch[1] : 'Receipt').trim();

    // Determine Date (Tally format YYYYMMDD -> YYYY-MM-DD)
    const dateMatch = voucherBody.match(/<DATE>(.*?)<\/DATE>/i);
    let dateStr = new Date().toISOString().slice(0, 10);
    if (dateMatch) {
      const rawDate = dateMatch[1].trim();
      if (/^\d{8}$/.test(rawDate)) {
        dateStr = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        dateStr = rawDate;
      }
    }

    // Voucher Number
    const vNumMatch = voucherBody.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i);
    const voucherNumber = vNumMatch ? vNumMatch[1].trim() : `TALLY-${Date.now()}-${vouchers.length + 1}`;

    // Narration
    const narMatch = voucherBody.match(/<NARRATION>(.*?)<\/NARRATION>/i);
    const narration = narMatch ? narMatch[1].trim() : '';

    // Extract Ledger Entries
    const ledgerRegex = /<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/gi;
    let ledgerMatch;
    const entries = [];

    while ((ledgerMatch = ledgerRegex.exec(voucherBody)) !== null) {
      const entryBody = ledgerMatch[1];
      const nameMatch = entryBody.match(/<LEDGERNAME>(.*?)<\/LEDGERNAME>/i);
      const amtMatch = entryBody.match(/<AMOUNT>(.*?)<\/AMOUNT>/i);
      const posMatch = entryBody.match(/<ISDEEMEDPOSITIVE>(.*?)<\/ISDEEMEDPOSITIVE>/i);

      if (nameMatch && amtMatch) {
        entries.push({
          ledgerName: nameMatch[1].trim(),
          amount: parseFloat(amtMatch[1].trim()),
          isPositive: posMatch ? posMatch[1].trim().toLowerCase() === 'yes' : false,
        });
      }
    }

    // Identify non-bank counterparty ledger and transaction amount
    const bankLedgerKeywords = ['bank', 'cash', 'petty cash', 'hdfc', 'sbi', 'icici', 'axis', 'kotak'];
    const counterpartyEntry = entries.find(e => 
      !bankLedgerKeywords.some(keyword => e.ledgerName.toLowerCase().includes(keyword))
    ) || entries[0];

    const absAmountInr = counterpartyEntry ? Math.abs(counterpartyEntry.amount) : 0;
    const amountPaise = Math.round(absAmountInr * 100);

    // Map voucher type to direction and category
    // In Tally: Receipt / Sales = Inflow (Receivable), Payment / Purchase = Outflow (Payable)
    const isReceivable = ['receipt', 'sales', 'sale'].some(t => rawType.toLowerCase().includes(t));
    const category = isReceivable ? 'receivable' : 'payable';

    // Extract invoice identity from narration if formatted
    const invMatch = narration.match(/(?:INV|BILL)-[A-Za-z0-9_-]+/i);
    const externalId = invMatch ? invMatch[0] : voucherNumber;

    if (amountPaise > 0) {
      vouchers.push({
        rawType,
        category,
        voucherNumber,
        externalId,
        counterparty: counterpartyEntry ? counterpartyEntry.ledgerName : 'Sundry Party',
        amountPaise,
        date: dateStr,
        dueDate: dateStr,
        expectedDate: dateStr,
        narration,
        sourceSystem: 'tally_export',
      });
    }
  }

  return {
    companyName,
    voucherCount: vouchers.length,
    vouchers,
  };
}
