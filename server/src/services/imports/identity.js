import { createHash } from 'node:crypto';
export const canonicalId = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const invoiceIdentity = item => digest([item.category, canonicalId(item.externalId)]);
