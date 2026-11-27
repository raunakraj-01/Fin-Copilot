import { randomUUID } from 'node:crypto';
import Workspace from '../../models/Workspace.js';
import CashItem from '../../models/CashItem.js';
import RecurringRule from '../../models/RecurringRule.js';
import BankTransaction from '../../models/BankTransaction.js';
import SyncBatch from '../../models/SyncBatch.js';
import InventoryItem from '../../models/InventoryItem.js';
import OrderScenario from '../../models/OrderScenario.js';
import FulfillmentOrder from '../../models/FulfillmentOrder.js';
import ProcurementRequest from '../../models/ProcurementRequest.js';
import MessageCapture from '../../models/MessageCapture.js';
import CollectionAction from '../../models/CollectionAction.js';
import CollectionFollowUp from '../../models/CollectionFollowUp.js';
import RescuePlan from '../../models/RescuePlan.js';
import PaymentOffer from '../../models/PaymentOffer.js';
import ImportBatch from '../../models/ImportBatch.js';
import SyncConflict from '../../models/SyncConflict.js';
import SyncRun from '../../models/SyncRun.js';
import { addDays } from '../rescue/dates.js';
import { todayIndia } from '../../utils/dates.js';
import { loadDecisionContext, loadSharedForecast } from '../rescue/decisionContext.js';
import { prepareSavedScenario } from '../orders/saveScenario.js';
import { appendAudit } from '../audit.js';

export const DEMO_WORKSPACE_NAME = 'Kalyani Precision Components Pvt Ltd (Demo)';

function clampDayOfMonth(dateStr, fallbackDay) {
  const day = Number(dateStr.slice(8, 10));
  return Number.isInteger(day) && day >= 1 && day <= 28 ? day : fallbackDay;
}

async function clearWorkspaceDemoCollections(workspaceId) {
  await Promise.all([
    CashItem.deleteMany({ workspaceId }),
    RecurringRule.deleteMany({ workspaceId }),
    BankTransaction.deleteMany({ workspaceId }),
    SyncBatch.deleteMany({ workspaceId }),
    SyncConflict.deleteMany({ workspaceId }),
    SyncRun.deleteMany({ workspaceId }),
    InventoryItem.deleteMany({ workspaceId }),
    OrderScenario.deleteMany({ workspaceId }),
    FulfillmentOrder.deleteMany({ workspaceId }),
    ProcurementRequest.deleteMany({ workspaceId }),
    MessageCapture.deleteMany({ workspaceId }),
    CollectionAction.deleteMany({ workspaceId }),
    CollectionFollowUp.deleteMany({ workspaceId }),
    RescuePlan.deleteMany({ workspaceId }),
    PaymentOffer.deleteMany({ workspaceId }),
    ImportBatch.deleteMany({ workspaceId }),
  ]);
}

