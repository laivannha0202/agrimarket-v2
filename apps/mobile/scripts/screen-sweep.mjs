/**
 * Whole-app screen sweep.
 *
 * For each route: does it render real content (not a blank page), does it stay
 * inside the viewport horizontally, are there any tab-label clipping problems,
 * and does the visible text look like an error state? Produces one line per
 * route so a regression in any screen is obvious.
 *
 * Usage: node scripts/screen-sweep.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = process.env.CHECK_PAGE_ORIGIN ?? 'http://localhost:8081';
const ROUTES = [
  '/',
  '/catalog',
  '/trace',
  '/cart',
  '/account',
  '/login',
  '/farms',
  '/addresses',
  '/orders',
  '/vouchers',
  '/returns',
  '/complaints',
  '/my-reviews',
  '/scan',
  '/checkout',
  '/order/1',
  '/return/1',
  '/complaint/1',
  '/farm/9',
  '/product/42',
  '/trace/TRC-000019-BAPCA',
];
const width = Number(process.env.SWEEP_W ?? 412);
const height = Number(process.env.SWEEP_H ?? 915);
const PORT = 9200 + Math.floor(Math.random() * 300);

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

const profile = await mkdtemp(join(tmpdir(), 'agri-sweep-'));
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
    return;
  }
  // Console output is NOT associated with a request id, so it has to be
  // collected out of band. Without this a route could pass every geometric
  // check while the console filled up with React errors — exactly how a
  // `<button>` nested inside `<button>` (invalid HTML) went unnoticed.
  if (msg.method === 'Runtime.consoleAPICalled') {
    const type = msg.params?.type;
    if (type === 'error' || type === 'warning') {
      const text = (msg.params.args ?? [])
        .map((a) => a.value ?? a.description ?? a.preview?.description ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) consoleLogs.push({ type, text });
    }
  }
  if (msg.method === 'Log.entryAdded') {
    const entry2 = msg.params?.entry;
    if (entry2 && (entry2.level === 'error' || entry2.level === 'warning')) {
      consoleLogs.push({ type: entry2.level, text: `${entry2.text} ${entry2.url ?? ''}`.trim() });
    }
  }
});

/** Console errors/warnings seen since the last reset. */
let consoleLogs = [];

/** Messages that are environment noise, not defects in the app. */
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /Deprecated: .*props\./i,
  /\[expo-av\]/i,
  /favicon/i,
  /Failed to load resource: net::ERR_CONNECTION_REFUSED.*sockjs/i,
  /WebSocket connection to .*metro.*failed/i,
];

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
  if (res.result?.exceptionDetails) return { __error: res.result.exceptionDetails.text };
  return res.result?.result?.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });

const probe = `(() => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const root = document.getElementById('root');
  const text = (root?.innerText || '').trim();
  const all = [...document.querySelectorAll('*')];

  const tabLabels = ['Trang chủ','Sản phẩm','Truy xuất','Giỏ hàng','Tài khoản'];
  const clipped = [];
  for (const t of tabLabels) {
    const el = all.filter(e => (e.textContent || '').trim() === t
        && e.getBoundingClientRect().top > vh * 0.5
        && e.getBoundingClientRect().height < 40).pop();
    if (!el) continue;
    if (el.scrollHeight > el.clientHeight + 1) clipped.push(t + '(' + el.clientHeight + '/' + el.scrollHeight + ')');
  }

  const missing = all.filter(e => (e.textContent || '').includes('\\u23F7')).length;
  const errorMarkers = ['Cannot read', 'Undefined is not', 'Unhandled', 'Build Error', 'Unable to resolve'];
  const hasErrorText = errorMarkers.some(m => text.includes(m));
  const hasOverlay = !!document.querySelector('[data-expo-error-overlay], #error-overlay, .metro-error');

  return {
    title: text.split('\\n')[0]?.slice(0, 46) ?? '',
    textLen: text.length,
    blank: text.length < 10,
    docScrollWidth: document.documentElement.scrollWidth,
    innerWidth: vw,
    hOverflow: document.documentElement.scrollWidth > vw + 1,
    clippedLabels: clipped,
    missingIcons: missing,
    hasErrorText,
    hasOverlay,
    images: document.querySelectorAll('img').length,
    imgsBroken: [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0).length,
  };
})()`;

console.log(`sweep @ ${width}x${height}  origin=${ORIGIN}`);
console.log('');
let problems = 0;
let captureVerified = false;

for (const route of ROUTES) {
  consoleLogs = [];
  await send('Page.navigate', { url: `${ORIGIN}${route}` });
  await sleep(6500);

  // Self-test on the first route: prove the console listener is actually wired
  // up. A silently broken listener would make every route report "clean", which
  // is worse than no check at all.
  if (!captureVerified) {
    await evaluate(`console.error('SWEEP_CONSOLE_SELFTEST'); 1`);
    await sleep(400);
    captureVerified = consoleLogs.some((l) => l.text.includes('SWEEP_CONSOLE_SELFTEST'));
    consoleLogs = consoleLogs.filter((l) => !l.text.includes('SWEEP_CONSOLE_SELFTEST'));
    console.log(
      captureVerified
        ? 'console capture: VERIFIED (self-test message received)'
        : 'console capture: *** NOT WORKING — console findings below are unreliable ***',
    );
    console.log('');
    if (!captureVerified) problems += 1;
  }

  const r = await evaluate(probe);
  if (r.__error) {
    console.log(`${route.padEnd(14)} EVAL ERROR: ${r.__error}`);
    problems += 1;
    continue;
  }
  const flags = [];
  if (r.blank) flags.push('BLANK');
  if (r.hOverflow) flags.push(`H-OVERFLOW(${r.docScrollWidth}>${r.innerWidth})`);
  if (r.clippedLabels.length) flags.push(`LABEL-CLIP:${r.clippedLabels.join(',')}`);
  if (r.missingIcons) flags.push(`MISSING-ICON(${r.missingIcons})`);
  if (r.hasErrorText) flags.push('ERROR-TEXT');
  if (r.hasOverlay) flags.push('ERROR-OVERLAY');
  if (r.imgsBroken) flags.push(`BROKEN-IMG(${r.imgsBroken})`);

  const noise = consoleLogs.filter((l) => IGNORED_CONSOLE.some((re) => re.test(l.text)));
  const real = consoleLogs.filter((l) => !IGNORED_CONSOLE.some((re) => re.test(l.text)));
  if (real.length) flags.push(`CONSOLE(${real.length})`);

  if (flags.length) problems += 1;

  console.log(
    `${route.padEnd(14)} ${flags.length ? flags.join(' ') : 'ok'}  | text=${String(r.textLen).padStart(5)} imgs=${r.images} | "${r.title}"`,
  );
  for (const l of real.slice(0, 4)) {
    console.log(`               ${l.type}: ${l.text.slice(0, 190)}`);
  }
  if (noise.length) console.log(`               (${noise.length} ignored environment message(s))`);
}

ws.close();
child.kill();
console.log('');
console.log(problems === 0 ? 'SCREEN SWEEP: all routes clean' : `SCREEN SWEEP: ${problems} route(s) with findings`);
process.exit(0);
