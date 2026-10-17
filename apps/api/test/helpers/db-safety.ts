/**
 * Safety interlock for the destructive e2e suites.
 *
 * Those suites rewrite and delete rows against `TEST_DATABASE_URL`. If that
 * variable ever aliases the database the API itself runs on, the "test" run
 * would destroy live development or production data — a mistake that is
 * invisible until it is too late. This module makes the mistake loud: it is
 * called from `test/setup-e2e.ts` before any connection is opened, and it
 * throws instead of skipping (a skip would masquerade as "no test database
 * configured" and hide the misconfiguration).
 *
 * Same MySQL server is fine and expected — the test schema is normally a
 * sibling. Only the same server *and* the same database name is refused.
 */

export interface DatabaseTarget {
  host: string;
  database: string;
}

/** `host` + database name of a MySQL URL, or null for an unset/unparsable value. */
export function parseDatabaseTarget(url: string | undefined | null): DatabaseTarget | null {
  const raw = url?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const database = parsed.pathname.replace(/^\//, '');
    if (!parsed.hostname || !database) return null;
    return {
      // `localhost` and `127.0.0.1` address the same server in practice.
      host: parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname,
      database,
    };
  } catch {
    return null;
  }
}

/**
 * True when the test URL targets exactly the database the application uses.
 * Unparsable or missing URLs are never "the same" — the suites already skip
 * when `TEST_DATABASE_URL` is absent.
 */
export function isSameDatabase(testUrl: string | undefined | null, appUrl: string | undefined | null): boolean {
  const target = parseDatabaseTarget(testUrl);
  const appTarget = parseDatabaseTarget(appUrl);
  if (!target || !appTarget) return false;
  return target.host === appTarget.host && target.database === appTarget.database;
}

/**
 * Throws when `TEST_DATABASE_URL` is not an isolated database. The error names
 * the host and schema (never the credentials) so the fix is obvious.
 */
export function assertIsolatedTestDatabase(env: {
  TEST_DATABASE_URL?: string;
  DATABASE_URL?: string;
}): void {
  if (!isSameDatabase(env.TEST_DATABASE_URL, env.DATABASE_URL)) return;
  const target = parseDatabaseTarget(env.TEST_DATABASE_URL);
  throw new Error(
    [
      'Refusing to run destructive e2e tests: TEST_DATABASE_URL points at the same',
      `database as DATABASE_URL (${target?.host}/${target?.database}).`,
      'Create a separate test schema (e.g. `agrimarket_v2_test`) and point',
      'TEST_DATABASE_URL at it. Credentials are never printed.',
    ].join(' '),
  );
}
