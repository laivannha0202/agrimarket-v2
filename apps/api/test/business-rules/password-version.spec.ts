import { describe, expect, it } from 'vitest';
import { passwordVersion } from '../../src/auth/password-version.js';

/**
 * The password version is what ties an access token to the password it was
 * issued for, so `JwtStrategy` can end a session when the password changes.
 *
 * It is deliberately NOT a comparison between the token's `iat` and
 * `passwordChangedAt`: `iat` is truncated to whole seconds, so a token minted
 * in the same second as the change is indistinguishable from the fresh token
 * the change issued. These tests pin the property that makes the difference —
 * the version changes on EVERY password change, at millisecond resolution.
 */

describe('passwordVersion', () => {
  it('is 0 for an account that never changed its password', () => {
    expect(passwordVersion(null)).toBe(0);
    expect(passwordVersion(undefined)).toBe(0);
  });

  it('is the epoch milliseconds of the last change', () => {
    const changedAt = new Date('2026-10-12T08:30:00.000Z');
    expect(passwordVersion(changedAt)).toBe(changedAt.getTime());
  });

  it('distinguishes two changes in the SAME second', () => {
    // This is the case an `iat` comparison cannot handle: both changes land in
    // one second, so a second-precision timestamp would give them one value and
    // a token from before the second change would keep working.
    const first = new Date('2026-10-12T08:30:00.100Z');
    const second = new Date('2026-10-12T08:30:00.900Z');

    expect(first.toISOString().slice(0, 19)).toBe(second.toISOString().slice(0, 19));
    expect(passwordVersion(first)).not.toBe(passwordVersion(second));
  });

  it('differs from 0 as soon as a password is set', () => {
    // A reset stamps `passwordChangedAt`, so tokens minted before it (carrying
    // 0) stop matching and the account is signed out everywhere.
    expect(passwordVersion(new Date(1))).not.toBe(0);
  });
});
