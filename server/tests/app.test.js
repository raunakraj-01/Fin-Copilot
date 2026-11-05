import { expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

it('serves the health route and mounts decision modules', async () => {
  const health = await request(app).get('/api/health').set('Origin', 'http://localhost:5173').expect(200, { ok: true });
  expect(health.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  const rescue = await request(app).post('/api/workspaces/0123456789abcdef01234567/rescue/analyze').send({ objective: 'nonnegative' }).expect(401);
  expect(rescue.body.error.code).toBe('UNAUTHORIZED');
  const orders = await request(app).post('/api/workspaces/0123456789abcdef01234567/orders/analyze').send({}).expect(401);
  expect(orders.body.error.code).toBe('UNAUTHORIZED');
  await request(app).get('/api/workspaces/not-an-id/forecast').expect(404);
  // Authentication is checked before parsing financial uploads.
  await request(app).post('/api/workspaces/0123456789abcdef01234567/imports/inspect')
    .field('kind', 'receivables').attach('file', Buffer.from('x'), 'small.csv').expect(401);
});
