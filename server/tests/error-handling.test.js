import request from 'supertest';
import mongoose from 'mongoose';
import { afterEach, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { errorResponse, fail } from '../src/utils/http.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  return res;
}

it('hides stack traces, file paths, and raw messages on unexpected errors while logging full details server-side', () => {
  const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const err = new Error('ENOENT: no such file or directory, open /Users/secret/server/src/db.js');
  err.stack = 'Error: ENOENT\n    at Object.<anonymous> (/Users/secret/server/src/app.js:99:11)';
  err.status = 500;
  const res = mockRes();

  errorResponse(err, { method: 'GET', originalUrl: '/api/test' }, res, () => {});

  expect(res.statusCode).toBe(500);
  expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  expect(JSON.stringify(res.body)).not.toContain('/Users/secret');
  expect(JSON.stringify(res.body)).not.toContain('ENOENT');
  expect(JSON.stringify(res.body)).not.toContain('at Object');
  expect(logSpy).toHaveBeenCalledWith('[ErrorHandler]', expect.objectContaining({
    method: 'GET',
    path: '/api/test',
    message: err.message,
    stack: err.stack,
  }));
});

it('masks raw Mongoose CastError, ValidationError, and MongoServerError details from clients while logging them', () => {
  const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  const castErr = new mongoose.Error.CastError('ObjectId', 'bad-id', '_id');
  const castRes = mockRes();
  errorResponse(castErr, { method: 'GET', originalUrl: '/api/items/bad-id' }, castRes, () => {});
  expect(castRes.statusCode).toBe(400);
  expect(castRes.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data' } });
  expect(JSON.stringify(castRes.body)).not.toContain('ObjectId');

  const valErr = new Error('CashItem validation failed: amountPaise: Path `amountPaise` is required.');
  valErr.name = 'ValidationError';
  const valRes = mockRes();
  errorResponse(valErr, { method: 'POST', originalUrl: '/api/items' }, valRes, () => {});
  expect(valRes.statusCode).toBe(400);
  expect(valRes.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data' } });
  expect(JSON.stringify(valRes.body)).not.toContain('CashItem');

  const mongoErr = new Error('E11000 duplicate key error collection: prod.users index: email_1');
  mongoErr.name = 'MongoServerError';
  const mongoRes = mockRes();
  errorResponse(mongoErr, { method: 'POST', originalUrl: '/api/workspaces' }, mongoRes, () => {});
  expect(mongoRes.statusCode).toBe(500);
  expect(mongoRes.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  expect(JSON.stringify(mongoRes.body)).not.toContain('prod.users');

  expect(logSpy).toHaveBeenCalledTimes(3);
});

it('still returns curated operational errors created via fail() and logs 5xx operational errors', () => {
  const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const res400 = mockRes();
  try { fail(400, 'VALIDATION_ERROR', 'Expected date must be in YYYY-MM-DD format'); }
  catch (err) { errorResponse(err, { method: 'POST', originalUrl: '/api/items' }, res400, () => {}); }
  expect(res400.statusCode).toBe(400);
  expect(res400.body.error.message).toBe('Expected date must be in YYYY-MM-DD format');
  expect(logSpy).not.toHaveBeenCalled();

  const res503 = mockRes();
  try { fail(503, 'PAYMENTS_UNAVAILABLE', 'Service credentials unavailable'); }
  catch (err) { errorResponse(err, { method: 'POST', originalUrl: '/api/offers' }, res503, () => {}); }
  expect(res503.statusCode).toBe(503);
  expect(res503.body.error.code).toBe('PAYMENTS_UNAVAILABLE');
  expect(logSpy).toHaveBeenCalledTimes(1);
});

it('rejects malformed JSON bodies with a generic validation message rather than raw parser details', async () => {
  const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send('{"email": broken-json')
    .expect(400);

  expect(response.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON request body' } });
  expect(JSON.stringify(response.body)).not.toContain('Unexpected token');
  expect(logSpy).toHaveBeenCalled();
});
