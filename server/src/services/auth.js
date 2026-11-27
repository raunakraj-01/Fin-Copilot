import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import AuthSession from '../models/AuthSession.js';
import AuthAttempt from '../models/AuthAttempt.js';
import { getRateLimitConfig } from '../config/rateLimits.js';
import { setRateLimitHeaders } from '../middleware/rateLimit.js';
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

export function allowedOrigins() {
  const list = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  if (process.env.CLIENT_ORIGIN) list.push(process.env.CLIENT_ORIGIN.trim());
  if (process.env.RENDER_EXTERNAL_URL) list.push(process.env.RENDER_EXTERNAL_URL.trim());
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) list.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`);
  if (process.env.VERCEL_URL) list.push(`https://${process.env.VERCEL_URL.trim()}`);
  return new Set(list);
}

export function isAllowedOrigin(origin, host) {
  if (!origin) return true;
  if (allowedOrigins().has(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (host && parsed.host === host) return true;
    const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (isLocalHost && (process.env.NODE_ENV !== 'production' || /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host || ''))) {
      return true;
    }
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
function authTargets(req, category, email = '') {
  const { auth } = getRateLimitConfig();
  const ipLimit = auth.ipMax[category] ?? auth.ipMax.default;
  const accountLimit = auth.accountMax[category] ?? auth.accountMax.default;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const targets = [{ scope: 'ip', key: tokenHash(`${category}:ip:${req.ip || 'unknown'}`), limit: ipLimit }];
  if (normalizedEmail) {
    targets.push({ scope: 'account', key: tokenHash(`${category}:email:${normalizedEmail}`), limit: accountLimit });
  }
  return { targets, cfg: auth };
}

/**
 * Check per-IP and per-account exponential backoff state before verifying credentials.
 * Blocks only while an active backoff cooldown (`blockedUntil`) has not elapsed.
 */
export async function checkAuthThrottle(req, res, category, email = '') {
  await AuthAttempt.init();
  const now = Date.now();
  const { targets, cfg } = authTargets(req, category, email);
  const docs = await AuthAttempt.find({ key: { $in: targets.map(t => t.key) } }).lean();
  const byKey = new Map(docs.map(doc => [doc.key, doc]));

  let strictest = null;
  let blockedUntilMs = 0;

  for (const target of targets) {
    const doc = byKey.get(target.key);
    const active = doc && doc.expiresAt && doc.expiresAt.getTime() > now;
    const count = active ? (doc.count || 0) : 0;
    const remaining = Math.max(0, target.limit - count);
    const resetAtMs = active ? doc.expiresAt.getTime() : now + cfg.windowMs;
    if (active && doc.blockedUntil && doc.blockedUntil.getTime() > blockedUntilMs) {
      blockedUntilMs = doc.blockedUntil.getTime();
    }
    if (!strictest || remaining < strictest.remaining) {
      strictest = { limit: target.limit, remaining, resetAtMs };
    }
  }

  if (blockedUntilMs > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((blockedUntilMs - now) / 1000));
    setRateLimitHeaders(res, { ...strictest, remaining: 0, retryAfterSeconds });
    fail(429, 'RATE_LIMITED', `Too many attempts. Please try again in ${retryAfterSeconds}s.`);
  }
  setRateLimitHeaders(res, strictest);
}

/**
 * Record an auth attempt (e.g. failed login/recovery or signup attempt) and apply
 * exponential backoff once the per-IP or per-account threshold is reached.
 */
export async function recordAuthAttempt(req, res, category, email = '') {
  await AuthAttempt.init();
  const now = Date.now();
  const { targets, cfg } = authTargets(req, category, email);
  let strictest = null;

  for (const target of targets) {
    const existing = await AuthAttempt.findOne({ key: target.key }).lean();
    const freshWindow = !existing || !existing.expiresAt || existing.expiresAt.getTime() <= now;
    let doc;
    if (freshWindow) {
      try {
        doc = await AuthAttempt.findOneAndUpdate(
          { key: target.key },
          { $set: { count: 1, blockedUntil: null, expiresAt: new Date(now + cfg.windowMs) } },
          { upsert: true, new: true },
        );
      } catch (error) {
        if (error.code !== 11000) throw error;
        doc = await AuthAttempt.findOneAndUpdate({ key: target.key }, { $inc: { count: 1 } }, { new: true });
      }
    } else {
      doc = await AuthAttempt.findOneAndUpdate({ key: target.key }, { $inc: { count: 1 } }, { new: true });
    }

    if (doc.count >= target.limit) {
      const excess = doc.count - target.limit + 1;
      const backoffMs = Math.min(cfg.backoffMaxMs, cfg.backoffBaseMs * (2 ** (excess - 1)));
      const nextBlocked = new Date(now + backoffMs);
      const nextExpires = new Date(Math.max(doc.expiresAt?.getTime() || 0, now + cfg.windowMs, now + backoffMs));
      await AuthAttempt.updateOne({ _id: doc._id }, { $set: { blockedUntil: nextBlocked, expiresAt: nextExpires } });
    }

    const remaining = Math.max(0, target.limit - doc.count);
    const resetAtMs = doc.expiresAt?.getTime() || now + cfg.windowMs;
    if (!strictest || remaining < strictest.remaining) {
      strictest = { limit: target.limit, remaining, resetAtMs };
    }
  }
  setRateLimitHeaders(res, strictest);
}

/** Clear per-account failure/backoff state after successful authentication. */
export async function clearAuthAttempts(category, email = '') {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return;
  await AuthAttempt.deleteOne({ key: tokenHash(`${category}:email:${normalizedEmail}`) });
}

export async function throttle(req, category, email = '', res = null) {
  await checkAuthThrottle(req, res, category, email);
  await recordAuthAttempt(req, res, category, email);
}
