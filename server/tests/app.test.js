import { expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

it('serves the health route and marks decision modules as pending', async () => {
  await request(app).get('/api/health').expect(200, { ok: true });
  const response = await request(app).post('/api/workspaces/demo/rescue/analyze').expect(501);
  expect(response.body.error.code).toBe('NOT_IMPLEMENTED');
  await request(app).get('/api/workspaces/not-an-id/forecast').expect(404);
  const oversized = await request(app).post('/api/workspaces/demo/imports/inspect')
    .field('kind', 'receivables').attach('file', Buffer.alloc(2 * 1024 * 1024 + 1), 'large.csv').expect(413);
  expect(oversized.body.error.code).toBe('UPLOAD_TOO_LARGE');
});
