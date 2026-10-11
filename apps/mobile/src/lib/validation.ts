/**
 * Client-side validation for the customer account screens.
 *
 * These rules MIRROR the backend `RegisterDto`
 * (`apps/api/src/auth/dto/account.dto.ts`) and the Vietnamese phone rule in
 * `AuthService.register` (`apps/api/src/common/utils/phone.util.ts`). The
 * backend is the authority; this copy exists so the customer gets the message
 * next to the field BEFORE a round trip, and the two MUST stay in sync — a
 * value the API accepts must never be rejected here, and vice versa.
 *
 * Nothing here invents a rule, and no internal text (Prisma, SQL, JWT, stack
 * traces, English DTO field names) is ever surfaced: only the recognised,
 * business-safe Vietnamese messages below are shown. Anything the mapper does
 * not recognise is left to the caller as a single form-level error rather than
 * being guessed at per field.
 */

/* --------------------------------------------------------------- constants -- */

export const FULL_NAME_MIN_LENGTH = 2;
export const FULL_NAME_MAX_LENGTH = 120;
export const EMAIL_MAX_LENGTH = 180;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 72;

/** At least one ASCII letter and one digit — the same rule the DTO enforces. */
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;

/**
 * Pragmatic e-mail shape: `local@domain.tld` with no whitespace. This is
 * deliberately a little more permissive than the backend's `validator.js`
 * `isEmail`, so a real address is never rejected client-side; the backend
 * remains the final word and its own error is mapped back to the field.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Vietnamese mobile prefixes (after the leading 0): 03, 05, 07, 08, 09. */
const MOBILE_PREFIXES = ['3', '5', '7', '8', '9'];

/* ------------------------------------------------------------------- types -- */

export type RegisterField = 'fullName' | 'email' | 'phone' | 'password' | 'confirmPassword';

/** Per-field error messages, keyed by the field they belong under. */
export type FieldErrors = Partial<Record<RegisterField, string>>;

/** Fields in visual order — also the order the first invalid field is focused. */
export const REGISTER_FIELD_ORDER: RegisterField[] = [
  'fullName',
  'email',
  'phone',
  'password',
  'confirmPassword',
];

/* -------------------------------------------------------------- phone rule -- */

/**
 * Returns the canonical 10-digit local form, or `null` when the input is not a
 * valid Vietnamese mobile number. A direct port of the backend `phone.util.ts`
 * so the app and the API accept exactly the same numbers.
 *
 * Accepted (all normalise to `0XXXXXXXXX`): `0912345678`, `091 234 5678`,
 * `+84912345678`, `84912345678`.
 */
export function normalizeVietnamesePhone(input: string): string | null {
  if (typeof input !== 'string') return null;

  const compact = input.replace(/[\s.\-()]/g, '');

  let local: string;
  if (compact.startsWith('+84')) local = `0${compact.slice(3)}`;
  else if (compact.startsWith('84') && compact.length > 10) local = `0${compact.slice(2)}`;
  else local = compact;

  if (!/^0\d{9}$/.test(local)) return null;
  if (!MOBILE_PREFIXES.includes(local.charAt(1))) return null;
  return local;
}

/** True when `input` is a valid Vietnamese mobile number in any accepted form. */
export function isValidVietnamesePhone(input: string): boolean {
  return normalizeVietnamesePhone(input) !== null;
}

/* ------------------------------------------------- per-field client checks -- */
/* The wording is the message shown under the field. Kept as functions so the  */
/* form and the tests assert the SAME strings the customer sees.              */

export function validateFullName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < FULL_NAME_MIN_LENGTH) {
    return 'Vui lòng nhập họ tên từ 2 ký tự.';
  }
  if (trimmed.length > FULL_NAME_MAX_LENGTH) {
    return `Họ và tên tối đa ${FULL_NAME_MAX_LENGTH} ký tự.`;
  }
  return null;
}

export function validateEmail(value: string): string | null {
  const trimmed = value.trim();
  if (!EMAIL_PATTERN.test(trimmed) || trimmed.length > EMAIL_MAX_LENGTH) {
    return 'Email chưa hợp lệ.';
  }
  return null;
}

export function validatePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!isValidVietnamesePhone(trimmed)) {
    return 'Số điện thoại chưa hợp lệ.';
  }
  return null;
}