async function populateIndianMsmeDemoData(workspace, userId) {
  const today = workspace.asOfDate;
  const plus = days => addDays(today, days);
  const minus = days => addDays(today, -days);
  const workspaceId = workspace._id;

  const cashItemDocs = [
    // Open & partial receivables (all expectedDate strictly after asOfDate so Cash Outlook has zero blockers)
    {
      workspaceId,
      category: 'receivable',
      externalId: 'INV/FY27/204',
      counterparty: 'Tata Motors Ancillary Division (Pune)',
      description: 'CNC machined brake caliper brackets — Batch #48',
      sourceSystem: 'tally_export',
      amountPaise: 36_000_000,
      settledPaise: 6_000_000,
      status: 'partial',
      dueDate: minus(4),
      expectedDate: plus(16),
      confidenceState: 'verified',
      constraints: {
        earliestCollectionDate: plus(3),
        maxEarlyCollectionPaise: 20_000_000,
        estimatedActionCostPaise: 250_000,
        actionCostDate: plus(3),
      },
    },
    {
      workspaceId,
      category: 'receivable',
      externalId: 'INV/FY27/211',
      counterparty: 'Sundaram Clayton Precision Ltd',
      description: 'High-pressure die-cast aluminium housings',
      sourceSystem: 'tally_export',
      amountPaise: 24_500_000,
      settledPaise: 0,
      status: 'open',
      dueDate: plus(3),
      expectedDate: plus(18),
      confidenceState: 'verified',
      constraints: {
        earliestCollectionDate: plus(4),
        maxEarlyCollectionPaise: 15_000_000,
        estimatedActionCostPaise: 180_000,
        actionCostDate: plus(4),
      },
    },
    {
      workspaceId,
      category: 'receivable',
      externalId: 'INV/FY27/218',
      counterparty: 'Mahindra & Mahindra Farm Equipment',
      description: 'Tractor hydraulic coupling assemblies',
      sourceSystem: 'tally_export',
      amountPaise: 41_000_000,
      settledPaise: 0,
      status: 'open',
      dueDate: plus(14),
      expectedDate: plus(22),
      confidenceState: 'owner_assumption',
      constraints: {
        earliestCollectionDate: plus(6),
        maxEarlyCollectionPaise: 25_000_000,
        estimatedActionCostPaise: 300_000,
        actionCostDate: plus(6),
      },
    },
    {
      workspaceId,
      category: 'receivable',
      externalId: 'INV/FY27/223',
      counterparty: 'Ashok Leyland Hosur Plant',
      description: 'Heavy-duty transmission shaft sleeves',
      sourceSystem: 'tally_export',
      amountPaise: 19_500_000,
      settledPaise: 0,
      status: 'open',
      dueDate: plus(20),
      expectedDate: plus(28),
      confidenceState: 'verified',
      constraints: {
        earliestCollectionDate: plus(10),
        maxEarlyCollectionPaise: 10_000_000,
        estimatedActionCostPaise: 120_000,
        actionCostDate: plus(10),
      },
    },
    {
      workspaceId,
      category: 'receivable',
      externalId: 'INV/FY27/229',
      counterparty: 'TVS Motor Company Components',
      description: 'Precision gear shifter forks (Lot 2)',
      sourceSystem: 'tally_export',
      amountPaise: 15_000_000,
      settledPaise: 0,
      status: 'open',
      dueDate: plus(25),
      expectedDate: plus(32),
      confidenceState: 'owner_assumption',
      paymentPromises: [
        {
          amountPaise: 7_500_000,
          promisedDate: plus(19),
          receivedPaise: 0,
          history: [
            {
              action: 'created',
              at: new Date(),
              asOfDate: today,
              amountPaise: 7_500_000,
              promisedDate: plus(19),
              note: 'Confirmed by TVS Accounts Payable over email for first tranche',
            },
          ],
        },
      ],
    },
    {
      workspaceId,
      category: 'receivable',
      externalId: 'INV/FY27/234',
      counterparty: 'Godrej & Boyce Manufacturing Co',
      description: 'SS 304 precision machined enclosure locks',
      sourceSystem: 'tally_export',
      amountPaise: 28_000_000,
      settledPaise: 0,
      status: 'open',
      dueDate: plus(30),
      expectedDate: plus(40),
      confidenceState: 'verified',
      constraints: {
        earliestCollectionDate: plus(15),
        maxEarlyCollectionPaise: 14_000_000,
        estimatedActionCostPaise: 150_000,
        actionCostDate: plus(15),
      },
    },
    {
      workspaceId,
      category: 'receivable',
      externalId: 'INV/FY27/240',
      counterparty: 'Blue Star Commercial Systems',
      description: 'Chiller manifold brass fittings',
      sourceSystem: 'tally_export',
      amountPaise: 12_500_000,
      settledPaise: 0,
      status: 'open',
      dueDate: plus(38),
      expectedDate: plus(46),
      confidenceState: 'owner_assumption',
    },

    // Historical paid invoices with verified settlement events (enables Payment Timing Suggestion & Delay Predictor)
    {
      workspaceId,
      category: 'receivable',
      externalId: 'INV/FY27/PAID-TM01',
      counterparty: 'Tata Motors Ancillary Division (Pune)',
      description: 'CNC machined brake caliper brackets — Batch #45',
      sourceSystem: 'tally_export',
      amountPaise: 32_000_000,
      settledPaise: 32_000_000,
      status: 'paid',
      dueDate: minus(65),
      expectedDate: minus(53),
      confidenceState: 'verified',
      settlementEvents: [
        {
          source: 'bank',
          sourceId: 'UTR-HDFC-TM-01',
          direction: 'receipt',
          amountPaise: 32_000_000,
          date: minus(53),
          dueDate: minus(65),
          completedInvoice: true,
          verified: true,
          reference: 'NEFT/HDFC/TATAMOTORS/45',
        },
      ],
    },
    {
      workspaceId,
      category: 'receivable',
      externalId: 'INV/FY27/PAID-TM02',
      counterparty: 'Tata Motors Ancillary Division (Pune)',
      description: 'CNC machined brake caliper brackets — Batch #46',
      sourceSystem: 'tally_export',
      amountPaise: 29_500_000,
      settledPaise: 29_500_000,
      status: 'paid',
      dueDate: minus(38),
      expectedDate: minus(24),
      confidenceState: 'verified',
      settlementEvents: [
        {
          source: 'bank',
          sourceId: 'UTR-HDFC-TM-02',
          direction: 'receipt',
          amountPaise: 29_500_000,
          date: minus(24),
          dueDate: minus(38),
          completedInvoice: true,
          verified: true,
          reference: 'NEFT/HDFC/TATAMOTORS/46',
        },
      ],
    },
    {
      workspaceId,
      category: 'receivable',
      externalId: 'INV/FY27/PAID-TM03',
      counterparty: 'Tata Motors Ancillary Division (Pune)',
      description: 'CNC machined brake caliper brackets — Batch #47',
      sourceSystem: 'tally_export',
      amountPaise: 34_000_000,
      settledPaise: 34_000_000,
      status: 'paid',
      dueDate: minus(20),
      expectedDate: minus(9),
      confidenceState: 'verified',
      settlementEvents: [
        {
          source: 'bank',
          sourceId: 'UTR-HDFC-TM-03',
          direction: 'receipt',
          amountPaise: 34_000_000,
          date: minus(9),
          dueDate: minus(20),
          completedInvoice: true,
          verified: true,
          reference: 'NEFT/HDFC/TATAMOTORS/47',
        },
      ],
    },
    {
      workspaceId,
      category: 'receivable',
      externalId: 'INV/FY27/PAID-SC01',
      counterparty: 'Sundaram Clayton Precision Ltd',
      description: 'Die-cast housings — Lot 14',
      sourceSystem: 'tally_export',
      amountPaise: 21_000_000,
      settledPaise: 21_000_000,
      status: 'paid',
      dueDate: minus(50),
      expectedDate: minus(45),
      confidenceState: 'verified',
      settlementEvents: [
        {
          source: 'bank',
          sourceId: 'UTR-ICIC-SC-01',
          direction: 'receipt',
          amountPaise: 21_000_000,
          date: minus(45),
          dueDate: minus(50),
          completedInvoice: true,
          verified: true,
          reference: 'RTGS/ICIC/SUNDARAM/14',
        },
      ],
    },
    {
      workspaceId,
      category: 'receivable',
      externalId: 'INV/FY27/PAID-SC02',
      counterparty: 'Sundaram Clayton Precision Ltd',
      description: 'Die-cast housings — Lot 15',
      sourceSystem: 'tally_export',
      amountPaise: 23_000_000,
      settledPaise: 23_000_000,
      status: 'paid',
      dueDate: minus(22),
      expectedDate: minus(16),
      confidenceState: 'verified',
      settlementEvents: [
        {
          source: 'bank',
          sourceId: 'UTR-ICIC-SC-02',
          direction: 'receipt',
          amountPaise: 23_000_000,
          date: minus(16),
          dueDate: minus(22),
          completedInvoice: true,
          verified: true,
          reference: 'RTGS/ICIC/SUNDARAM/15',
        },
      ],
    },
    {
      workspaceId,
      category: 'receivable',
      externalId: 'INV/FY27/PAID-MM01',
      counterparty: 'Mahindra & Mahindra Farm Equipment',
      description: 'Hydraulic coupling assemblies — Lot 8',
      sourceSystem: 'tally_export',
      amountPaise: 38_000_000,
      settledPaise: 38_000_000,
      status: 'paid',
      dueDate: minus(60),
      expectedDate: minus(42),
      confidenceState: 'verified',
      settlementEvents: [
        {
          source: 'bank',
          sourceId: 'UTR-SBIN-MM-01',
          direction: 'receipt',
          amountPaise: 38_000_000,
          date: minus(42),
          dueDate: minus(60),
          completedInvoice: true,
          verified: true,
          reference: 'RTGS/SBIN/MAHINDRA/08',
        },
      ],
    },
    {
      workspaceId,
      category: 'receivable',
      externalId: 'INV/FY27/PAID-MM02',
      counterparty: 'Mahindra & Mahindra Farm Equipment',
      description: 'Hydraulic coupling assemblies — Lot 9',
      sourceSystem: 'tally_export',
      amountPaise: 39_500_000,
      settledPaise: 39_500_000,
      status: 'paid',
      dueDate: minus(30),
      expectedDate: minus(11),
      confidenceState: 'verified',
      settlementEvents: [
        {
          source: 'bank',
          sourceId: 'UTR-SBIN-MM-02',
          direction: 'receipt',
          amountPaise: 39_500_000,
          date: minus(11),
          dueDate: minus(30),
          completedInvoice: true,
          verified: true,
          reference: 'RTGS/SBIN/MAHINDRA/09',
        },
      ],
    },

    // Payables & statutory/operational expenses (all expectedDate strictly after asOfDate)
    {
      workspaceId,
      category: 'payable',
      externalId: 'BILL/FY27/104',
      counterparty: 'Bharat Forge & Castings Ltd',
      description: 'Forged steel blanks for caliper brackets',
      sourceSystem: 'tally_export',
      amountPaise: 24_000_000,
      settledPaise: 0,
      status: 'open',
      dueDate: plus(5),
      expectedDate: plus(5),
      confidenceState: 'verified',
      constraints: {
        mandatory: false,
        negotiable: true,
        discretionary: false,
        maxExtensionDays: 20,
        estimatedActionCostPaise: 200_000,
        actionCostDate: plus(20),
      },
    },
    {
      workspaceId,
      category: 'expense',
      externalId: 'OVERHEAD/PAYROLL',
      counterparty: 'Peenya Plant Staff & Machinist Wages',
      description: 'Monthly CNC operator & supervisor payroll',
      sourceSystem: 'tally_export',
      amountPaise: 28_500_000,
      settledPaise: 0,
      status: 'open',
      dueDate: plus(8),
      expectedDate: plus(8),
      confidenceState: 'verified',
      constraints: { mandatory: true, negotiable: false, discretionary: false, maxExtensionDays: 0 },
    },
    {
      workspaceId,
      category: 'expense',
      externalId: 'TAX/GSTR-3B',
      counterparty: 'GSTR-3B Monthly GST Cash Liability',
      description: 'Net outward GST settlement via Electronic Cash Ledger',
      sourceSystem: 'tally_export',
      amountPaise: 13_500_000,
      settledPaise: 0,
      status: 'open',
      dueDate: plus(10),
      expectedDate: plus(10),
      confidenceState: 'verified',
      constraints: { mandatory: true, negotiable: false, discretionary: false, maxExtensionDays: 0 },
    },
    {
      workspaceId,
      category: 'payable',
      externalId: 'BILL/FY27/112',
      counterparty: 'Jindal Stainless Tubes Pvt Ltd',
      description: 'SS 304 bar & seamless tube consignment',
      sourceSystem: 'tally_export',
      amountPaise: 18_000_000,
      settledPaise: 0,
      status: 'open',
      dueDate: plus(11),
      expectedDate: plus(11),
      confidenceState: 'verified',
      constraints: {
        mandatory: false,
        negotiable: true,
        discretionary: false,
        maxExtensionDays: 18,
        estimatedActionCostPaise: 150_000,
        actionCostDate: plus(25),
      },
    },
    {
      workspaceId,
      category: 'expense',
      externalId: 'EXP/IMTEX-STALL',
      counterparty: 'IMTEX Bengaluru Trade Fair Stall Balance',
      description: 'Optional exhibitor pavilion upgrade',
      sourceSystem: 'manual',
      amountPaise: 7_500_000,
      settledPaise: 0,
      status: 'open',
      dueDate: plus(12),
      expectedDate: plus(12),
      confidenceState: 'owner_assumption',
      constraints: { mandatory: false, negotiable: true, discretionary: true, maxExtensionDays: 30 },
    },
    {
      workspaceId,
      category: 'payable',
      externalId: 'BILL/FY27/119',
      counterparty: 'Aditi Corrugated Cartons & Packaging',
      description: '5-ply export corrugated master boxes',
      sourceSystem: 'tally_export',
      amountPaise: 9_200_000,
      settledPaise: 0,
      status: 'open',
      dueDate: plus(18),
      expectedDate: plus(18),
      confidenceState: 'verified',
      constraints: {
        mandatory: false,
        negotiable: true,
        discretionary: false,
        maxExtensionDays: 15,
        estimatedActionCostPaise: 80_000,
        actionCostDate: plus(30),
      },
    },
    {
      workspaceId,
      category: 'payable',
      externalId: 'BILL/FY27/124',
      counterparty: 'SKF Bearings India Distribution',
      description: 'Spindle & precision angular contact bearings',
      sourceSystem: 'tally_export',
      amountPaise: 6_450_000,
      settledPaise: 0,
      status: 'open',
      dueDate: plus(26),
      expectedDate: plus(26),
      confidenceState: 'verified',
      constraints: { mandatory: true, negotiable: false, discretionary: false, maxExtensionDays: 0 },
    },
    {
      workspaceId,
      category: 'payable',
      externalId: 'BILL/FY27/131',
      counterparty: 'Kirloskar Pneumatic Maintenance AMC',
      description: 'Quarterly air compressor & coolant chiller service',
      sourceSystem: 'tally_export',
      amountPaise: 4_800_000,
      settledPaise: 0,
      status: 'open',
      dueDate: plus(35),
      expectedDate: plus(35),
      confidenceState: 'owner_assumption',
      constraints: {
        mandatory: false,
        negotiable: true,
        discretionary: false,
        maxExtensionDays: 14,
        estimatedActionCostPaise: 50_000,
        actionCostDate: plus(45),
      },
    },
    {
      workspaceId,
      category: 'payable',
      externalId: 'BILL/FY27/PAID-01',
      counterparty: 'Mukand Steel Distributors Bengaluru',
      description: 'EN24 alloy steel bar stock (settled)',
      sourceSystem: 'tally_export',
      amountPaise: 14_500_000,
      settledPaise: 14_500_000,
      status: 'paid',
      dueDate: minus(12),
      expectedDate: minus(12),
      confidenceState: 'verified',
    },
  ];

  const createdItems = await CashItem.insertMany(cashItemDocs);
  const tataOpenInvoice = createdItems.find(item => item.externalId === 'INV/FY27/204');
  const paidSteelBill = createdItems.find(item => item.externalId === 'BILL/FY27/PAID-01');

  // Recurring monthly plant overheads
  await RecurringRule.insertMany([
    {
      workspaceId,
      description: 'Peenya Industrial Shed Rent (Phase II)',
      amountPaise: 6_500_000,
      dayOfMonth: clampDayOfMonth(plus(5), 5),
      startsOn: today,
      mandatory: true,
      active: true,
    },
    {
      workspaceId,
      description: 'BESCOM HT Power & Plant Electricity',
      amountPaise: 2_850_000,
      dayOfMonth: clampDayOfMonth(plus(15), 15),
      startsOn: today,
      mandatory: true,
      active: true,
    },
    {
      workspaceId,
      description: 'Tally Prime Cloud & Airtel Leased Line',
      amountPaise: 650_000,
      dayOfMonth: clampDayOfMonth(plus(10), 10),
      startsOn: today,
      mandatory: true,
      active: true,
    },
  ]);

  // Reconciled bank statement rows (already matched/reviewed so 0 blocking BANK_REVIEW issues)
  await BankTransaction.insertMany([
    {
      workspaceId,
      accountKey: 'HDFC-CURRENT-PEENYA',
      transactionId: 'UTR-HDFC-TM-PART-204',
      identity: `HDFC-CURRENT-PEENYA:${minus(3)}:6000000:INV-204`,
      date: minus(3),
      description: 'NEFT CR TATA MOTORS ANCILLARY PARTIAL INV-FY27-204',
      creditPaise: 6_000_000,
      debitPaise: 0,
      reviewState: 'excluded',
      reviewNote: 'Matched and reflected in INV/FY27/204 settled balance and opening bank cash',
      allocations: [
        {
          requestId: randomUUID(),
          cashItemId: tataOpenInvoice._id,
          amountPaise: 6_000_000,
          direction: 'credit',
          status: 'applied',
          at: new Date(),
        },
      ],
    },
    {
      workspaceId,
      accountKey: 'HDFC-CURRENT-PEENYA',
      transactionId: 'UTR-HDFC-MUKAND-145',
      identity: `HDFC-CURRENT-PEENYA:${minus(12)}:14500000:BILL-PAID-01`,
      date: minus(12),
      description: 'RTGS DR MUKAND STEEL DISTRIBUTORS BILL-FY27-PAID-01',
      creditPaise: 0,
      debitPaise: 14_500_000,
      reviewState: 'excluded',
      reviewNote: 'Matched to settled raw material bill BILL/FY27/PAID-01',
      allocations: [
        {
          requestId: randomUUID(),
          cashItemId: paidSteelBill._id,
          amountPaise: 14_500_000,
          direction: 'debit',
          status: 'applied',
          at: new Date(),
        },
      ],
    },
  ]);

  // Fresh Tally sync marker so Data Freshness shows current
  await SyncBatch.create({
    workspaceId,
    companyId: 'Kalyani Precision Components (Tally Prime)',
    batchId: randomUUID(),
    count: cashItemDocs.length,
  });

  // Raw-material & packaging inventory (with 1 item below reorder point for Action Center & Procurement)
  const inventoryItems = await InventoryItem.insertMany([
    {
      workspaceId,
      name: 'EN24 Alloy Steel Bright Bars (32mm)',
      sku: 'RM-EN24-32',
      unit: 'kg',
      supplier: 'Mukand Steel Distributors Bengaluru',
      quantityOnHand: 180,
      reorderPoint: 250,
      reorderQuantity: 500,
      leadTimeDays: 6,
      unitCostPaise: 14_500,
      active: true,
    },
    {
      workspaceId,
      name: 'SS 304 Hexagonal Rod (16mm)',
      sku: 'RM-SS304-16',
      unit: 'kg',
      supplier: 'Jindal Stainless Tubes Pvt Ltd',
      quantityOnHand: 420,
      reorderPoint: 200,
      reorderQuantity: 400,
      leadTimeDays: 8,
      unitCostPaise: 24_000,
      active: true,
    },
    {
      workspaceId,
      name: '5-Ply Corrugated Export Cartons',
      sku: 'PKG-5PLY-EXP',
      unit: 'boxes',
      supplier: 'Aditi Corrugated Cartons & Packaging',
      quantityOnHand: 650,
      reorderPoint: 300,
      reorderQuantity: 1000,
      leadTimeDays: 4,
      unitCostPaise: 4_800,
      active: true,
    },
  ]);

  // Sample supplier quote in Procurement Desk
  const en24Steel = inventoryItems[0];
  await ProcurementRequest.create({
    workspaceId,
    inventoryItemId: en24Steel._id,
    name: en24Steel.name,
    sku: en24Steel.sku,
    unit: en24Steel.unit,
    quantity: 500,
    supplier: en24Steel.supplier,
    supplierPhone: '919845120045',
    estimatedUnitCostPaise: 14_500,
    estimatedAmountPaise: 7_250_000,
    quoteAmountPaise: 7_150_000,
    leadTimeDays: 6,
    paymentTermsDays: 15,
    orderDate: plus(2),
    expectedDeliveryDate: plus(8),
    paymentDueDate: plus(23),
    status: 'quote_received',
    transitions: [
      {
        from: 'draft',
        to: 'quote_received',
        at: new Date(),
        note: 'Quote received from Mukand Steel Bengaluru (₹143/kg, 15 days credit)',
        actorUserId: userId,
      },
    ],
    createdBy: userId,
  });

  // Pending WhatsApp order capture in Action Center
  const deliveryDate = plus(21);
  const advanceDate = plus(3);
  const finalCollectionDate = plus(35);
  await MessageCapture.create({
    workspaceId,
    sourceSystem: 'whatsapp_cloud',
    sourceMessageId: `demo-wa-${randomUUID()}`,
    senderPhone: '919845011223',
    senderName: 'Rajesh Kulkarni (Kulkarni Hydraulics Pune)',
    rawText: `ORDER | Kulkarni Hydraulics Pune | Hydraulic Valve Manifolds | 400 | ${deliveryDate} | 320000 | 96000 | ${advanceDate} | ${finalCollectionDate}`,
    receivedAt: new Date(),
    captureType: 'order',
    parseStatus: 'ready',
    parseIssues: [],
    proposal: {
      kind: 'order',
      customerName: 'Kulkarni Hydraulics Pune',
      itemName: 'Hydraulic Valve Manifolds',
      quantity: 400,
      deliveryDate,
      orderValuePaise: 32_000_000,
      advancePaise: 9_600_000,
      advanceDate,
      finalCollectionDate,
    },
    status: 'pending',
  });

  // Sample collection draft in Operations
  await CollectionAction.create({
    workspaceId,
    cashItemId: tataOpenInvoice._id,
    requestId: randomUUID(),
    type: 'reminder_draft',
    status: 'draft',
    note: 'Polite follow-up prepared for Tata Motors Ancillary Division regarding ₹3,00,000 balance on INV/FY27/204.',
    actorUserId: userId,
  });

  // Saved Order Scenario (with live exact fingerprint) + Fulfillment Order in production
  const [context, buildForecast] = await Promise.all([
    loadDecisionContext(workspaceId),
    loadSharedForecast(),
  ]);
  const scenarioPayload = prepareSavedScenario(context, {
    label: 'Bosch Automotive India · 1,200 × CNC Turned Shafts',
    orderValuePaise: 54_000_000,
    advancePaise: 16_200_000,
    advanceDate: plus(3),
    finalCollectionDate: plus(38),
    costLines: [
      { description: 'EN24 steel bar procurement', amountPaise: 19_500_000, paymentDate: plus(5) },
      { description: 'Nitriding & heat treatment job-work', amountPaise: 6_800_000, paymentDate: plus(14) },
    ],
    delayedCollectionDays: 14,
  }, buildForecast);

  const savedScenario = await OrderScenario.create({
    ...scenarioPayload,
    workspaceId,
    trackingStatus: 'in_production',
    trackingNote: 'CNC turning batch 1 of 2 running on Haas ST-20 line',
    trackingUpdatedAt: new Date(),
    trackingHistory: [
      {
        status: 'accepted',
        note: 'PO #BOSCH/IN/88412 received with 30% advance terms',
        at: new Date(),
        actorUserId: userId,
      },
      {
        status: 'in_production',
        note: 'CNC turning started in Peenya Plant Bay 2',
        at: new Date(),
        actorUserId: userId,
      },
    ],
  });

  await FulfillmentOrder.create({
    workspaceId,
    orderScenarioId: savedScenario._id,
    scenarioLabel: savedScenario.label,
    customerName: 'Bosch Automotive India Ltd',
    phone: '918041209911',
    orderValuePaise: savedScenario.orderValuePaise,
    proposedAdvancePaise: savedScenario.advancePaise,
    advanceAppliedPaise: 0,
    finalBalancePaise: savedScenario.orderValuePaise,
    expectedDeliveryDate: plus(24),
    finalCollectionDate: savedScenario.finalCollectionDate,
    status: 'in_production',
    statusNote: 'Raw material inspection passed; machining underway',
    statusHistory: [
      {
        status: 'accepted',
        note: 'Order tracking started from saved cash analysis',
        at: new Date(),
        actorUserId: userId,
      },
      {
        status: 'in_production',
        note: 'CNC machining started on Bay 2',
        at: new Date(),
        actorUserId: userId,
      },
    ],
  });
}

export async function provisionDemoWorkspace(userId, { reset = false } = {}) {
  const existing = await Workspace.findOne({ ownerUserId: userId, isDemo: true });
  if (existing && !reset) {
    return { workspace: existing, created: false, reset: false };
  }

  const today = todayIndia();
  const baseFields = {
    ownerUserId: userId,
    name: DEMO_WORKSPACE_NAME,
    asOfDate: today,
    openingCashPaise: 42_500_000,
    minimumReservePaise: 15_000_000,
    businessGstin: '29AAACK4829M1Z5',
    isDemo: true,
  };

  let workspace;
  let created = false;
  if (existing) {
    await clearWorkspaceDemoCollections(existing._id);
    Object.assign(existing, baseFields);
    workspace = await existing.save();
  } else {
    workspace = await Workspace.create(baseFields);
    created = true;
  }

  await populateIndianMsmeDemoData(workspace, userId);

  await appendAudit({
    workspaceId: workspace._id,
    userId,
    action: created ? 'workspace.demo_created' : 'workspace.demo_reset',
    entityType: 'workspace',
    entityId: String(workspace._id),
    changedFields: ['isDemo', 'asOfDate', 'openingCashPaise', 'minimumReservePaise'],
  });

  return { workspace, created, reset: !created };
}
