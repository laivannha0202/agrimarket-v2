import { describe, expect, it } from 'vitest';
import {
  assertIsolatedTestDatabase,
  isSameDatabase,
  parseDatabaseTarget,
} from '../helpers/db-safety.js';

/**
 * The destructive e2e suites must never be pointed at the application database.
 * This pins the interlock that stops them: it fires only on a real collision
 * (same host AND same schema) and stays quiet for the normal setup, where the
 * test schema is a sibling of the dev schema on the same MySQL server.
 */
describe('e2e database safety interlock', () => {
  const dev = 'mysql://root:secret@127.0.0.1:3306/agrimarket_v2';

  it('refuses a TEST_DATABASE_URL that is the application database', () => {
    expect(() =>
      assertIsolatedTestDatabase({ DATABASE_URL: dev, TEST_DATABASE_URL: dev }),
    ).toThrow(/Refusing to run destructive e2e tests/);
  });

  it('treats localhost and 127.0.0.1 as the same server', () => {
    const viaLocalhost = 'mysql://root:secret@localhost:3306/agrimarket_v2';
    expect(() =>
      assertIsolatedTestDatabase({ DATABASE_URL: dev, TEST_DATABASE_URL: viaLocalhost }),
    ).toThrow(/Refusing to run destructive e2e tests/);
  });

  it('does not put the credentials in the error message', () => {
    let message = '';
    try {
      assertIsolatedTestDatabase({ DATABASE_URL: dev, TEST_DATABASE_URL: dev });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain('secret');
    expect(message).toContain('agrimarket_v2');
  });

  it('allows the normal sibling-schema setup on the same server', () => {
    expect(() =>
      assertIsolatedTestDatabase({
        DATABASE_URL: dev,
        TEST_DATABASE_URL: 'mysql://root:secret@127.0.0.1:3306/agrimarket_v2_test',
      }),
    ).not.toThrow();
  });

  it('allows a test database on a different server', () => {
    expect(() =>
      assertIsolatedTestDatabase({
        DATABASE_URL: dev,
        TEST_DATABASE_URL: 'mysql://root:secret@10.0.0.9:3306/agrimarket_v2',
      }),
    ).not.toThrow();
    expect(isSameDatabase(dev, 'mysql://root:secret@10.0.0.9:3306/agrimarket_v2')).toBe(false);
  });

  it('stays quiet when a URL is missing or unparsable (the suites skip anyway)', () => {
    expect(() => assertIsolatedTestDatabase({})).not.toThrow();
    expect(() => assertIsolatedTestDatabase({ TEST_DATABASE_URL: dev })).not.toThrow();
    expect(() =>
      assertIsolatedTestDatabase({ DATABASE_URL: dev, TEST_DATABASE_URL: 'not-a-url' }),
    ).not.toThrow();
  });

  it('parses host and schema from a URL — never the password', () => {
    expect(parseDatabaseTarget(dev)).toEqual({ host: '127.0.0.1', database: 'agrimarket_v2' });
    expect(parseDatabaseTarget('mysql://u:p@mysql.internal:3307/shop_test')).toEqual({
      host: 'mysql.internal',
      database: 'shop_test',
    });
    expect(parseDatabaseTarget(undefined)).toBeNull();
    expect(parseDatabaseTarget('   ')).toBeNull();
    // No schema in the path: nothing to compare, so it cannot be "the same".
    expect(parseDatabaseTarget('mysql://u:p@127.0.0.1:3306')).toBeNull();
  });
});
