import { readFileSync } from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

/**
 * Money-discrepancy fixtures for the browser suite.
 *
 * The demo seed only contains healthy orders, and no HTTP endpoint can create
 * an under-collected order on purpose (payment amount always equals the order
 * total). The reconciliation screen exists to show exactly those anomalies, so
 * the browser test writes four small, clearly-marked orders straight into the
 * isolated test schema — the same way the API E2E suite seeds its fixtures.
 *
 * Safety:
 *  - the connection string comes from `TEST_DATABASE_URL` and must name a
 *    `*_test` database (the Playwright config loads `apps/api/.env`);
 *  - every row carries the `PW-RECON-` prefix and cleanup deletes only rows
 *    with that prefix;
 *  - nothing here is imported by application code.
 */

const PREFIX = 'PW-RECON';
const ADDRESS = JSON.stringify({
  recipientName: 'Khách đối chiếu',
  phone: '0911111111',
  province: 'Hưng Yên',
  detail: 'Số 1, đường kiểm thử',
});

export interface ReconciliationFixtures {
  runId: string;
  prefix: string;
  orders: {
    partialId: number;
    overId: number;
    evidenceId: number;
    cleanId: number;
    refundedId: number;
  };
  codes: {
    partial: string;
    over: string;
    evidence: string;
    clean: string;
    refunded: string;
  };
}

function connectionUrl(): string {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (!url) throw new Error('TEST_DATABASE_URL is required for the reconciliation browser fixtures');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/_test$/i.test(dbName)) {
    throw new Error(`Refusing to write reconciliation fixtures into "${dbName}"`);
  }
  return url;
}

/** `.env` is loaded by playwright.config; this keeps the helper standalone. */
export function loadTestEnvFile(): void {
  if (process.env.TEST_DATABASE_URL) return;
  try {
    const env = readFileSync(path.resolve(__dirname, '../../apps/api/.env'), 'utf8');
    const match = env.match(/^TEST_DATABASE_URL=(.*)$/m);
    if (match) process.env.TEST_DATABASE_URL = match[1].trim().replace(/^"|"$/g, '');
  } catch {
    // The guard below reports the missing URL with a clear message.
  }
}

async function connect() {
  const url = new URL(connectionUrl());
  return mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  });
}

export async function seedReconciliationFixtures(): Promise<ReconciliationFixtures> {
  loadTestEnvFile();
  const connection = await connect();
  const runId = Date.now().toString(36);
  const prefix = `${PREFIX}-${runId}`;

  try {
    const [customers] = await connection.query<mysql.RowDataPacket[]>(
      "select id from users where email = 'lan.nguyen@agrimarket.vn' limit 1",
    );
    if (customers.length === 0) throw new Error('Seeded customer lan.nguyen@agrimarket.vn is missing');
    const customerId = customers[0].id as number;

    const insertOrder = async (suffix: string, grandTotal: number, status: string) => {
      const code = `${prefix}-${suffix}`;
      const [result] = await connection.query<mysql.ResultSetHeader>(
        `insert into orders
           (code, customer_id, shipping_address_snapshot, subtotal, discount_total, shipping_fee,
            grand_total, status, created_at, updated_at)
         values (?, ?, ?, ?, 0, 0, ?, ?, now(3), now(3))`,
        [code, customerId, ADDRESS, grandTotal, grandTotal, status],
      );
      return { id: result.insertId, code };
    };

    const insertPayment = async (
      orderId: number,
      amount: number,
      status: string,
      paidAt: string | null,
    ) => {
      const [result] = await connection.query<mysql.ResultSetHeader>(
        `insert into payments (order_id, method, amount, status, paid_at, created_at, updated_at)
         values (?, 'COD', ?, ?, ${paidAt ? 'now(3)' : 'null'}, now(3), now(3))`,
        [orderId, amount, status],
      );
      return result.insertId;
    };

    const insertRefund = async (paymentId: number, amount: number) => {
      await connection.query(
        `insert into refunds
           (payment_id, amount, reason, status, reference, approved_at, completed_at, created_at, updated_at)
         values (?, ?, 'Hoàn một phần (fixture đối chiếu)', 'COMPLETED', ?, now(3), now(3), now(3), now(3))`,
        [paymentId, amount, `PW-REFUND-${runId}`],
      );
    };

    // 1. Under-collected: 120.000 collected of 300.000.
    const partial = await insertOrder('PARTIAL', 300000, 'DELIVERED');
    await insertPayment(partial.id, 120000, 'PAID', 'now');

    // 2. Over-collected: 150.000 collected of 100.000.
    const over = await insertOrder('OVER', 100000, 'DELIVERED');
    await insertPayment(over.id, 150000, 'PAID', 'now');

    // 3. Claimed but unevidenced: PAID without `paid_at`.
    const evidence = await insertOrder('EVIDENCE', 90000, 'DELIVERED');
    await insertPayment(evidence.id, 90000, 'PAID', null);

    // 4. Clean: fully collected.
    const clean = await insertOrder('CLEAN', 80000, 'DELIVERED');
    await insertPayment(clean.id, 80000, 'PAID', 'now');

    // 5. Clean with a completed partial refund (payment status is derived).
    const refunded = await insertOrder('REFUNDED', 70000, 'DELIVERED');
    const refundedPayment = await insertPayment(refunded.id, 70000, 'PARTIALLY_REFUNDED', 'now');
    await insertRefund(refundedPayment, 20000);

    return {
      runId,
      prefix,
      orders: {
        partialId: partial.id,
        overId: over.id,
        evidenceId: evidence.id,
        cleanId: clean.id,
        refundedId: refunded.id,
      },
      codes: {
        partial: partial.code,
        over: over.code,
        evidence: evidence.code,
        clean: clean.code,
        refunded: refunded.code,
      },
    };
  } finally {
    await connection.end();
  }
}

export async function cleanupReconciliationFixtures(prefix: string): Promise<void> {
  loadTestEnvFile();
  const connection = await connect();
  try {
    await connection.query(
      `delete r from refunds r
         join payments p on p.id = r.payment_id
         join orders o on o.id = p.order_id
        where o.code like ?`,
      [`${prefix}-%`],
    );
    await connection.query(
      `delete p from payments p join orders o on o.id = p.order_id where o.code like ?`,
      [`${prefix}-%`],
    );
    await connection.query('delete from orders where code like ?', [`${prefix}-%`]);
  } finally {
    await connection.end();
  }
}
