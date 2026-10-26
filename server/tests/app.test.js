import { expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

it('serves the health route and marks decision modules as pending', async () => {
  await request(app).get('/api/health').expect(200, { ok: true });
  const response = await request(app).post('/api/workspaces/demo/rescue/analyze').expect(501);
  expect(response.body.error.code).toBe('NOT_IMPLEMENTED');
});
