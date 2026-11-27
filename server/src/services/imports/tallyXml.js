/**
 * TallyPrime XML Voucher & Master Parser
 * Parses standard Tally.ERP 9 and TallyPrime XML export documents (<ENVELOPE><BODY>...)
 * into strongly-typed, integer-paise financial items for Fin-Copilot.
 */

function decodeXmlEntities(text) {
  if (!text) return '';
  return String(text)
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function parseTallyAmount(raw) {
  if (typeof raw !== 'string') return NaN;
  const cleaned = decodeXmlEntities(raw).trim().replace(/,/g, '').replace(/\s+(?:Dr|Cr)\.?$/i, '');
  if (!cleaned || !/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)) return NaN;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : NaN;
}

export function parseTallyXml(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') {
    throw new Error('Valid XML string is required');
  }

  // Extract Company Name
  const companyMatch = xmlString.match(/<SVCURRENTCOMPANY>(.*?)<\/SVCURRENTCOMPANY>/i);
  const companyName = companyMatch ? decodeXmlEntities(companyMatch[1]).trim() : 'Tally Company';

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
    const rawType = decodeXmlEntities(typeTagMatch ? typeTagMatch[1] : typeAttrMatch ? typeAttrMatch[1] : 'Receipt').trim();

    // Determine Date (Tally format YYYYMMDD -> YYYY-MM-DD)
    const dateMatch = voucherBody.match(/<DATE>(.*?)<\/DATE>/i);
    let dateStr = new Date().toISOString().slice(0, 10);
    if (dateMatch) {
      const rawDate = decodeXmlEntities(dateMatch[1]).trim();
      if (/^\d{8}$/.test(rawDate)) {
        dateStr = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        dateStr = rawDate;
      }
    }

    // Voucher Number
    const vNumMatch = voucherBody.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i);
    const voucherNumber = vNumMatch ? decodeXmlEntities(vNumMatch[1]).trim() : `TALLY-${Date.now()}-${vouchers.length + 1}`;

    // Narration
    const narMatch = voucherBody.match(/<NARRATION>(.*?)<\/NARRATION>/i);
    const narration = narMatch ? decodeXmlEntities(narMatch[1]).trim() : '';

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
        const parsedAmount = parseTallyAmount(amtMatch[1]);
        if (Number.isFinite(parsedAmount)) {
          entries.push({
            ledgerName: decodeXmlEntities(nameMatch[1]).trim(),
            amount: parsedAmount,
            isPositive: posMatch ? decodeXmlEntities(posMatch[1]).trim().toLowerCase() === 'yes' : false,
          });
        }
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

    if (Number.isSafeInteger(amountPaise) && amountPaise > 0) {
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
