import { z } from 'zod';

export class RateLimitConfigError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'RateLimitConfigError';
    this.status = 400;
    this.code = 'VALIDATION_ERROR';
    this.details = details;
  }
}

const CANONICAL_POS_INT = /^[1-9]\d{0,7}$/;

/**
 * Strictly validate an integer limit without coercing, trimming, or sanitizing.
 * Rejects non-canonical formats (spaces, leading zeros, signs, decimals, exponents).
 */
function strictLimitSchema(fieldName, min, max) {
  return z.union([
    z.string()
      .min(1, `${fieldName} must not be empty`)
      .max(8, `${fieldName} exceeds maximum length of 8 digits`)
      .regex(CANONICAL_POS_INT, `${fieldName} must be a canonical positive integer string with no whitespace, signs, or leading zeros`)
      .transform(raw => Number(raw)),
    z.number().int(`${fieldName} must be an integer`).finite(`${fieldName} must be finite`),
  ]).refine(
    value => Number.isSafeInteger(value) && value >= min && value <= max,
    { message: `${fieldName} must be an integer between ${min} and ${max}` },
  );
}

const envRateLimitSchema = z.object({
  RATE_LIMIT_AUTH_WINDOW_MS: strictLimitSchema('RATE_LIMIT_AUTH_WINDOW_MS', 1_000, 86_400_000).default(15 * 60_000),
  RATE_LIMIT_AUTH_BACKOFF_BASE_MS: strictLimitSchema('RATE_LIMIT_AUTH_BACKOFF_BASE_MS', 100, 3_600_000).default(5_000),
  RATE_LIMIT_AUTH_BACKOFF_MAX_MS: strictLimitSchema('RATE_LIMIT_AUTH_BACKOFF_MAX_MS', 100, 86_400_000).default(15 * 60_000),
  RATE_LIMIT_AUTH_IP_MAX: strictLimitSchema('RATE_LIMIT_AUTH_IP_MAX', 1, 10_000).default(60),
  RATE_LIMIT_AUTH_REGISTER_IP_MAX: strictLimitSchema('RATE_LIMIT_AUTH_REGISTER_IP_MAX', 1, 10_000).default(10),
  RATE_LIMIT_AUTH_ACCOUNT_MAX: strictLimitSchema('RATE_LIMIT_AUTH_ACCOUNT_MAX', 1, 10_000).default(12),
  RATE_LIMIT_AUTH_REGISTER_ACCOUNT_MAX: strictLimitSchema('RATE_LIMIT_AUTH_REGISTER_ACCOUNT_MAX', 1, 10_000).default(5),
  RATE_LIMIT_AUTH_RECOVER_ACCOUNT_MAX: strictLimitSchema('RATE_LIMIT_AUTH_RECOVER_ACCOUNT_MAX', 1, 10_000).default(5),
  RATE_LIMIT_PUBLIC_WINDOW_MS: strictLimitSchema('RATE_LIMIT_PUBLIC_WINDOW_MS', 1_000, 86_400_000).default(60_000),
  RATE_LIMIT_PUBLIC_MAX: strictLimitSchema('RATE_LIMIT_PUBLIC_MAX', 1, 100_000).default(60),
  RATE_LIMIT_WEBHOOK_WINDOW_MS: strictLimitSchema('RATE_LIMIT_WEBHOOK_WINDOW_MS', 1_000, 86_400_000).optional(),
  RATE_LIMIT_WEBHOOK_MAX: strictLimitSchema('RATE_LIMIT_WEBHOOK_MAX', 1, 100_000).optional(),
  RATE_LIMIT_AUTHED_WINDOW_MS: strictLimitSchema('RATE_LIMIT_AUTHED_WINDOW_MS', 1_000, 86_400_000).default(60_000),
  RATE_LIMIT_AUTHED_MAX: strictLimitSchema('RATE_LIMIT_AUTHED_MAX', 1, 100_000).default(300),
  RATE_LIMIT_AUTHED_IP_MAX: strictLimitSchema('RATE_LIMIT_AUTHED_IP_MAX', 1, 100_000).default(1_000),
}).strict().superRefine((val, ctx) => {
  if (val.RATE_LIMIT_AUTH_BACKOFF_MAX_MS < val.RATE_LIMIT_AUTH_BACKOFF_BASE_MS) {
    ctx.addIssue({
      code: 'custom',
      path: ['RATE_LIMIT_AUTH_BACKOFF_MAX_MS'],
      message: 'RATE_LIMIT_AUTH_BACKOFF_MAX_MS must be greater than or equal to RATE_LIMIT_AUTH_BACKOFF_BASE_MS',
    });
  }
  if (val.RATE_LIMIT_AUTHED_IP_MAX < val.RATE_LIMIT_AUTHED_MAX) {
    ctx.addIssue({
      code: 'custom',
      path: ['RATE_LIMIT_AUTHED_IP_MAX'],
      message: 'RATE_LIMIT_AUTHED_IP_MAX must be greater than or equal to RATE_LIMIT_AUTHED_MAX',
    });
  }
});

const RATE_LIMIT_ENV_KEYS = Object.keys(envRateLimitSchema.shape);

