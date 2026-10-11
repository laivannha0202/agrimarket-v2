/**
 * Password policy, mirrored from the API.
 *
 * The backend is the authority (`apps/api/src/auth/dto/account.dto.ts`): it
 * rejects anything that does not satisfy these rules. This copy exists so the
 * customer gets the message before a round trip, and the two MUST stay in sync
 * — a password the API accepts must never be rejected here, and vice versa.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 72;

/** At least one letter and one digit, same pattern the DTO enforces. */
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export const PASSWORD_RULES_TEXT = `Tối thiểu ${PASSWORD_MIN_LENGTH} ký tự, có ít nhất 1 chữ cái và 1 chữ số.`;

/** Vietnamese message for the first rule a password breaks, or `null`. */
export function passwordProblem(value: string): string | null {
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Mật khẩu phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`;
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `Mật khẩu tối đa ${PASSWORD_MAX_LENGTH} ký tự`;
  }
  if (!PASSWORD_PATTERN.test(value)) {
    return "Mật khẩu phải có ít nhất 1 chữ cái và 1 chữ số";
  }
  return null;
}
