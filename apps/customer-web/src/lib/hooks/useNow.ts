"use client";

/**
 * Current time as a React value.
 *
 * Reading `Date.now()` during render is impure: it makes the render output
 * depend on something React cannot track, so two renders of the same tree can
 * disagree. The clock is really an external store, so it is exposed through
 * `useSyncExternalStore` with a single shared ticker — one interval for the
 * whole app, stopped as soon as nothing is subscribed.
 *
 * `getServerSnapshot` returns `0` (no "now" exists on the server); React uses it
 * for the hydration render and then immediately re-renders with the real value.
 */

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let tickerId: ReturnType<typeof setInterval> | null = null;
let currentNow = 0;

function startTicker(): void {
  if (tickerId !== null) return;
  currentNow = Date.now();
  tickerId = setInterval(() => {
    currentNow = Date.now();
    for (const listener of listeners) listener();
  }, 1000);
}

function stopTicker(): void {
  if (tickerId === null) return;
  clearInterval(tickerId);
  tickerId = null;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  startTicker();
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) stopTicker();
  };
}

function getSnapshot(): number {
  if (currentNow === 0) currentNow = Date.now();
  return currentNow;
}

function getServerSnapshot(): number {
  return 0;
}

/**
 * Milliseconds since the epoch, refreshed once per second while mounted.
 * Returns `0` during SSR and the hydration render.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
