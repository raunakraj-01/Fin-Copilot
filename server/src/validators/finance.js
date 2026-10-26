import { z } from 'zod';
import { isDateOnly } from '../utils/dates.js';

export const dateOnly = z.string().refine(isDateOnly, 'Must be a valid YYYY-MM-DD date');
export const paise = z.number().int().safe().nonnegative();
export const workspaceCreate = z.object({
  name: z.string().trim().min(1).max(100), asOfDate: dateOnly,
  openingCashPaise: z.number().int().safe(), minimumReservePaise: paise.default(0),
}).strict();
export const workspacePatch = workspaceCreate.partial().refine(value => Object.keys(value).length > 0, 'No fields supplied');

export const itemInput = z.object({
  category: z.enum(['receivable', 'payable', 'expense']),
  externalId: z.string().trim().max(100).optional(),
  counterparty: z.string().trim().min(1).max(200),
  description: z.string().max(500).optional(),
  sourceSystem: z.enum(['tally_export', 'excel', 'manual', 'csv']).default('manual'),
  amountPaise: paise.positive(), settledPaise: paise.default(0),
  status: z.enum(['open', 'partial', 'paid', 'cancelled']).default('open'),
  dueDate: dateOnly, expectedDate: dateOnly.optional(),
  confidenceState: z.enum(['verified', 'owner_assumption', 'needs_review']).default('owner_assumption'),
  constraints: z.object({
    mandatory: z.boolean().optional(), negotiable: z.boolean().optional(), discretionary: z.boolean().optional(),
    maxExtensionDays: z.number().int().min(0).max(90).optional(), earliestCollectionDate: dateOnly.optional(),
    maxEarlyCollectionPaise: paise.optional(), estimatedActionCostPaise: paise.nullable().optional(),
  }).strict().optional(),
}).strict().refine(item => item.settledPaise <= item.amountPaise, { path: ['settledPaise'], message: 'Cannot exceed amountPaise' })
  .refine(item => item.status !== 'paid' || item.settledPaise === item.amountPaise, { path: ['status'], message: 'Paid item must be fully settled' })
  .refine(item => item.status !== 'open' || item.settledPaise === 0, { path: ['status'], message: 'Partly settled item must have partial status' })
  .refine(item => item.status !== 'partial' || (item.settledPaise > 0 && item.settledPaise < item.amountPaise), { path: ['status'], message: 'Partial item requires a partial settlement' })
  .refine(item => !['open', 'partial'].includes(item.status) || !!item.expectedDate || item.confidenceState === 'needs_review',
    { path: ['expectedDate'], message: 'Open items need an expected date or needs_review status' })
  .refine(item => item.constraints?.maxEarlyCollectionPaise === undefined || item.constraints.maxEarlyCollectionPaise <= item.amountPaise - item.settledPaise,
    { path: ['constraints', 'maxEarlyCollectionPaise'], message: 'Cannot exceed outstanding amount' });
