import { getRateLimitConfig } from '../config/rateLimits.js';
import { fail } from '../utils/http.js';

const stores = new Map();
const MAX_KEYS_PER_STORE = 10_000;

function getStore(name) {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

function pruneStore(store, now) {
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
  if (store.size > MAX_KEYS_PER_STORE) {
    const excess = store.size - MAX_KEYS_PER_STORE;
    let removed = 0;
    for (const key of store.keys()) {
      store.delete(key);
      if (++removed >= excess) break;
    }
  }
}

export function setRateLimitHeaders(res, { limit, remaining, resetAtMs, retryAfterSeconds }) {
  if (!res || typeof res.set !== 'function') return;
  res.set('RateLimit-Limit', String(limit));
  res.set('RateLimit-Remaining', String(Math.max(0, remaining)));
  res.set('RateLimit-Reset', String(Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000))));
  if (retryAfterSeconds != null) res.set('Retry-After', String(Math.max(1, retryAfterSeconds)));
}

function consumeBucket(storeName, key, { limit, windowMs, now = Date.now() }) {
  const store = getStore(storeName);
  if (store.size >= MAX_KEYS_PER_STORE) pruneStore(store, now);
  let entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  entry.count += 1;
  store.set(key, entry);
  const remaining = Math.max(0, limit - entry.count);
  const retryAfterSeconds = entry.count > limit ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : null;
  return { allowed: entry.count <= limit, limit, remaining, resetAtMs: entry.resetAt, retryAfterSeconds };
}

/** Moderate per-IP rate limiter for unauthenticated/public endpoints and webhooks. */
export function rateLimitPublic(kind = 'public') {
  return (req, res, next) => {
    const config = getRateLimitConfig();
    const policy = kind === 'webhook' ? config.webhook : config.public;
    const result = consumeBucket(`public:${kind}`, `ip:${req.ip || 'unknown'}`, {
      limit: policy.max,
      windowMs: policy.windowMs,
    });
    setRateLimitHeaders(res, result);
    if (!result.allowed) {
      return next(Object.assign(new Error(`Too many requests. Try again in ${result.retryAfterSeconds}s.`), {
        status: 429,
        code: 'RATE_LIMITED',
      }));
    }
    next();
  };
}

/**
 * Looser rate limiter for authenticated actions, keyed by user/service identity
 * with a higher per-IP backstop so shared NAT offices don't collide.
 */
export function enforceAuthenticatedRateLimit(req, res) {
  if (req._authedRateLimited) return;
  req._authedRateLimited = true;
  const { authenticated } = getRateLimitConfig();
  const actorKey = req.user?._id
    ? `user:${String(req.user._id)}`
    : req.service?._id
      ? `service:${String(req.service._id)}`
      : `ip:${req.ip || 'unknown'}`;

  const actor = consumeBucket('authed:actor', actorKey, { limit: authenticated.max, windowMs: authenticated.windowMs });
  const ip = consumeBucket('authed:ip', `ip:${req.ip || 'unknown'}`, { limit: authenticated.ipMax, windowMs: authenticated.windowMs });

  const stricter = !actor.allowed ? actor : !ip.allowed ? ip : actor.remaining <= ip.remaining ? actor : ip;
  setRateLimitHeaders(res, stricter);
  if (!actor.allowed || !ip.allowed) {
    const wait = !actor.allowed ? actor.retryAfterSeconds : ip.retryAfterSeconds;
    fail(429, 'RATE_LIMITED', `Rate limit exceeded. Try again in ${wait}s.`);
  }
}

export function rateLimitHeavy({ name, max, windowMs }) {
  return (req, res, next) => {
    const actorKey = req.user?._id
      ? `user:${String(req.user._id)}`
      : req.service?._id
        ? `service:${String(req.service._id)}`
        : `ip:${req.ip || 'unknown'}`;
    const result = consumeBucket(`heavy:${name}`, actorKey, { limit: max, windowMs });
    setRateLimitHeaders(res, result);
    if (!result.allowed) {
      return next(Object.assign(new Error(`Too many requests for this action. Try again in ${result.retryAfterSeconds}s.`), {
        status: 429,
        code: 'RATE_LIMITED',
      }));
    }
    next();
  };
}

export function resetRateLimiters() {
  stores.clear();
}