export function validatePassword(value: string): string | null {
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Mật khẩu cần ít nhất ${PASSWORD_MIN_LENGTH} ký tự, gồm chữ và số.`;
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `Mật khẩu tối đa ${PASSWORD_MAX_LENGTH} ký tự.`;
  }
  if (!PASSWORD_PATTERN.test(value)) {
    return `Mật khẩu cần ít nhất ${PASSWORD_MIN_LENGTH} ký tự, gồm chữ và số.`;
  }
  return null;
}

export function validateConfirmPassword(password: string, confirm: string): string | null {
  if (confirm.length === 0) {
    return 'Vui lòng nhập lại mật khẩu.';
  }
  if (password !== confirm) {
    return 'Mật khẩu nhập lại không khớp.';
  }
  return null;
}

/* ----------------------------------------------------------- whole-form API -- */

export interface RegisterValues {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

/**
 * Validates the whole register form and returns every field error at once (so
 * the UI can show all of them and focus the first). An empty object means the
 * form is valid and the request may be sent.
 */
export function validateRegisterForm(values: RegisterValues): FieldErrors {
  const errors: FieldErrors = {};
  const fullName = validateFullName(values.fullName);
  if (fullName) errors.fullName = fullName;
  const email = validateEmail(values.email);
  if (email) errors.email = email;
  const phone = validatePhone(values.phone);
  if (phone) errors.phone = phone;
  const password = validatePassword(values.password);
  if (password) errors.password = password;
  const confirm = validateConfirmPassword(values.password, values.confirmPassword);
  if (confirm) errors.confirmPassword = confirm;
  return errors;
}

/** The first field (in visual order) that has an error, or `null`. */
export function firstInvalidField(errors: FieldErrors): RegisterField | null {
  return REGISTER_FIELD_ORDER.find((field) => errors[field]) ?? null;
}

/* --------------------------------------------- backend error → field mapper -- */

/**
 * Maps a backend error body (`{ message: string | string[] }`, the shape the
 * NestJS `ValidationPipe` and the `ConflictException` produce) onto register
 * fields.
 *
 * WHY THIS EXISTS: the client validates first, so a 400/409 should be rare —
 * but a race (two devices registering the same address) or a server-only rule
 * can still reject a request the client thought was fine. Without this the
 * customer would see one generic banner; with it, the error lands under the
 * exact field that is wrong (e.g. the e-mail box for a duplicate address).
 *
 * The mapper is intentionally conservative:
 * - Recognised Vietnamese business messages map to their field verbatim.
 * - `class-validator` default English messages carry the DTO property name as
 *   a prefix (`email must be …`, `password must be …`); those map by property,
 *   but the English text is never shown — the caller keeps its own field text.
 * - Anything else (a forged `role` rejection, a 500, an unmapped string) is NOT
 *   attributed to a field — the caller shows a single form-level message. This
 *   is what keeps internal/technical text out of the per-field UI.
 *
 * Returns the per-field errors plus a `formError` that is only set when NOTHING
 * mapped, so a known-bad field never also shows a generic banner.
 */
export function mapRegisterFieldErrors(message: string | string[] | undefined): {
  fields: FieldErrors;
  formError: string | null;
} {
  const fields: FieldErrors = {};
  if (message === undefined) return { fields, formError: null };

  const list = Array.isArray(message) ? message : [message];

  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    if (!text) continue;

    const field = fieldForBackendMessage(text);
    if (field && !fields[field]) {
      fields[field] = fieldTextForBackendMessage(field, text);
    }
  }

  const mapped = Object.keys(fields).length > 0;
  const firstString = list.find((item): item is string => typeof item === 'string') ?? null;
  return { fields, formError: mapped ? null : firstString };
}

/**
 * Exact, business-safe Vietnamese messages the DTO / AuthService emit, mapped to
 * their field. These are echoed verbatim because they are already safe to show.
 */
const VIETNAMESE_FIELD_MESSAGES: Record<string, RegisterField> = {
  'Vui lòng nhập họ và tên': 'fullName',
  'Email chưa hợp lệ': 'email',
  'Email này đã được đăng ký': 'email',
  'Số điện thoại chưa hợp lệ': 'phone',
  'Mật khẩu phải có ít nhất 10 ký tự': 'password',
  'Mật khẩu phải có ít nhất 1 chữ cái và 1 chữ số': 'password',
};

/** The register field a backend message belongs to, or `null` if unmapped. */
function fieldForBackendMessage(text: string): RegisterField | null {
  // 1. Exact, business-safe Vietnamese messages from the DTO / AuthService.
  const exact = VIETNAMESE_FIELD_MESSAGES[text];
  if (exact) return exact;

  // 2. class-validator default English messages are prefixed with the DTO
  //    property name. Map by that property; the English text itself is never
  //    shown (the field-level client message is used instead by the caller).
  const propertyMatch = /^(email|password|fullName|phone)\b/.exec(text);
  if (propertyMatch) return propertyMatch[1] as RegisterField;

  return null;
}

/**
 * The text to show under a field for a recognised backend message. A known
 * Vietnamese business message is echoed verbatim; anything else (an English
 * `class-validator` default) is replaced by the field's own client wording so
 * no internal/technical text ever reaches the UI.
 */
function fieldTextForBackendMessage(field: RegisterField, text: string): string {
  if (VIETNAMESE_FIELD_MESSAGES[text] !== undefined) return text;
  switch (field) {
    case 'fullName':
      return 'Vui lòng nhập họ tên từ 2 ký tự.';
    case 'email':
      return 'Email chưa hợp lệ.';
    case 'phone':
      return 'Số điện thoại chưa hợp lệ.';
    case 'password':
      return 'Mật khẩu cần ít nhất 10 ký tự, gồm chữ và số.';
    default:
      return 'Giá trị chưa hợp lệ.';
  }
}

