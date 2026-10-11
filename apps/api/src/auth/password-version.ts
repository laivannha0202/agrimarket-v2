/**
 * Binding an access token to the password it was issued for.
 *
 * A JWT is stateless: it cannot be deleted from a session store that does not
 * exist. To end a session when the password changes, every token is stamped
 * with a *password version* and `JwtStrategy` refuses any token whose version
 * no longer matches the account.
 *
 * WHY NOT COMPARE `iat` WITH `passwordChangedAt`
 *
 * That is the obvious approach and it does not work reliably: JWT `iat` has
 * ONE-SECOND precision. A token minted in the same second as the password
 * change is indistinguishable from the fresh token the change issued, so a
 * timestamp comparison must either keep a fudge window — which leaves the old
 * token alive for that window — or reject the new token along with the old one.
 * An exact version has neither problem, and it survives any future change to
 * how or where the password is updated.
 *
 * The version is simply the epoch milliseconds of the last password change, so
 * it needs no extra column and no extra bookkeeping. Accounts that have never
 * changed their password use 0.
 */

/** The password version an account's tokens must currently carry. */
export function passwordVersion(passwordChangedAt: Date | null | undefined): number {
  return passwordChangedAt ? passwordChangedAt.getTime() : 0;
}
