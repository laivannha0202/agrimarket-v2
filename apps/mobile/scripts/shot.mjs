/**
 * Accurate device-sized screenshot via CDP.
 *
 * `msedge --screenshot --window-size` captures the *window*, so the viewport
 * ends up narrower than requested and content looks clipped. This drives
 * `Emulation.setDeviceMetricsOverride` first, so the PNG is exactly the phone
 * viewport the app actually renders into.
 *
 * Usage: node scripts/shot.mjs <route> <outfile> [width] [height] [scrollY]
 */

import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const route = process.argv[2] ?? '/';
const outFile = process.argv[3] ?? join(tmpdir(), 'agri-shot.png');
const width = Number(process.argv[4] ?? 412);
const height = Number(process.argv[5] ?? 915);
const scrollY = Number(process.argv[6] ?? 0);
const ORIGIN = process.env.CHECK_PAGE_ORIGIN ?? 'http://localhost:8081';
const PORT = 9600 + Math.floor(Math.random() * 300);

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

const profile = await mkdtemp(join(tmpdir(), 'agri-shot-'));
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

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: `${ORIGIN}${route}` });
await sleep(10000);

if (scrollY > 0) {
  await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${scrollY});` });
  await sleep(1500);
}

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
if (!shot.result?.data) {
  console.error('Screenshot capture failed:', JSON.stringify(shot).slice(0, 300));
  process.exit(1);
}
writeFileSync(outFile, Buffer.from(shot.result.data, 'base64'));
console.log(`saved ${outFile} (${width}x${height} @2x, route=${route}, scrollY=${scrollY})`);

ws.close();
child.kill();
process.exit(0);
