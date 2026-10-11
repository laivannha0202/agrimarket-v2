/**
 * Dead-route audit.
 *
 * Expo Router derives its route table from the file tree, so every navigation
 * target in the source can be checked against it statically. A target that does
 * not resolve is a dead button — the exact thing this redesign set out to
 * remove — and it is invisible to typecheck because `href` accepts a string.
 *
 * Usage: node scripts/dead-route-audit.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const APP_DIR = new URL('../app/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/* ------------------------------------------------------------- route table -- */

const routes = new Set();
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    files.push(full);

    let route = `/${relative(APP_DIR, full).split(sep).join('/')}`;
    route = route.replace(/\.tsx?$/, '');
    route = route.replace(/\/index$/, '') || '/';
    routes.add(route);
    // `router.push('/(tabs)/catalog')` and `/catalog` name the same screen.
    routes.add(route.replace(/\/\([^)]+\)/g, ''));
  }
}

walk(APP_DIR);

/* --------------------------------------------------------------- targets --- */

const targets = new Map();

function record(target, file) {
  if (!target.startsWith('/')) return;
  if (!targets.has(target)) targets.set(target, file);
}

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const patterns = [
    /href=\{\{\s*pathname:\s*"([^"]+)"/g,
    /href="(\/[^"]*)"/g,
    /router\.(?:push|replace)\(\{\s*pathname:\s*"([^"]+)"/g,
    /router\.(?:push|replace)\("([^"]+)"/g,
    /router\.(?:push|replace)\(`([^`$]*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) record(match[1], file);
  }
}

/* ----------------------------------------------------------------- report -- */

const label = (f) => f.slice(f.indexOf(`${sep}app${sep}`) + 1).split(sep).join('/');

console.log(`routes discovered: ${routes.size}`);
console.log('');
console.log('navigation targets:');

let dead = 0;
for (const [target, file] of [...targets].sort()) {
  const cleaned = target.replace(/\/\([^)]+\)/g, '').replace(/\?.*$/, '');
  const ok = routes.has(cleaned) || routes.has(target);
  if (!ok) dead += 1;
  console.log(`${ok ? '  OK  ' : '  DEAD'}  ${target.padEnd(26)} <- ${label(file)}`);
}

console.log('');
if (dead === 0) {
  console.log(`DEAD-ROUTE AUDIT: PASS — all ${targets.size} targets resolve`);
} else {
  console.log(`DEAD-ROUTE AUDIT: FAIL — ${dead} dead target(s)`);
  process.exitCode = 1;
}
