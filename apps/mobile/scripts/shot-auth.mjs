/**
 * Authenticated screenshot via CDP.
 *
 * The tabs that matter most (cart, checkout, orders, account) are behind a
 * session, and a screenshot of "please log in" proves nothing about them. This
 * logs in through the REAL login screen — typing into the same inputs a person
 * uses and pressing the same button — so the captured screen is the genuine
 * post-login UI driven by the real backend, not a stubbed state.
 *
 * Credentials come from the seed (`Agri@12345` for the seeded customers) and are
 * passed in by the caller, never hard-coded here.
 *
 * Usage:
 *   node scripts/shot-auth.mjs <route> <outfile> <email> <password> [w] [h] [scrollY]
 */

import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const route = process.argv[2] ?? '/';
const outFile = process.argv[3] ?? join(tmpdir(), 'agri-auth-shot.png');
const email = process.argv[4] ?? '';
const password = process.argv[5] ?? '';
const width = Number(process.argv[6] ?? 400);
const height = Number(process.argv[7] ?? 866);
const scrollY = Number(process.argv[8] ?? 0);
const ORIGIN = process.env.CHECK_PAGE_ORIGIN ?? 'http://localhost:8081';
const PORT = 9300 + Math.floor(Math.random() * 300);

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

const profile = await mkdtemp(join(tmpdir(), 'agri-auth-shot-'));
const child = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Scroll the page's own scroller, not `window`.
 *
 * Expo Router renders screens inside a flex layout where the scrolling element
 * is an inner `div`, so `window.scrollTo` does nothing and every "scrolled"
 * screenshot silently returned the top of the page. This finds the deepest
 * element that actually overflows and scrolls that.
 */
function scrollExpression(y) {
  return `(() => {
    const candidates = [...document.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      const scrollable = /(auto|scroll)/.test(cs.overflowY);
      return scrollable && el.scrollHeight - el.clientHeight > 40;
    });
    if (candidates.length === 0) { window.scrollTo(0, ${y}); return 'window'; }
    candidates.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    const el = candidates[0];
    el.scrollTop = ${y};
    return 'inner:' + Math.round(el.scrollTop);
  })()`;
}

async function findTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* not ready */
    }
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
  if (entry) {
    pending.delete(msg.id);
    entry(msg);
  }
});

function send(method, params = {}) {
  seq += 1;
  const id = seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.text ?? 'eval failed');
  return res.result?.result?.value;
}

/** Type into a controlled React input the way a person does, then dispatch input. */
async function typeInto(label, value) {
  const ok = await evaluate(`(() => {
    const el = [...document.querySelectorAll('input')].find(
      (i) => i.getAttribute('aria-label') === ${JSON.stringify(label)},
    );
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`no input labelled ${label}`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });

// 1) Log in through the real screen.
await send('Page.navigate', { url: `${ORIGIN}/login` });
await sleep(9000);
await typeInto('Email', email);
await typeInto('Mật khẩu', password);
await sleep(400);

const pressed = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('div[role="button"],button')].find(
    (b) => (b.textContent || '').trim() === 'Đăng nhập',
  );
  if (!btn) return false;
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  btn.click();
  return true;
})()`);
if (!pressed) throw new Error('login button not found');
await sleep(6000);

const loggedIn = await evaluate(
  `(document.body.innerText || '').includes('Đăng xuất') || !(document.body.innerText || '').includes('Vui lòng nhập email')`,
);
if (!loggedIn) console.error('WARN: login may not have completed');

// 2) Navigate to the requested route with the session now in storage.
await send('Page.navigate', { url: `${ORIGIN}${route}` });
await sleep(9000);

if (scrollY > 0) {
  const where = await evaluate(scrollExpression(scrollY));
  console.log(`scrolled via ${where}`);
  await sleep(1500);
}

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
if (!shot.result?.data) {
  console.error('Screenshot capture failed:', JSON.stringify(shot).slice(0, 300));
  process.exit(1);
}
writeFileSync(outFile, Buffer.from(shot.result.data, 'base64'));
console.log(`saved ${outFile} (${width}x${height} @2x, route=${route}, scrollY=${scrollY}, auth=${email})`);

ws.close();
child.kill();
process.exit(0);
