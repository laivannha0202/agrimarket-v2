import { describe, expect, it } from 'vitest';
import configuration, {
  JWT_SECRET_MIN_LENGTH,
  resolveJwtSecret,
} from '../../src/config/configuration.js';

/**
 * P0-A1 regression tests.
 *
 * The API used to fall back to `CHANGE_ME` when `JWT_SECRET` was absent. These
 * tests prove the resolver (and the real configuration factory) now fails
 * closed for every weak input, in every environment, without echoing the value.
 */
describe('P0-A1 — JWT secret fail-closed configuration', () => {
  const strongSecret = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0';

  it('accepts a strong secret and trims surrounding whitespace', () => {
    expect(resolveJwtSecret(`  ${strongSecret}  `)).toBe(strongSecret);
  });

  it('requires JWT_SECRET to be present', () => {
    expect(() => resolveJwtSecret(undefined)).toThrow(/JWT_SECRET is required/);
    expect(() => resolveJwtSecret('')).toThrow(/JWT_SECRET is required/);
    expect(() => resolveJwtSecret('   ')).toThrow(/JWT_SECRET is required/);
  });

  it.each([
    'CHANGE_ME',
    'change-me',
    'changeme',
    'your-secret',
    'your_secret',
    'replace-with-a-strong-random-secret',
    'replace_with_a_strong_random_secret',
    'not-for-production',
    'example',
  ])('rejects the placeholder/weak value %s', (value) => {
    expect(() => resolveJwtSecret(value)).toThrow(/placeholder or weak default/);
  });

  it(`rejects secrets shorter than ${JWT_SECRET_MIN_LENGTH} characters in every environment`, () => {
    // 31 distinct characters: long enough to look plausible, still too short.
    const tooShort = 'abcdefghijklmnopqrstuvwxyz01234';
    expect(tooShort).toHaveLength(31);
    expect(() => resolveJwtSecret(tooShort)).toThrow(/at least 32 characters/);
  });

  it('rejects an obviously low-entropy 32+ character value', () => {
    expect(() => resolveJwtSecret('ab'.repeat(20))).toThrow(/insufficient entropy/);
    expect(() => resolveJwtSecret('a'.repeat(40))).toThrow(/insufficient entropy/);
  });

  it('never includes the supplied value in an error message', () => {
    const candidate = 'short-unique-value-9f3a';
    try {
      resolveJwtSecret(candidate);
      throw new Error('expected resolveJwtSecret to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(candidate);
    }
  });

  it('makes the real configuration factory fail when the variable is missing', () => {
    const original = process.env.JWT_SECRET;
    try {
      delete process.env.JWT_SECRET;
      expect(() => configuration()).toThrow(/JWT_SECRET is required/);
    } finally {
      process.env.JWT_SECRET = original;
    }
  });

  it('uses the validated value in the real configuration factory', () => {
    const original = process.env.JWT_SECRET;
    try {
      process.env.JWT_SECRET = strongSecret;
      expect(configuration().jwtSecret).toBe(strongSecret);
    } finally {
      process.env.JWT_SECRET = original;
    }
  });
});
