import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from './authenticatedRequest.js';
import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import app from '../src/app.js';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';
import { parseTallyXml } from '../src/services/imports/tallyXml.js';

let mongo, workspaceId;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 600000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await CashItem.deleteMany({});
  await Workspace.deleteMany({});
  const ws = await Workspace.create({
    name: 'Automation Test Co',
    asOfDate: '2026-11-20',
    openingCashPaise: 25000000,
    minimumReservePaise: 5000000,
  });
  workspaceId = String(ws._id);
});

const sampleTallyXml = `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>Fin-Copilot Test Workspace</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Receipt" ACTION="Create">
            <DATE>20261126</DATE>
            <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
            <VOUCHERNUMBER>FC-20261126-1</VOUCHERNUMBER>
            <NARRATION>Fin-Copilot forecast commitment: INV-R100</NARRATION>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Acme Retail Pvt Ltd</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>400000.00</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Bank Account</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-400000.00</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Payment" ACTION="Create">
            <DATE>20261129</DATE>
            <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
            <VOUCHERNUMBER>FC-20261129-2</VOUCHERNUMBER>
            <NARRATION>Fin-Copilot forecast commitment: BILL-P202</NARRATION>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Monthly Rent</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-50000.00</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Bank Account</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>50000.00</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

it('parses Tally XML accurately into discrete integer paise structures', () => {
  const result = parseTallyXml(sampleTallyXml);
  expect(result.companyName).toBe('Fin-Copilot Test Workspace');
  expect(result.voucherCount).toBe(2);

  const receipt = result.vouchers[0];
  expect(receipt.category).toBe('receivable');
  expect(receipt.counterparty).toBe('Acme Retail Pvt Ltd');
  expect(receipt.amountPaise).toBe(40000000); // ₹4,00,000 in integer paise
  expect(receipt.date).toBe('2026-11-26');
  expect(receipt.externalId).toBe('INV-R100');

  const payment = result.vouchers[1];
  expect(payment.category).toBe('payable');
  expect(payment.counterparty).toBe('Monthly Rent');
  expect(payment.amountPaise).toBe(5000000); // ₹50,000 in integer paise
  expect(payment.date).toBe('2026-11-29');
});

it('ingests Tally XML via POST /automation/tally-xml and updates database records', async () => {
  const res = await request(app)
    .post(`/api/workspaces/${workspaceId}/automation/tally-xml`)
    .send({ xml: sampleTallyXml })
    .expect(201);

  expect(res.body.success).toBe(true);
  expect(res.body.appliedCount).toBe(2);
  expect(res.body.company).toBe('Fin-Copilot Test Workspace');

  // Verify records in CashItem
  const items = await CashItem.find({ workspaceId }).sort({ amountPaise: -1 });
  expect(items).toHaveLength(2);
  expect(items[0].counterparty).toBe('Acme Retail Pvt Ltd');
  expect(items[0].amountPaise).toBe(40000000);
  expect(items[0].category).toBe('receivable');
  expect(items[1].counterparty).toBe('Monthly Rent');
  expect(items[1].amountPaise).toBe(5000000);
  expect(items[1].category).toBe('payable');
});

it('generates an executive morning brief via GET /automation/morning-brief', async () => {
  // Ingest sample data first
  await request(app)
    .post(`/api/workspaces/${workspaceId}/automation/tally-xml`)
    .send({ xml: sampleTallyXml })
    .expect(201);

  const res = await request(app)
    .get(`/api/workspaces/${workspaceId}/automation/morning-brief`)
    .expect(200);

  expect(res.body).toHaveProperty('metrics');
  expect(res.body.metrics.openingCashPaise).toBe(25000000);
  expect(res.body.metrics.safeToSpendPaise).toBeGreaterThan(0);
  expect(res.body.whatsappText).toContain('Fin-Copilot Morning Cash Brief');
  expect(res.body.whatsappText).toContain('Opening Cash:');
  expect(res.body.whatsappUrl).toContain('https://wa.me/?text=');
});

it('triggers automated follow-up cycles via POST /automation/run-cycle', async () => {
  const res = await request(app)
    .post(`/api/workspaces/${workspaceId}/automation/run-cycle`)
    .expect(200);

  expect(res.body.success).toBe(true);
  expect(res.body).toHaveProperty('executedAt');
  expect(Array.isArray(res.body.jobs)).toBe(true);
});
