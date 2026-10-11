/**
 * Layout overflow probe.
 *
 * Loads an Expo Web route in headless Edge/Chrome at a phone-sized viewport and
 * reports the real geometry: does the document scroll horizontally, and which
 * elements extend past the viewport? Used to verify "no layout overflow" after
 * the icon/CORS fixes instead of eyeballing screenshots.
 *
 * Usage: node scripts/layout-probe.mjs [route] [width] [height]
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const route = process.argv[2] ?? '/';
const width = Number(process.argv[3] ?? 412);
const height = Number(process.argv[4] ?? 915);
const ORIGIN = process.env.CHECK_PAGE_ORIGIN ?? 'http://localhost:8081';
const PORT = 9334 + Math.floor(Math.random() * 200);

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error('No browser binary — layout probe BLOCKED.');
  process.exit(2);
}

const profile = await mkdtemp(join(tmpdir(), 'agri-layout-'));
const child = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    `--window-size=${width},${height}`,
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
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

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: true,
});
await send('Page.navigate', { url: `${ORIGIN}${route}` });
await sleep(9000);

const report = await evaluate(`(() => {
  const vw = window.innerWidth;
  const doc = document.documentElement;
  const overflowing = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1.5) {
      overflowing.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && String(el.className).slice(0, 40)) || '',
        text: (el.textContent || '').trim().slice(0, 40),
        left: Math.round(r.left),
        right: Math.round(r.right),
        w: Math.round(r.width),
      });
    }
  }
  return {
    innerWidth: vw,
    scrollWidth: doc.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    horizontalScroll: doc.scrollWidth > vw + 1,
    overflowCount: overflowing.length,
    worst: overflowing.sort((a, b) => b.right - a.right).slice(0, 12),
  };
})()`);

console.log(`route            : ${route} @ ${width}x${height}`);
console.log(`window.innerWidth: ${report.innerWidth}`);
console.log(`doc.scrollWidth  : ${report.scrollWidth}`);
console.log(`body.scrollWidth : ${report.bodyScrollWidth}`);
console.log(`horizontal scroll: ${report.horizontalScroll ? 'YES (overflow)' : 'no'}`);
console.log(`overflowing nodes: ${report.overflowCount}`);
for (const o of report.worst) {
  console.log(`  <${o.tag}> right=${o.right} w=${o.w} "${o.text}"`);
}

ws.close();
child.kill();
process.exit(0);
