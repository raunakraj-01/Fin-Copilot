import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import AuthAttempt from '../src/models/AuthAttempt.js';
import AuthSession from '../src/models/AuthSession.js';
import User from '../src/models/User.js';
import { resetRateLimiters } from '../src/middleware/rateLimit.js';
import { RateLimitConfigError, validateRateLimitConfig, validateRateLimitEnv } from '../src/config/rateLimits.js';

let mongo;
let seq = 0;
const password = 'Long test password 42!';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(), AuthSession.init(), AuthAttempt.init()]);
}, 600_000);

beforeEach(async () => {
  await AuthAttempt.deleteMany({});
  resetRateLimiters();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

async function registerUser(ip = '198.51.100.10') {
  const email = `ratelimit-${++seq}@example.test`;
  const res = await request(app)
    .post('/api/auth/register')
    .set('X-Forwarded-For', ip)
    .send({ name: 'Test User', email, password })
    .expect(201);
  return { email, cookie: res.headers['set-cookie'][0].split(';')[0], csrfToken: res.body.csrfToken };
}

it('enforces configurable per-account exponential backoff without hard lockout and clears on login success', async () => {
  vi.stubEnv('RATE_LIMIT_AUTH_ACCOUNT_MAX', '2');
  vi.stubEnv('RATE_LIMIT_AUTH_IP_MAX', '50');
  vi.stubEnv('RATE_LIMIT_AUTH_BACKOFF_BASE_MS', '5000');
  vi.stubEnv('RATE_LIMIT_AUTH_BACKOFF_MAX_MS', '15000');

  const user = await registerUser('203.0.113.1');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));

  // Attempts 1 & 2 fail with 401; 2nd failure triggers initial 5s backoff.
  const first = await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.2').send({ email: user.email, password: 'wrong' }).expect(401);
  expect(first.headers['ratelimit-remaining']).toBe('1');
  const second = await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.2').send({ email: user.email, password: 'wrong' }).expect(401);
  expect(second.headers['ratelimit-remaining']).toBe('0');

  // Immediate retry with even the RIGHT password is blocked with 5s Retry-After.
  const blocked1 = await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.2').send({ email: user.email, password }).expect(429);
  expect(Number(blocked1.headers['retry-after'])).toBe(5);

  // After 5s passes, the account is NOT permanently locked; another wrong password doubles backoff to 10s.
  vi.advanceTimersByTime(5001);
  await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.2').send({ email: user.email, password: 'wrong' }).expect(401);
  const blocked2 = await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.2').send({ email: user.email, password }).expect(429);
  expect(Number(blocked2.headers['retry-after'])).toBe(10);

  // After 10s passes, another failure caps at maxBackoffMs (15s instead of 20s).
  vi.advanceTimersByTime(10001);
  await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.2').send({ email: user.email, password: 'wrong' }).expect(401);
  const blocked3 = await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.2').send({ email: user.email, password }).expect(429);
  expect(Number(blocked3.headers['retry-after'])).toBe(15);

  // After 15s cooldown expires, valid credentials succeed and reset the account failure counter.
  vi.advanceTimersByTime(15001);
  await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.2').send({ email: user.email, password }).expect(200);
  await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.2').send({ email: user.email, password: 'wrong' }).expect(401);
}, 20_000);

it('combines per-IP and per-account limits across distributed IPs and credential-stuffing IPs, including signup', async () => {
  vi.stubEnv('RATE_LIMIT_AUTH_ACCOUNT_MAX', '2');
  vi.stubEnv('RATE_LIMIT_AUTH_IP_MAX', '3');
  vi.stubEnv('RATE_LIMIT_AUTH_REGISTER_IP_MAX', '2');
  vi.stubEnv('RATE_LIMIT_AUTH_BACKOFF_BASE_MS', '4000');

  // Distributed IPs attacking one email hit the per-account threshold (2).
  await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.1').send({ email: 'target@example.test', password: 'wrong' }).expect(401);
  await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.2').send({ email: 'target@example.test', password: 'wrong' }).expect(401);
  await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.3').send({ email: 'target@example.test', password: 'wrong' }).expect(429);

  // Single IP spraying distinct emails hits the per-IP threshold (3).
  await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.99').send({ email: 'a@example.test', password: 'wrong' }).expect(401);
  await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.99').send({ email: 'b@example.test', password: 'wrong' }).expect(401);
  await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.99').send({ email: 'c@example.test', password: 'wrong' }).expect(401);
  await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.99').send({ email: 'd@example.test', password: 'wrong' }).expect(429);

  // Signup enforces its own stricter configurable IP threshold (2).
  await registerUser('198.51.100.55');
  await registerUser('198.51.100.55');
  await request(app).post('/api/auth/register').set('X-Forwarded-For', '198.51.100.55')
    .send({ name: 'Extra', email: 'extra@example.test', password }).expect(429);
}, 20_000);

it('applies moderate configurable limits on public and webhook endpoints', async () => {
  vi.stubEnv('RATE_LIMIT_PUBLIC_MAX', '3');
  vi.stubEnv('RATE_LIMIT_PUBLIC_WINDOW_MS', '30000');
  vi.stubEnv('RATE_LIMIT_WEBHOOK_MAX', '2');

  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));

  for (let i = 0; i < 3; i++) {
    const res = await request(app).get('/api/healthz').set('X-Forwarded-For', '203.0.113.44').expect(200);
    expect(res.headers['ratelimit-limit']).toBe('3');
  }
  const throttled = await request(app).get('/api/healthz').set('X-Forwarded-For', '203.0.113.44').expect(429);
  expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);

  // Different public IP is unaffected.
  await request(app).get('/api/healthz').set('X-Forwarded-For', '203.0.113.45').expect(200);

  // Window expiration restores public access.
  vi.advanceTimersByTime(30_001);
  await request(app).get('/api/healthz').set('X-Forwarded-For', '203.0.113.44').expect(200);

  // Public webhook uses its configurable threshold (2) even though signatures are rejected with 401.
  await request(app).post('/api/webhooks/razorpay').set('X-Forwarded-For', '203.0.113.70').send({}).expect(401);
  await request(app).post('/api/webhooks/razorpay').set('X-Forwarded-For', '203.0.113.70').send({}).expect(401);
  await request(app).post('/api/webhooks/razorpay').set('X-Forwarded-For', '203.0.113.70').send({}).expect(429);
});

