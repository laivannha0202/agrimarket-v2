/**
 * Differential check: the Customer Web voucher helpers must behave exactly like
 * the Mobile ones (Web's file is a documented port). Runs the same voucher
 * fixtures through both implementations and compares the verdicts.
 *
 * Read-only. Not part of the repo's test suite.
 */
// Run from apps/customer-web with a TS runner that resolves workspace paths,
// e.g.:  ../mobile/node_modules/.bin/tsx qa/vouchers-parity.ts
// (tsx resolves the relative imports below from this file's directory,
// so the script works on any checkout — no machine-specific absolute paths).
import type { Voucher } from '../src/lib/api/types.js';
import * as web from '../src/lib/vouchers.js';
import * as mobile from '../../mobile/src/lib/vouchers.js';

const NOW = new Date('2026-10-12T00:00:00Z').getTime();

const base: Voucher = {
  id: 1,
  code: 'HUNGYEN50K',
  name: 'Giảm 50.000đ cho đơn từ 300.000đ',
  discountType: 'FIXED',
  discountValue: '50000',
  minOrderAmount: '300000',
  maxDiscount: '50000',
  startsAt: '2026-09-08T00:00:00.000Z',
  endsAt: '2026-12-07T23:59:59.000Z',
  usageLimit: 100,
  usedCount: 10,
  perCustomerLimit: 1,
  status: 'ACTIVE',
};

type Case = [string, Partial<Voucher>, number | null, { now?: number; customerUsage?: number }];

const cases: Case[] = [
  ['usable, subtotal above min', {}, 400000, {}],
  ['below minimum', {}, 100000, {}],
  ['no subtotal in view', {}, null, {}],
  ['exactly at minimum', {}, 300000, {}],
  ['inactive status', { status: 'INACTIVE' }, 400000, {}],
  ['before window', {}, 400000, { now: new Date('2026-01-01T00:00:00Z').getTime() }],
  ['after window', {}, 400000, { now: new Date('2027-01-01T00:00:00Z').getTime() }],
  ['quota exhausted', { usageLimit: 10, usedCount: 10 }, 400000, {}],
  ['quota null = unlimited', { usageLimit: null, usedCount: 9999 }, 400000, {}],
  ['per-customer already used', {}, 400000, { customerUsage: 1 }],
  ['per-customer below limit', {}, 400000, { customerUsage: 0 }],
  ['per-customer null = unlimited', { perCustomerLimit: null }, 400000, { customerUsage: 99 }],
  ['percent voucher', { discountType: 'PERCENT', discountValue: '10', maxDiscount: null }, 400000, {}],
  ['bad date string', { startsAt: 'not-a-date' }, 400000, {}],
  ['inactive beats below-min', { status: 'INACTIVE' }, 1000, {}],
  ['period beats quota', { usageLimit: 0, usedCount: 5 }, 400000, { now: new Date('2020-01-01T00:00:00Z').getTime() }],
];

const lines: string[] = [];
let failures = 0;

for (const [label, overrides, subtotal, options] of cases) {
  const voucher = { ...base, ...overrides };
  const w = web.evaluateVoucher(voucher, subtotal, { now: NOW, ...options });
  const m = mobile.evaluateVoucher(voucher, subtotal, { now: NOW, ...options });
  const same =
    w.eligibility === m.eligibility && w.eligible === m.eligible && w.reason === m.reason;
  if (!same) failures += 1;
  lines.push(
    `${same ? 'OK  ' : 'DIFF'} | ${label.padEnd(28)} | web=${w.eligibility}/${w.reason ?? '-'} | mobile=${m.eligibility}/${m.reason ?? '-'}`,
  );
}

// Ordering + grouping.
const catalogue: Voucher[] = [
  { ...base, id: 1, code: 'SMALL', discountValue: '10000' },
  { ...base, id: 2, code: 'HUGE', discountValue: '90000' },
  { ...base, id: 3, code: 'BIG', discountValue: '50000' },
  { ...base, id: 4, code: 'DEAD', discountValue: '70000', status: 'INACTIVE' },
  { ...base, id: 5, code: 'PCT', discountValue: '5', discountType: 'PERCENT' },
];
const ws = web.splitVouchers(catalogue, null, { now: NOW });
const ms = mobile.splitVouchers(catalogue, null, { now: NOW });
const wCodes = ws.eligible.map((o) => o.voucher.code).join(',');
const mCodes = ms.eligible.map((o) => o.voucher.code).join(',');
const wDead = ws.ineligible.map((o) => o.voucher.code).join(',');
const mDead = ms.ineligible.map((o) => o.voucher.code).join(',');
if (wCodes !== mCodes) failures += 1;
if (wDead !== mDead) failures += 1;
lines.push(`${wCodes === mCodes ? 'OK  ' : 'DIFF'} | eligible order               | web=${wCodes} | mobile=${mCodes}`);
lines.push(`${wDead === mDead ? 'OK  ' : 'DIFF'} | ineligible order             | web=${wDead} | mobile=${mDead}`);

// Labels.
for (const v of [
  { discountType: 'FIXED', discountValue: '50000' },
  { discountType: 'PERCENT', discountValue: '10' },
  { discountType: 'FIXED', discountValue: '1234.5' },
  { discountType: 'FIXED', discountValue: 'NaN' },
] as Array<Pick<Voucher, 'discountType' | 'discountValue'>>) {
  const w = web.voucherValueLabel(v);
  const m = mobile.voucherValueLabel(v);
  if (w !== m) failures += 1;
  lines.push(`${w === m ? 'OK  ' : 'DIFF'} | label ${JSON.stringify(v)} | web=${w} | mobile=${m}`);
}

console.log(lines.join('\n'));
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} difference(s) across ${lines.length} checks`);
process.exit(failures === 0 ? 0 : 1);
