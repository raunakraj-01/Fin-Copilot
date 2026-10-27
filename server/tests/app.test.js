import { expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

it('serves the health route and mounts decision modules', async () => {
  const health = await request(app).get('/api/health').set('Origin', 'http://localhost:5173').expect(200, { ok: true });
  expect(health.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  const rescue = await request(app).post('/api/workspaces/demo/rescue/analyze').send({ objective: 'nonnegative' }).expect(400);
  expect(rescue.body.error.code).toBe('VALIDATION_ERROR');
  const orders = await request(app).post('/api/workspaces/demo/orders/analyze').send({}).expect(400);
  expect(orders.body.error.code).toBe('VALIDATION_ERROR');
  await request(app).get('/api/workspaces/not-an-id/forecast').expect(404);
  const oversized = await request(app).post('/api/workspaces/demo/imports/inspect')
    .field('kind', 'receivables').attach('file', Buffer.alloc(2 * 1024 * 1024 + 1), 'large.csv').expect(413);
  expect(oversized.body.error.code).toBe('UPLOAD_TOO_LARGE');
  const unexpected = await request(app).post('/api/workspaces/demo/imports/inspect')
    .field('kind', 'receivables').attach('other', Buffer.from('x'), 'small.csv').expect(400);
  expect(unexpected.body.error.code).toBe('VALIDATION_ERROR');
});
