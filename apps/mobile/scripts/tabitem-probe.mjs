/**
 * Tab-item child measurement.
 *
 * Prints the real height of every child inside one bottom-tab item (icon
 * wrapper, glyph, label) plus the item's content box, so the tab bar height can
 * be sized from measurements rather than guesses.
 *
 * Usage: node scripts/tabitem-probe.mjs [route] [width] [height]
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
const PORT = 9500 + Math.floor(Math.random() * 200);

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

const profile = await mkdtemp(join(tmpdir(), 'agri-item-'));
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

  const item = labelEl.closest('a') || labelEl.parentElement.parentElement;

  const describe = (el, depth) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const out = [{
      depth,
      tag: el.tagName.toLowerCase(),
      h: Math.round(r.height * 10) / 10,
      top: Math.round(r.top * 10) / 10,
      bottom: Math.round(r.bottom * 10) / 10,
      cssH: cs.height,
      pad: cs.padding,
      margin: cs.margin,
      flex: cs.flexGrow + '/' + cs.flexShrink + '/' + cs.flexBasis,
      minH: cs.minHeight,
      ovf: cs.overflow,
      text: (el.textContent || '').trim().slice(0, 20),
      sh: el.scrollHeight,
      ch: el.clientHeight,
      clipped: el.scrollHeight > el.clientHeight + 1,
    }];
    for (const c of el.children) out.push(...describe(c, depth + 1));
    return out;
  };

  const ir = item.getBoundingClientRect();
  const ics = getComputedStyle(item);
  return {
    viewportHeight: vh,
    item: {
      h: Math.round(ir.height * 10) / 10,
      cssH: ics.height,
      pad: ics.padding,
      boxSizing: ics.boxSizing,
      clientHeight: item.clientHeight,
      scrollHeight: item.scrollHeight,
    },
    children: describe(item, 0),
  };
})()`);

if (report.error) {
  console.error(report.error);
  process.exit(1);
}

console.log(`route=${route} @${width}x${height} viewportHeight=${report.viewportHeight}`);
console.log(`item: h=${report.item.h} cssH=${report.item.cssH} pad=${report.item.pad} box=${report.item.boxSizing} clientH=${report.item.clientHeight} scrollH=${report.item.scrollHeight}`);
console.log('tree:');
for (const n of report.children) {
  const indent = '  '.repeat(n.depth);
  console.log(
    `${indent}<${n.tag}> h=${n.h} cssH=${n.cssH} pad=${n.pad} m=${n.margin} flex=${n.flex} sh=${n.sh} ch=${n.ch}${n.clipped ? '  <-- CLIPPED' : ''} "${n.text}"`,
  );
}

ws.close();
child.kill();
process.exit(0);
