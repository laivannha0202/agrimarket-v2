import {
  resolveCodReservationTtlMinutes,
  resolveOrderReservationTtlMinutes,
} from '../orders/reservation-policy.js';

/**
 * Hardening for the JWT signing secret.
 *
 * The API used to fall back to the literal `CHANGE_ME`. A missing environment
 * variable therefore produced a deployment that signed and verified tokens with
 * a public value. The resolver below fails closed instead: startup is refused
 * unless a strong, non-placeholder secret is configured. It deliberately never
 * includes the supplied value in an error message.
 */

/** Minimum length accepted in every environment (not only production). */
export const JWT_SECRET_MIN_LENGTH = 32;

/**
 * Normalised placeholder values. Normalisation strips separators so
 * `change-me`, `change_me`, `CHANGE ME` and `changeme` are all recognised.
 */
const JWT_SECRET_PLACEHOLDERS = new Set([
  'change',
  'changeme',
  'changeit',
  'default',
  'example',
  'jwtsecret',
  'password',
  'secret',
  'secretkey',
  'supersecret',
  'test',
  'testsecret',
  'yoursecret',
  'yoursecretkey',
  'replacewithastrongrandomsecret',
  'replacewithastrongsecret',
]);

/**
 * Normalises a value for placeholder comparison only. The original (trimmed)
 * value is what gets used for signing, so case and punctuation are preserved.
 */
function normalizeForComparison(secret: string): string {
  return secret.toLowerCase().replace(/[\s._-]+/g, '');
}

/**
 * Resolves and validates `JWT_SECRET`.
 *
 * Throws on missing/blank input, placeholders and weak defaults, values shorter
 * than 32 characters, and obviously low-entropy values (for example a single
 * repeated character or a short repeating pattern). The caller must let the
 * error abort startup; there is intentionally no fallback.
 */
export function resolveJwtSecret(raw: string | undefined): string {
  const secret = (raw ?? '').trim();
  if (!secret) {
    throw new Error('Invalid configuration: JWT_SECRET is required and must not be empty');
  }

  const normalized = normalizeForComparison(secret);
  if (
    JWT_SECRET_PLACEHOLDERS.has(normalized) ||
    normalized.includes('changeme') ||
    normalized.includes('yoursecret') ||
    normalized.includes('replacewith') ||
    normalized.includes('notforproduction') ||
    normalized.includes('example')
  ) {
    throw new Error(
      'Invalid configuration: JWT_SECRET must not be a placeholder or weak default',
    );
  }

  if (secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `Invalid configuration: JWT_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters`,
    );
  }

  // Conservative entropy guard: reject only the obvious cases (one repeated
  // character / a tiny alphabet), not passphrases or random encodings. A
  // 32-character value with fewer than 8 distinct characters cannot be a
  // securely generated secret.
  if (new Set(secret).size < 8) {
    throw new Error(
      'Invalid configuration: JWT_SECRET has insufficient entropy; use a randomly generated secret',
    );
  }

  return secret;
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  corsOrigin: string[];
  /** Public base URL of the Customer Web, used to build password-reset links. */
  customerWebUrl: string;
  /** Mail transport selection — see `MailService`. */
  mailTransport: string;
  mailFrom: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  /** Minutes a PENDING_CONFIRMATION order keeps its stock reservation. */
  orderReservationTtlMinutes: number;
  /** Minutes a COD order keeps its stock reservation while a human confirms. */
  orderReservationTtlMinutesCod: number;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret: resolveJwtSecret(process.env.JWT_SECRET),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  corsOrigin: (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Where the recovery link points. Defaults to the local Customer Web port so
  // a dev machine works without configuration.
  customerWebUrl: process.env.CUSTOMER_WEB_URL ?? 'http://localhost:3002',
  mailTransport: process.env.MAIL_TRANSPORT ?? '',
  mailFrom: process.env.MAIL_FROM ?? 'AgriMarket <no-reply@agrimarket.vn>',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: parseInt(process.env.SMTP_PORT ?? '587', 10),
  smtpSecure: (process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true',
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
  // Parsed by the same helper the orders service uses, so startup and runtime
  // can never disagree about the value.
  orderReservationTtlMinutes: resolveOrderReservationTtlMinutes(
    process.env.ORDER_RESERVATION_TTL_MINUTES,
  ),
  orderReservationTtlMinutesCod: resolveCodReservationTtlMinutes(
    process.env.ORDER_RESERVATION_TTL_MINUTES_COD,
  ),
});
