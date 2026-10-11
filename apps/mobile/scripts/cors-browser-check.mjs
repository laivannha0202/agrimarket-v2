/**
 * Real-browser CORS acceptance check.
 *
 * Launches headless Edge/Chrome with remote debugging, opens the Expo Web app
 * origin (http://localhost:8081) and runs `fetch()` from inside that page
 * against the LAN API. A browser only exposes the response body when the CORS
 * headers are correct, so a successful JSON parse here is proof that the
 * `Access-Control-Allow-Origin` header is present and correct — something
 * `curl`/`Invoke-WebRequest` cannot prove.
 *
 * Usage: node scripts/cors-browser-check.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PAGE_ORIGIN = process.env.CHECK_PAGE_ORIGIN ?? 'http://localhost:8081';
const API_BASE = process.env.CHECK_API_BASE ?? 'http://192.168.100.155:3000/api/v1';
const PORT = 9333;

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error('No Edge/Chrome binary found — browser CORS check BLOCKED.');
  process.exit(2);
}

const profile = await mkdtemp(join(tmpdir(), 'agri-cors-'));

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
      /* browser not ready yet */
    }
    await sleep(500);
  }
  throw new Error('DevTools endpoint never became available');
}

const wsUrl = await findTarget();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
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

/** Evaluates an async expression in the page and returns its JSON value. */
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result?.exceptionDetails) {
    return { ok: false, error: res.result.exceptionDetails.text ?? 'evaluation failed' };
  }
  return { ok: true, value: res.result?.result?.value };
}

// Navigate to the Expo Web origin so `fetch` runs with that Origin header.
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `${PAGE_ORIGIN}/account` });
await sleep(8000);

const pageOrigin = await evaluate('String(window.location.origin)');
console.log(`page origin      : ${pageOrigin.value}`);

const endpoints = ['categories?limit=100&status=ACTIVE', 'products?limit=5', 'farms?limit=5'];
let failures = 0;

for (const ep of endpoints) {
  const url = `${API_BASE}/${ep}`;
  const expr = `(async () => {
    try {
      const r = await fetch(${JSON.stringify(url)}, { headers: { Accept: 'application/json' } });
      const t = await r.text();
      let n = null;
      try { n = JSON.parse(t).data?.length ?? null; } catch {}
      return { status: r.status, readable: t.length > 0, records: n, err: null };
    } catch (e) {
      return { status: 0, readable: false, records: null, err: String(e) };
    }
  })()`;

  const out = await evaluate(expr);
  const v = out.value ?? {};
  const pass = v.status === 200 && v.readable && !v.err;
  if (!pass) failures += 1;
  console.log(
    `${pass ? 'PASS' : 'FAIL'} ${ep.padEnd(38)} http=${v.status} records=${v.records} err=${v.err ?? 'none'}`,
  );
}

ws.close();
child.kill();
console.log(failures === 0 ? '\nBROWSER CORS: ALL PASS' : `\nBROWSER CORS: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
