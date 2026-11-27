import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import AuthSession from '../models/AuthSession.js';
import AuthAttempt from '../models/AuthAttempt.js';
import { fail } from '../utils/http.js';
const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export const tokenHash = value => createHash('sha256').update(value).digest('hex');
export const csrfToken = token => createHmac('sha256', token).update('cashflow-csrf-v1').digest('hex');
export const cookieName = () => process.env.NODE_ENV === 'production' ? '__Host-cashflow_session' : 'cashflow_session';
export const clientOrigin = () => {
  if (process.env.CLIENT_ORIGIN) return process.env.CLIENT_ORIGIN;
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:5173';
};

export function isAllowedOrigin(origin, host) {
  if (!origin) return true;
  if (origin === clientOrigin()) return true;
  if (process.env.RENDER_EXTERNAL_URL && origin === process.env.RENDER_EXTERNAL_URL) return true;
  if (process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`) return true;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL && origin === `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) return true;
  try {
    const parsed = new URL(origin);
    if (host && parsed.host === host) return true;
    if (parsed.hostname.endsWith('.vercel.app')) return true;
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return true;
  } catch {}
  return false;
}

export function assertOrigin(req) {
  const origin = req.get('Origin');
  if (origin && !isAllowedOrigin(origin, req.get('Host'))) {
    fail(403, 'FORBIDDEN', 'Request origin is not allowed');
  }
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, options);
  return `scrypt-v1$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const parts = (encoded || '').split('$');
  const valid = parts[0] === 'scrypt-v1' && /^[a-f0-9]{32}$/.test(parts[1] || '') && /^[a-f0-9]{128}$/.test(parts[2] || '');
  const key = await derive(password, valid ? parts[1] : '00000000000000000000000000000000', 64, options);
  return timingSafeEqual(key, valid ? Buffer.from(parts[2], 'hex') : Buffer.alloc(64)) && valid;
}
export function cookieToken(req) {
  const values = (req.get('Cookie') || '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${cookieName()}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(cookieName().length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export async function createSession(user, res) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await AuthSession.create({ tokenHash: tokenHash(token), userId: user._id, authVersion: user.authVersion, expiresAt });
  res.cookie(cookieName(), token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 8 * 60 * 60 * 1000 });
  return csrfToken(token);
}
export async function throttle(req, category, email = '') {
  await AuthAttempt.init();
  const bucket = Math.floor(Date.now() / (15 * 60000));
  for (const [identity, limit] of [[`ip:${req.ip}`, category === 'register' ? 10 : 60], ...(email ? [[`email:${email}`, 12]] : [])]) {
    const key = tokenHash(`${category}:${identity}:${bucket}`);
    let attempt;
    try { attempt = await AuthAttempt.findOneAndUpdate({ key }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * 15 * 60000) } }, { upsert: true, new: true }); }
    catch (error) { if (error.code !== 11000) throw error; attempt = await AuthAttempt.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { new: true }); }
    if (attempt.count > limit) fail(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
  }
}