it('applies looser configurable per-user and per-IP backstop limits on authenticated user actions', async () => {
  vi.stubEnv('RATE_LIMIT_AUTHED_MAX', '4');
  vi.stubEnv('RATE_LIMIT_AUTHED_IP_MAX', '6');
  vi.stubEnv('RATE_LIMIT_AUTHED_WINDOW_MS', '60000');

  const userA = await registerUser('203.0.113.80');
  const userB = await registerUser('203.0.113.80');

  // User A can make 4 requests; 5th hits per-user cap.
  for (let i = 0; i < 4; i++) {
    const res = await request(app).get('/api/workspaces').set('X-Forwarded-For', '203.0.113.80').set('Cookie', userA.cookie).expect(200);
    expect(res.headers['ratelimit-limit']).toBe('4');
  }
  await request(app).get('/api/workspaces').set('X-Forwarded-For', '203.0.113.80').set('Cookie', userA.cookie).expect(429);

  // User B on the same NAT IP still has their own per-user quota until the IP backstop (6) is hit.
  // (Prior 5 requests from 203.0.113.80 counted toward the 6-request IP backstop; 6th succeeds, 7th hits IP backstop.)
  await request(app).get('/api/workspaces').set('X-Forwarded-For', '203.0.113.80').set('Cookie', userB.cookie).expect(200);
  await request(app).get('/api/workspaces').set('X-Forwarded-For', '203.0.113.80').set('Cookie', userB.cookie).expect(429);
});

it('rejects malformed, out-of-range, or wrongly typed limits against strict schema without sanitizing', () => {
  const valid = validateRateLimitEnv({
    RATE_LIMIT_AUTH_ACCOUNT_MAX: '5',
    RATE_LIMIT_AUTH_BACKOFF_BASE_MS: '5000',
    RATE_LIMIT_AUTH_BACKOFF_MAX_MS: '60000',
    RATE_LIMIT_PUBLIC_MAX: '60',
  });
  expect(valid.auth.accountMax.default).toBe(5);

  const badEnvCases = [
    { RATE_LIMIT_PUBLIC_MAX: '' },
    { RATE_LIMIT_PUBLIC_MAX: ' 60 ' }, // whitespace must be rejected, not trimmed
    { RATE_LIMIT_PUBLIC_MAX: '060' },  // leading zero rejected
    { RATE_LIMIT_PUBLIC_MAX: '-5' },
    { RATE_LIMIT_PUBLIC_MAX: '+5' },
    { RATE_LIMIT_PUBLIC_MAX: '5.5' },
    { RATE_LIMIT_PUBLIC_MAX: '1e3' },
    { RATE_LIMIT_PUBLIC_MAX: '10;DROP' },
    { RATE_LIMIT_PUBLIC_MAX: '123456789' }, // exceeds max 8 digits & bounds
    { RATE_LIMIT_PUBLIC_MAX: '100001' },    // exceeds max bound 100000
    { RATE_LIMIT_PUBLIC_WINDOW_MS: '500' }, // below min bound 1000ms
    { RATE_LIMIT_PUBLIC_MAX: 60.5 },
    { RATE_LIMIT_PUBLIC_MAX: true },
    { RATE_LIMIT_AUTH_BACKOFF_BASE_MS: '10000', RATE_LIMIT_AUTH_BACKOFF_MAX_MS: '5000' }, // max < base
    { RATE_LIMIT_AUTHED_MAX: '500', RATE_LIMIT_AUTHED_IP_MAX: '100' }, // ipMax < user max
  ];
  for (const badEnv of badEnvCases) {
    expect(() => validateRateLimitEnv(badEnv)).toThrow(RateLimitConfigError);
  }

  expect(() => validateRateLimitConfig({ ...valid, extraField: 123 })).toThrow(RateLimitConfigError);
  expect(() => validateRateLimitConfig({ ...valid, public: { windowMs: '1000', max: '10', rogue: 1 } })).toThrow(RateLimitConfigError);
});

it('accepts 8-character passwords and rejects 7-character passwords on signup and password change', async () => {
  await request(app).post('/api/auth/register').set('X-Forwarded-For', '198.51.100.200')
    .send({ name: 'Short Pass', email: 'short@example.test', password: '1234567' }).expect(400);

  const registered = await request(app).post('/api/auth/register').set('X-Forwarded-For', '198.51.100.200')
    .send({ name: 'Eight Pass', email: 'eight@example.test', password: '12345678' }).expect(201);
  const cookie = registered.headers['set-cookie'][0].split(';')[0];
  const csrf = registered.body.csrfToken;

  await request(app).post('/api/auth/password').set('X-Forwarded-For', '198.51.100.200')
    .set('Cookie', cookie).set('X-CSRF-Token', csrf)
    .send({ currentPassword: '12345678', newPassword: 'abcdefg' }).expect(400);

  await request(app).post('/api/auth/password').set('X-Forwarded-For', '198.51.100.200')
    .set('Cookie', cookie).set('X-CSRF-Token', csrf)
    .send({ currentPassword: '12345678', newPassword: 'abcdefgh' }).expect(200);
});