const structuredConfigSchema = z.object({
  auth: z.object({
    windowMs: strictLimitSchema('auth.windowMs', 1_000, 86_400_000),
    backoffBaseMs: strictLimitSchema('auth.backoffBaseMs', 100, 3_600_000),
    backoffMaxMs: strictLimitSchema('auth.backoffMaxMs', 100, 86_400_000),
    ipMax: z.object({
      register: strictLimitSchema('auth.ipMax.register', 1, 10_000),
      default: strictLimitSchema('auth.ipMax.default', 1, 10_000),
    }).strict(),
    accountMax: z.object({
      register: strictLimitSchema('auth.accountMax.register', 1, 10_000),
      recover: strictLimitSchema('auth.accountMax.recover', 1, 10_000),
      default: strictLimitSchema('auth.accountMax.default', 1, 10_000),
    }).strict(),
  }).strict(),
  public: z.object({
    windowMs: strictLimitSchema('public.windowMs', 1_000, 86_400_000),
    max: strictLimitSchema('public.max', 1, 100_000),
  }).strict(),
  webhook: z.object({
    windowMs: strictLimitSchema('webhook.windowMs', 1_000, 86_400_000),
    max: strictLimitSchema('webhook.max', 1, 100_000),
  }).strict(),
  authenticated: z.object({
    windowMs: strictLimitSchema('authenticated.windowMs', 1_000, 86_400_000),
    max: strictLimitSchema('authenticated.max', 1, 100_000),
    ipMax: strictLimitSchema('authenticated.ipMax', 1, 100_000),
  }).strict(),
}).strict().superRefine((cfg, ctx) => {
  if (cfg.auth.backoffMaxMs < cfg.auth.backoffBaseMs) {
    ctx.addIssue({
      code: 'custom',
      path: ['auth', 'backoffMaxMs'],
      message: 'auth.backoffMaxMs must be greater than or equal to auth.backoffBaseMs',
    });
  }
  if (cfg.authenticated.ipMax < cfg.authenticated.max) {
    ctx.addIssue({
      code: 'custom',
      path: ['authenticated', 'ipMax'],
      message: 'authenticated.ipMax must be greater than or equal to authenticated.max',
    });
  }
});

/**
 * Strictly validate an arbitrary rate-limit config object (rejecting wrong types,
 * unknown fields, malformed strings, or out-of-range limits).
 */
export function validateRateLimitConfig(raw) {
  const parsed = structuredConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map(issue => ({
      field: issue.path.join('.') || 'rateLimitConfig',
      message: issue.message,
    }));
    throw new RateLimitConfigError(`Invalid rate-limit configuration: ${details[0].message}`, details);
  }
  return parsed.data;
}

/**
 * Validate and resolve rate-limit environment thresholds against the strict schema.
 * Rejects malformed or out-of-range values instead of silently falling back.
 */
export function validateRateLimitEnv(env = process.env) {
  const subset = {};
  for (const key of RATE_LIMIT_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined) {
      subset[key] = env[key];
    }
  }
  const parsed = envRateLimitSchema.safeParse(subset);
  if (!parsed.success) {
    const details = parsed.error.issues.map(issue => ({
      field: issue.path.join('.') || 'rateLimitEnv',
      message: issue.message,
    }));
    throw new RateLimitConfigError(`Invalid rate-limit configuration: ${details[0].message}`, details);
  }
  const v = parsed.data;
  return {
    auth: {
      windowMs: v.RATE_LIMIT_AUTH_WINDOW_MS,
      backoffBaseMs: v.RATE_LIMIT_AUTH_BACKOFF_BASE_MS,
      backoffMaxMs: v.RATE_LIMIT_AUTH_BACKOFF_MAX_MS,
      ipMax: {
        register: v.RATE_LIMIT_AUTH_REGISTER_IP_MAX,
        default: v.RATE_LIMIT_AUTH_IP_MAX,
      },
      accountMax: {
        register: v.RATE_LIMIT_AUTH_REGISTER_ACCOUNT_MAX,
        recover: v.RATE_LIMIT_AUTH_RECOVER_ACCOUNT_MAX,
        default: v.RATE_LIMIT_AUTH_ACCOUNT_MAX,
      },
    },
    public: {
      windowMs: v.RATE_LIMIT_PUBLIC_WINDOW_MS,
      max: v.RATE_LIMIT_PUBLIC_MAX,
    },
    webhook: {
      windowMs: v.RATE_LIMIT_WEBHOOK_WINDOW_MS ?? v.RATE_LIMIT_PUBLIC_WINDOW_MS,
      max: v.RATE_LIMIT_WEBHOOK_MAX ?? v.RATE_LIMIT_PUBLIC_MAX,
    },
    authenticated: {
      windowMs: v.RATE_LIMIT_AUTHED_WINDOW_MS,
      max: v.RATE_LIMIT_AUTHED_MAX,
      ipMax: v.RATE_LIMIT_AUTHED_IP_MAX,
    },
  };
}

export function getRateLimitConfig() {
  return validateRateLimitEnv(process.env);
}
