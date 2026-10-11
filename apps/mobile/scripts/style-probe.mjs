/**
 * Computed-style probe for one element, identified by its visible text.
 *
 * Prints the element and its ancestors with the properties that actually decide
 * layout (display / flexDirection / border / minHeight), so a style that failed
 * to apply is visible as a number instead of guessed from a screenshot.
 *
 * Usage: node scripts/style-probe.mjs <route> "<visible text>" [width] [height]
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const route = process.argv[2] ?? '/';
const needle = process.argv[3] ?? '';
const width = Number(process.argv[4] ?? 400);
const height = Number(process.argv[5] ?? 866);
const ORIGIN = process.env.CHECK_PAGE_ORIGIN ?? 'http://localhost:8081';
const PORT = 9900 + Math.floor(Math.random() * 90);

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

const profile = await mkdtemp(join(tmpdir(), 'agri-style-'));
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
  const needle = ${JSON.stringify(needle)};
  const all = [...document.querySelectorAll('*')];
  // The innermost element whose text is exactly the needle.
  const exact = all.filter((el) => (el.textContent || '').trim() === needle && el.children.length === 0);
  const target = exact[0] ?? all.filter((el) => (el.textContent || '').includes(needle)).pop();
  if (!target) return { found: false };
  const describe = (el, i) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      up: i,
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 46),
      text: (el.textContent || '').trim().slice(0, 26),
      w: Math.round(r.width), h: Math.round(r.height),
      display: cs.display,
      flexDirection: cs.flexDirection,
      alignItems: cs.alignItems,
      borderWidth: cs.borderTopWidth,
      borderColor: cs.borderTopColor,
      borderRadius: cs.borderTopLeftRadius,
      minHeight: cs.minHeight,
      backgroundColor: cs.backgroundColor,
    };
  };
  const chain = [];
  let el = target;
  for (let i = 0; i < 4 && el; i += 1) { chain.push(describe(el, i)); el = el.parentElement; }
  return { found: true, chain };
})()`);

console.log(`route  : ${route}`);
console.log(`needle : ${JSON.stringify(needle)}`);
for (const row of report.chain ?? []) console.log(JSON.stringify(row));

ws.close();
child.kill();
process.exit(0);
