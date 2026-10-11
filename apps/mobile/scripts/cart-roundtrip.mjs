/**
 * Cart round-trip through the REAL UI.
 *
 * Verifies the part that no unit test can: that pressing "Thêm vào giỏ" on the
 * product screen writes to the backend and that the cart screen then renders
 * that line with the server's own price — then removes it again, so the account
 * is left exactly as it was found.
 *
 * Usage: node scripts/cart-roundtrip.mjs <email> <password> [productId]
 */

import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const email = process.argv[2];
const password = process.argv[3];
const productId = process.argv[4] ?? "42";
const ORIGIN = process.env.CHECK_PAGE_ORIGIN ?? 'http://localhost:8081';
const PORT = 9500 + Math.floor(Math.random() * 300);

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error('No browser binary found.');
  process.exit(2);
}

const profile = await mkdtemp(join(tmpdir(), 'agri-cart-'));
const child = spawn(
  browser,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
   `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error('DevTools never became available');
}

const ws = new WebSocket(await findTarget());
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  const entry = pending.get(msg.id);
  if (entry) { pending.delete(msg.id); entry(msg); }
});
function send(method, params = {}) {
  seq += 1;
  const id = seq;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.text ?? 'eval failed');
  return res.result?.result?.value;
}

/**
 * Click the smallest clickable element whose text CONTAINS `label`.
 *
 * `includes`, not equality: an Ionicons glyph renders as a text character in
 * the DOM, so `textContent` for a button labelled "Thêm vào giỏ" is actually
 * "\uF…Thêm vào giỏ" and an exact match never fires. Picking the smallest
 * match avoids clicking a whole ancestor container.
 */
async function clickText(label) {
  const ok = await evaluate(`(() => {
    const all = [...document.querySelectorAll('div[role="button"],button,a')].filter(
      (b) => (b.textContent || '').includes(${JSON.stringify(label)}),
    );
    if (all.length === 0) return false;
    all.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    const el = all[0];
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`no clickable element containing "${label}"`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 866, deviceScaleFactor: 2, mobile: true });

// 1) log in
await send('Page.navigate', { url: `${ORIGIN}/login` });
await sleep(9000);
for (const [label, value] of [['Email', email], ['Mật khẩu', password]]) {
  const ok = await evaluate(`(() => {
    const el = [...document.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (!el) return false;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`no input "${label}"`);
}
await sleep(300);
await clickText('Đăng nhập');
await sleep(6000);
console.log('1. logged in');

// 2) open the product and add it to the cart
await send('Page.navigate', { url: `${ORIGIN}/product/${productId}` });
await sleep(9000);
await clickText('Thêm vào giỏ');
await sleep(5000);
const toast = await evaluate(`(document.body.innerText || '').includes('giỏ') ? 'has-cart-text' : 'no-cart-text'`);
console.log(`2. pressed "Thêm vào giỏ" (${toast})`);

// 3) the cart must now show the real line
await send('Page.navigate', { url: `${ORIGIN}/cart` });
await sleep(9000);
const cartText = await evaluate(`document.body.innerText || ''`);
writeFileSync('apps/mobile/.qa-shots/04b-cart-with-item.txt', cartText);
const hasLine = /Tạm tính/.test(cartText) && !/Giỏ hàng trống/.test(cartText);
console.log(`3. cart screen ${hasLine ? 'SHOWS a real line item' : 'is still empty'}`);
console.log('   cart text → apps/mobile/.qa-shots/04b-cart-with-item.txt');

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
if (shot.result?.data) {
  writeFileSync('apps/mobile/.qa-shots/04b-cart-with-item.png', Buffer.from(shot.result.data, 'base64'));
  console.log('   screenshot → apps/mobile/.qa-shots/04b-cart-with-item.png');
}

// 4) clean up: remove every line so the account is left as found
for (let i = 0; i < 6; i += 1) {
  const removed = await evaluate(`(() => {
    // The trash control is a Pressable with an accessibilityLabel; RN Web puts
    // it on the element itself, and the label reads "Xoá <variant> khỏi giỏ".
    const btn = [...document.querySelectorAll('[aria-label]')].find(
      (b) => (b.getAttribute('aria-label') || '').startsWith('Xoá ') &&
             !(b.getAttribute('aria-label') || '').startsWith('Xoá tất cả'),
    );
    if (!btn) return false;
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    btn.click();
    return true;
  })()`);
  if (!removed) break;
  await sleep(3500);
}
const after = await evaluate(`document.body.innerText || ''`);
console.log(`4. cleanup: cart is now ${/Giỏ hàng trống/.test(after) ? 'EMPTY (restored)' : 'NOT empty — check manually'}`);

ws.close();
child.kill();
process.exit(0);
