/**
 * Geometry probe for a single selector: reports the box of an element and of
 * its descendants, so "the image escapes its rounded frame" can be confirmed
 * with numbers instead of eyeballed pixels.
 *
 * Usage: node scripts/box-probe.mjs <route> <cssText> [width] [height]
 *   cssText: substring matched against element text or class (first match wins)
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const route = process.argv[2] ?? '/';
// NOTE: PowerShell DROPS an empty-string argument when calling a native binary,
// which silently shifted every following positional argument (the viewport ended
// up 866px wide, so every box measured looked wrong). Pass a real needle such as
// "-" when you only want the geometry of all images.
const needle = process.argv[3] ?? '';
const width = Number(process.argv[4] ?? 400);
const height = Number(process.argv[5] ?? 866);
const ORIGIN = process.env.CHECK_PAGE_ORIGIN ?? 'http://localhost:8081';
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

const profile = await mkdtemp(join(tmpdir(), 'agri-box-'));
const child = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
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
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: `${ORIGIN}${route}` });
await sleep(9000);

const report = await evaluate(`(() => {
  const describe = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 60),
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
      radius: cs.borderRadius,
      overflow: cs.overflow,
      objectFit: cs.objectFit || '',
    };
  };
  const out = [];
  for (const img of document.querySelectorAll('img')) {
    const r = img.getBoundingClientRect();
    if (r.width < 60 || r.height < 60) continue;
    out.push({
      img: describe(img),
      parent: describe(img.parentElement),
      grandparent: describe(img.parentElement?.parentElement),
      // The visible label nearest this image, to identify which card it is.
      label: (img.closest('div')?.parentElement?.textContent || '').trim().slice(0, 30),
    });
  }
  return { count: out.length, images: out.slice(0, 14) };
})()`);

console.log(`route  : ${route}`);
console.log(`needle : ${JSON.stringify(needle)}`);
console.log(`viewport: ${width}x${height}`);
console.log(JSON.stringify(report, null, 2));

ws.close();
child.kill();
process.exit(0);
