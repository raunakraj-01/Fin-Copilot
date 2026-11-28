/**
 * TallyPrime XML Voucher & Master Parser
 * Parses standard Tally.ERP 9 and TallyPrime XML export documents (<ENVELOPE><BODY>...)
 * using linear-time block scanning (no catastrophic regex backtracking) into integer-paise items.
 */

const MAX_VOUCHERS = 5000;
const MAX_LEDGER_ENTRIES_PER_VOUCHER = 200;

function decodeXmlEntities(text) {
  if (!text) return '';
  return String(text)
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
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

/**
 * Extract `<TAG ...>body</TAG>` blocks in linear O(N) time without regex backtracking.
 */
function extractTagBlocks(source, tagName, maxBlocks, withAttributes = false) {
  const lower = source.toLowerCase();
  const openToken = `<${tagName.toLowerCase()}`;
  const closeToken = `</${tagName.toLowerCase()}>`;
  const blocks = [];
  let cursor = 0;

  while (cursor < source.length && blocks.length < maxBlocks) {
    const start = lower.indexOf(openToken, cursor);
    if (start === -1) break;

    const afterName = lower[start + openToken.length];
    if (afterName !== '>' && afterName !== ' ' && afterName !== '\t' && afterName !== '\r' && afterName !== '\n') {
      cursor = start + openToken.length;
      continue;
    }

    const openEnd = source.indexOf('>', start + openToken.length);
    if (openEnd === -1) break;

    const closeStart = lower.indexOf(closeToken, openEnd + 1);
    if (closeStart === -1) break;

    const body = source.slice(openEnd + 1, closeStart);
    if (withAttributes) {
      const attrs = source.slice(start + openToken.length, openEnd);
      blocks.push({ attrs, body });
    } else {
      blocks.push(body);
    }
    cursor = closeStart + closeToken.length;
  }

  return blocks;
}

/**
 * Extract the text inside the first `<TAG>...</TAG>` occurrence in linear time.
 */
function extractSingleTagText(source, tagName) {
  const lower = source.toLowerCase();
  const open = `<${tagName.toLowerCase()}>`;
  const close = `</${tagName.toLowerCase()}>`;
  const start = lower.indexOf(open);
  if (start === -1) return null;
  const bodyStart = start + open.length;
  const end = lower.indexOf(close, bodyStart);
  if (end === -1) return null;
  return source.slice(bodyStart, end);
}

export function parseTallyXml(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') {
    throw new Error('Valid XML string is required');
  }

  const rawCompany = extractSingleTagText(xmlString, 'SVCURRENTCOMPANY');
  const companyName = rawCompany ? decodeXmlEntities(rawCompany).trim() : 'Tally Company';

  const voucherBlocks = extractTagBlocks(xmlString, 'VOUCHER', MAX_VOUCHERS, true);
  const vouchers = [];

  for (const { attrs: voucherAttrs, body: voucherBody } of voucherBlocks) {
    const typeAttrMatch = voucherAttrs.match(/VCHTYPE="([^"]{1,120})"/i);
    const rawTypeTag = extractSingleTagText(voucherBody, 'VOUCHERTYPENAME');
    const rawType = decodeXmlEntities(rawTypeTag ?? (typeAttrMatch ? typeAttrMatch[1] : 'Receipt')).trim();

    const rawDateTag = extractSingleTagText(voucherBody, 'DATE');
    let dateStr = new Date().toISOString().slice(0, 10);
    if (rawDateTag) {
      const rawDate = decodeXmlEntities(rawDateTag).trim();
      if (/^\d{8}$/.test(rawDate)) {
        dateStr = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        dateStr = rawDate;
      }
    }

    const rawVoucherNum = extractSingleTagText(voucherBody, 'VOUCHERNUMBER');
    const voucherNumber = rawVoucherNum ? decodeXmlEntities(rawVoucherNum).trim() : `TALLY-${Date.now()}-${vouchers.length + 1}`;

    const rawNarration = extractSingleTagText(voucherBody, 'NARRATION');
    const narration = rawNarration ? decodeXmlEntities(rawNarration).trim() : '';

    const ledgerBlocks = extractTagBlocks(voucherBody, 'ALLLEDGERENTRIES.LIST', MAX_LEDGER_ENTRIES_PER_VOUCHER, false);
    const entries = [];

    for (const entryBody of ledgerBlocks) {
      const rawName = extractSingleTagText(entryBody, 'LEDGERNAME');
      const rawAmt = extractSingleTagText(entryBody, 'AMOUNT');
      const rawPos = extractSingleTagText(entryBody, 'ISDEEMEDPOSITIVE');

      if (rawName != null && rawAmt != null) {
        const parsedAmount = parseTallyAmount(rawAmt);
        if (Number.isFinite(parsedAmount)) {
          entries.push({
            ledgerName: decodeXmlEntities(rawName).trim(),
            amount: parsedAmount,
            isPositive: rawPos ? decodeXmlEntities(rawPos).trim().toLowerCase() === 'yes' : false,
          });
        }
      }
    }

    const bankLedgerKeywords = ['bank', 'cash', 'petty cash', 'hdfc', 'sbi', 'icici', 'axis', 'kotak'];
    const counterpartyEntry = entries.find(e =>
      !bankLedgerKeywords.some(keyword => e.ledgerName.toLowerCase().includes(keyword))
    ) || entries[0];

    const absAmountInr = counterpartyEntry ? Math.abs(counterpartyEntry.amount) : 0;
    const amountPaise = Math.round(absAmountInr * 100);

    const isReceivable = ['receipt', 'sales', 'sale'].some(t => rawType.toLowerCase().includes(t));
    const category = isReceivable ? 'receivable' : 'payable';

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
