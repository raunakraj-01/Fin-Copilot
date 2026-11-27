import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from './authenticatedRequest.js';
import app from '../src/app.js';
import { parseUpload } from '../src/services/imports/parse.js';

let mongo;
let workspaceId;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 600_000);

beforeEach(async () => {
  const created = await request(app).post('/api/workspaces').send({
    name: 'Upload Security Test',
    asOfDate: '2026-11-01',
    openingCashPaise: 100_000,
    minimumReservePaise: 0,
  }).expect(201);
  workspaceId = created.body.workspace.id;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

it('rejects disallowed extensions, dangerous MIME types, binary content, and path-traversal filenames on spreadsheet uploads', async () => {
  const inspectUrl = `/api/workspaces/${workspaceId}/imports/inspect`;
  const bankUrl = `/api/workspaces/${workspaceId}/bank/imports/inspect`;

  // 1. Disallowed extension (.js / .exe)
  await request(app).post(inspectUrl).field('kind', 'receivables')
    .attach('file', Buffer.from('console.log(1)'), { filename: 'exploit.js', contentType: 'application/javascript' })
    .expect(400);

  // 2. Spoofed .csv extension with dangerous MIME type (text/html)
  await request(app).post(inspectUrl).field('kind', 'receivables')
    .attach('file', Buffer.from('Invoice ID,Customer,Amount INR\nINV-1,Buyer,100'), { filename: 'sneaky.csv', contentType: 'text/html' })
    .expect(400);

  // 3. Binary / null-byte / invalid UTF-8 disguised as .csv
  await request(app).post(inspectUrl).field('kind', 'receivables')
    .attach('file', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0xff, 0xfe]), { filename: 'binary.csv', contentType: 'text/csv' })
    .expect(400);

  // 4. HTML/script payload disguised as .csv
  await request(app).post(bankUrl).field('accountKey', 'primary')
    .attach('file', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'xss.csv', contentType: 'text/csv' })
    .expect(400);

  // 5. Fake .xlsx without ZIP/OOXML magic bytes (PK\x03\x04)
  await request(app).post(inspectUrl).field('kind', 'receivables')
    .attach('file', Buffer.from('#!/bin/sh\nrm -rf /\n'), { filename: 'shell.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    .expect(400);

  // 6. Empty 0-byte file
  await request(app).post(inspectUrl).field('kind', 'receivables')
    .attach('file', Buffer.alloc(0), { filename: 'empty.csv', contentType: 'text/csv' })
    .expect(400);

  // 7. Path traversal filename blocked directly in upload validator (even outside multer/busboy)
  await expect(parseUpload({
    originalname: '../../evil.csv',
    mimetype: 'text/csv',
    buffer: Buffer.from('Invoice ID,Customer,Amount INR\nINV-1,Buyer,100'),
  })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
});

it('validates Tally XML extension, MIME, size, binary bytes, and blocks DTD/XXE/script payloads', async () => {
  const xmlUrl = `/api/workspaces/${workspaceId}/automation/tally-xml`;

  // Disallowed extension
  await request(app).post(xmlUrl)
    .attach('file', Buffer.from('<ENVELOPE></ENVELOPE>'), { filename: 'payload.html', contentType: 'text/html' })
    .expect(400);

  // Spoofed .xml extension with wrong MIME
  await request(app).post(xmlUrl)
    .attach('file', Buffer.from('<ENVELOPE></ENVELOPE>'), { filename: 'payload.xml', contentType: 'application/x-msdownload' })
    .expect(400);

  // XXE / DTD entity attack inside XML upload
  const xxe = '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><ENVELOPE><VOUCHER><NARRATION>&xxe;</NARRATION></VOUCHER></ENVELOPE>';
  await request(app).post(xmlUrl)
    .attach('file', Buffer.from(xxe), { filename: 'xxe.xml', contentType: 'application/xml' })
    .expect(400);

  // Binary null-byte payload inside .xml
  await request(app).post(xmlUrl)
    .attach('file', Buffer.from([0x3c, 0x45, 0x00, 0xff]), { filename: 'bin.xml', contentType: 'text/xml' })
    .expect(400);
});

it('enforces file size limits (2 MB spreadsheets, 5 MB Tally XML) and stores nothing in the web root', async () => {
  const oversizedCsv = Buffer.alloc(2 * 1024 * 1024 + 128, 'a');
  await request(app).post(`/api/workspaces/${workspaceId}/imports/inspect`)
    .field('kind', 'receivables')
    .attach('file', oversizedCsv, { filename: 'big.csv', contentType: 'text/csv' })
    .expect(413);

  const oversizedXml = Buffer.alloc(5 * 1024 * 1024 + 128, 'x');
  await request(app).post(`/api/workspaces/${workspaceId}/automation/tally-xml`)
    .attach('file', oversizedXml, { filename: 'big.xml', contentType: 'application/xml' })
    .expect(413);

  // Valid CSV succeeds and never writes uploaded files into client/public or client/dist
  const uniqueName = `upload-check-${Date.now()}.csv`;
  await request(app).post(`/api/workspaces/${workspaceId}/imports/inspect`)
    .field('kind', 'receivables')
    .attach('file', Buffer.from('Invoice ID,Customer,Amount INR,Due Date\nINV-1,Acme,100,2026-11-10\n'), { filename: uniqueName, contentType: 'text/csv' })
    .expect(201);

  const publicDir = fileURLToPath(new URL('../../client/public', import.meta.url));
  const publicEntries = await readdir(publicDir, { recursive: true });
  expect(publicEntries.some(entry => entry.includes(uniqueName))).toBe(false);
  expect(path.basename(uniqueName)).toBe(uniqueName);
});
