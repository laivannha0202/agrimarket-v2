/**
 * Section-header edge clearance probe.
 *
 * Reports, for every section header action ("Xem tất cả") and title, how many
 * pixels of gap remain to the left/right viewport edge. The acceptance criteria
 * require no clipped text, so anything under ~8px is flagged.
 *
 * Usage: node scripts/header-probe.mjs [route] [width] [height]
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

const profile = await mkdtemp(join(tmpdir(), 'agri-header-'));
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
await sleep(10000);

const report = await evaluate(`(() => {
  const vw = window.innerWidth;
  const all = [...document.querySelectorAll('*')];
  const rows = [];
  const seen = new Set();

  for (const el of all) {
    const txt = (el.textContent || '').trim();
    if (txt !== 'Xem tất cả') continue;
    const r = el.getBoundingClientRect();
    if (r.height === 0) continue;
    const key = Math.round(r.top) + ':' + Math.round(r.height);
    if (seen.has(key)) continue;
    seen.add(key);
    const cs = getComputedStyle(el);
    rows.push({
      top: Math.round(r.top),
      left: Math.round(r.left * 10) / 10,
      right: Math.round(r.right * 10) / 10,
      gapLeft: Math.round(r.left * 10) / 10,
      gapRight: Math.round((vw - r.right) * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      sh: el.scrollHeight,
      ch: el.clientHeight,
      clipped: el.scrollHeight > el.clientHeight + 1,
      pad: cs.padding,
    });
  }

  // Left-edge titles for comparison.
  const titles = [];
  for (const t of ['Danh mục', 'Sản phẩm nổi bật', 'Trang trại']) {
    const el = all.filter(e => (e.textContent || '').trim() === t && e.getBoundingClientRect().height > 0).pop();
    if (!el) continue;
    const r = el.getBoundingClientRect();
    titles.push({ title: t, left: Math.round(r.left * 10) / 10, h: Math.round(r.height * 10) / 10 });
  }

  return { viewportWidth: vw, actions: rows, titles };
})()`);

console.log(`route=${route} @${width}x${height} viewportWidth=${report.viewportWidth}`);
console.log('');
console.log('"Xem tất cả" actions:');
for (const a of report.actions) {
  const warn = a.gapRight < 8 || a.clipped ? '  <-- TIGHT/CLIPPED' : '';
  console.log(`  top=${String(a.top).padStart(4)} left=${String(a.left).padStart(6)} right=${String(a.right).padStart(6)} gapRight=${a.gapRight} h=${a.h} sh=${a.sh} ch=${a.ch}${warn}`);
}
console.log('');
console.log('section titles (left edge):');
for (const t of report.titles) {
  console.log(`  ${t.title.padEnd(18)} left=${t.left} h=${t.h}`);
}

ws.close();
child.kill();
process.exit(0);
