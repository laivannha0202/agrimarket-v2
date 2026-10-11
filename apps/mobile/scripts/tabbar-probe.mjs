/**
 * Bottom tab-bar geometry probe.
 *
 * The acceptance criteria require tab labels to be fully visible (not clipped)
 * and the bar to clear the device safe area. This reads the real DOM boxes of
 * the tab bar and each label, and reports the viewport height, so clipping is a
 * measurement instead of a guess.
 *
 * Usage: node scripts/tabbar-probe.mjs [route] [width] [height]
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
const PORT = 9800 + Math.floor(Math.random() * 300);

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

const profile = await mkdtemp(join(tmpdir(), 'agri-tabbar-'));
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
  // The tab bar is the element that holds the tab buttons and sits at the bottom.
  const all = [...document.querySelectorAll('*')];
  const withText = (t) => all.filter(el => (el.textContent || '').trim() === t);

  const tabLabels = ['Trang chủ', 'Sản phẩm', 'Truy xuất', 'Giỏ hàng', 'Tài khoản'];
  const labelBoxes = [];
  for (const t of tabLabels) {
    const candidates = withText(t).filter(el => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.height < 40 && r.top > vh * 0.5;
    });
    if (candidates.length === 0) { labelBoxes.push({ label: t, found: false }); continue; }
    // innermost element = the Text node wrapper
    const el = candidates[candidates.length - 1];
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    labelBoxes.push({
      label: t,
      found: true,
      top: Math.round(r.top * 10) / 10,
      bottom: Math.round(r.bottom * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      clippedBelowViewport: r.bottom > vh + 0.5,
      scrollClipped: el.scrollHeight > el.clientHeight + 1,
    });
  }

  // Icon buttons in the tab bar: count svg/glyph fonts rendered.
  const tabIcons = all.filter(el => {
    const r = el.getBoundingClientRect();
    return r.top > vh * 0.85 && r.height > 8 && r.height < 40 && el.tagName.toLowerCase() === 'div'
      && getComputedStyle(el).fontFamily.toLowerCase().includes('ionicons');
  });

  // Any glyph-font node that shows the MissingIcon replacement char.
  const missing = all.filter(el => {
    const r = el.getBoundingClientRect();
    return r.top > vh * 0.8 && (el.textContent || '').includes('\\u23F7');
  });

  return {
    viewportHeight: vh,
    innerWidth: window.innerWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    labels: labelBoxes,
    iconFontNodes: tabIcons.length,
    missingIconNodes: missing.length,
  };
})()`);

console.log(`route             : ${route} @ ${width}x${height}`);
console.log(`viewport height   : ${report.viewportHeight}`);
console.log(`doc.scrollWidth   : ${report.docScrollWidth} (innerWidth ${report.innerWidth})`);
console.log(`tab icon-font nodes: ${report.iconFontNodes}`);
console.log(`"⏷" missing icons : ${report.missingIconNodes}`);
console.log('tab labels:');
for (const l of report.labels) {
  if (!l.found) {
    console.log(`  ${l.label.padEnd(12)} NOT FOUND`);
    continue;
  }
  const flag = l.clippedBelowViewport ? 'CLIPPED-BELOW-VIEWPORT' : 'visible';
  console.log(
    `  ${l.label.padEnd(12)} top=${String(l.top).padStart(6)} bottom=${String(l.bottom).padStart(6)} h=${l.h} font=${l.fontSize} line=${l.lineHeight} ${flag}`,
  );
}

ws.close();
child.kill();
process.exit(0);
