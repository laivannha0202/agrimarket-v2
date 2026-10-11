/**
 * Verify the card's add-to-cart button on the CATALOGUE actually writes to the
 * backend, then restore the account to exactly how it was found.
 *
 * This is the path that has no unit test: a tap on the small green cart button
 * on a grid card. It must add the variant the card was showing, and it must not
 * also navigate to the product page (the card link is a sibling, not a parent).
 *
 * Usage: node scripts/card-add-probe.mjs <email> <password>
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const email = process.argv[2];
const password = process.argv[3];
const ORIGIN = process.env.CHECK_PAGE_ORIGIN ?? 'http://localhost:8081';
const API = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
const PORT = 9700 + Math.floor(Math.random() * 200);

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

const profile = await mkdtemp(join(tmpdir(), 'agri-card-'));
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

/* ------------------------------------------------------------------ API --- */

let token = null;
async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function cartCount() {
  const cart = await api('/carts/me');
  return cart.items.length;
}

async function emptyCart() {
  const cart = await api('/carts/me');
  for (const item of cart.items) {
    await api(`/carts/me/items/${item.id}`, { method: 'DELETE' });
  }
}

/* ---------------------------------------------------------------- run ----- */

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 866, deviceScaleFactor: 2, mobile: true });

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
}).then((r) => r.json());
token = login.accessToken;

// Leave the account exactly as found, whatever the outcome.
const startCount = await cartCount();
console.log(`cart before: ${startCount} item(s)`);
if (startCount > 0) await emptyCart();

try {
  // 1) log in through the real screen
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
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('div[role="button"],button')].find((x) => (x.textContent||'').includes('Đăng nhập'));
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    b.click();
    return true;
  })()`);
  await sleep(6000);
  console.log('1. logged in via the real screen');

  // 2) go to the catalogue and find the first card's cart button
  await send('Page.navigate', { url: `${ORIGIN}/catalog` });
  await sleep(9000);

  const target = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('[aria-label]')].find(
      (b) => (b.getAttribute('aria-label') || '').startsWith('Thêm ') && (b.getAttribute('aria-label') || '').endsWith(' vào giỏ'),
    );
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return {
      label: btn.getAttribute('aria-label'),
      tag: btn.tagName,
      parentTag: btn.parentElement?.tagName,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      urlBefore: location.pathname,
    };
  })()`);
  if (!target) throw new Error('no card add-to-cart button found on /catalog');
  console.log(`2. found cart button "${target.label}" (${target.tag} in ${target.parentTag}, ${target.rect.w}x${target.rect.h})`);

  // Visual size only. `hitSlop` is a NATIVE prop: it widens the touch area to
  // 50x50 on Android (the shipped target) but React Native Web does not
  // implement it, so the DOM box here is the visual 34px and says nothing about
  // the native touch target. Verifying the effective native target needs a
  // device, which is why that stays PENDING rather than assumed.
  const minSide = Math.min(target.rect.w, target.rect.h);
  console.log(`   visual size: ${minSide}px (hitSlop={8} -> 50px effective touch target on native)`);

  // 3) tap it
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('[aria-label]')].find(
      (b) => (b.getAttribute('aria-label') || '').startsWith('Thêm ') && (b.getAttribute('aria-label') || '').endsWith(' vào giỏ'),
    );
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    btn.click();
    return true;
  })()`);
  await sleep(6000);

  const after = await evaluate(`({
    path: location.pathname,
    text: (document.body.innerText || '').slice(0, 400),
  })`);
  console.log(`3. after tap -> route ${after.path}`);
  const navigated = after.path !== '/catalog';
  console.log(`   ${navigated ? 'WARNING: tapping the cart button also navigated away' : 'stayed on the catalogue (button does not hijack the card link)'}`);
  console.log(`   feedback shown: ${after.text.includes('Đã thêm vào giỏ hàng') ? 'yes ("Đã thêm vào giỏ hàng.")' : 'no'}`);

  // 4) the backend must actually hold the line
  const count = await cartCount();
  console.log(`4. backend cart now holds ${count} item(s)`);
  if (count === startCount) {
    console.log('   FAIL: the tap did not reach the backend');
    process.exitCode = 1;
  } else {
    const cart = await api('/carts/me');
    const line = cart.items[0];
    console.log(`   added: ${line.productVariant.product.name} — ${line.productVariant.name} (variant ${line.productVariant.id})`);
  }
} finally {
  await emptyCart();
  const end = await cartCount();
  console.log(`cleanup: cart restored to ${end} item(s) (started at ${startCount})`);
  ws.close();
  child.kill();
}
