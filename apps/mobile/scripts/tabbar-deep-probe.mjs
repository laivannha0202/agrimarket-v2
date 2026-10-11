/**
 * Tab-bar label clipping diagnosis.
 *
 * Walks from each tab label up to the tab bar and prints every ancestor's box,
 * computed height, flex settings and overflow. This shows *which* box is
 * squeezing the label instead of guessing.
 *
 * Usage: node scripts/tabbar-deep-probe.mjs [route] [width] [height]
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
const PORT = 9400 + Math.floor(Math.random() * 200);

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

const profile = await mkdtemp(join(tmpdir(), 'agri-deep-'));
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
  const vh = window.innerHeight;
  const all = [...document.querySelectorAll('*')];
  const labelEl = all.filter(el => (el.textContent || '').trim() === 'Trang chủ'
      && el.getBoundingClientRect().top > vh * 0.5
      && el.getBoundingClientRect().height < 40).pop();
  if (!labelEl) return { error: 'label not found' };

  const chain = [];
  let el = labelEl;
  for (let i = 0; i < 9 && el; i += 1) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    chain.push({
      level: i,
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 46),
      top: Math.round(r.top * 10) / 10,
      bottom: Math.round(r.bottom * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      cssHeight: cs.height,
      minHeight: cs.minHeight,
      maxHeight: cs.maxHeight,
      display: cs.display,
      flexDir: cs.flexDirection,
      flexGrow: cs.flexGrow,
      flexShrink: cs.flexShrink,
      flexBasis: cs.flexBasis,
      padding: cs.padding,
      overflow: cs.overflow,
      fontFamily: cs.fontFamily.slice(0, 30),
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      position: cs.position,
      inset: cs.bottom,
    });
    el = el.parentElement;
  }
  return { viewportHeight: vh, chain, labelScroll: { sh: labelEl.scrollHeight, ch: labelEl.clientHeight } };
})()`);

if (report.error) {
  console.error(report.error);
  process.exit(1);
}

console.log(`route: ${route} @ ${width}x${height}  viewportHeight=${report.viewportHeight}`);
console.log(`label scrollHeight=${report.labelScroll.sh} clientHeight=${report.labelScroll.ch}`);
console.log('');
console.log('ancestor chain (label -> up):');
for (const n of report.chain) {
  console.log(
    `[${n.level}] <${n.tag}> h=${n.h} cssH=${n.cssHeight} minH=${n.minHeight} maxH=${n.maxHeight} ` +
      `flex=${n.flexGrow}/${n.flexShrink}/${n.flexBasis} dir=${n.flexDir} pad=${n.padding} ovf=${n.overflow} pos=${n.position} bottom=${n.inset}`,
  );
  console.log(`      top=${n.top} bottom=${n.bottom} font=${n.fontSize} line=${n.lineHeight} fam=${n.fontFamily}`);
  if (n.cls) console.log(`      class="${n.cls}"`);
}

ws.close();
child.kill();
process.exit(0);
