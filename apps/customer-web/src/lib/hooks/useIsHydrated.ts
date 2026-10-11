"use client";

/**
 * `true` only once the client has finished hydrating.
 *
 * Why this exists: the header renders different content for a signed-in
 * customer (account menu) than for a visitor (login button). The session lives
 * in `localStorage`, so the server always renders the visitor variant while the
 * browser can render the signed-in variant immediately. Because `/auth/me` is
 * fast, React Query can resolve during hydration and re-render the header while
 * sibling subtrees are still hydrating, which React reports as a hydration
 * mismatch and then regenerates the whole tree on the client.
 *
 * Gating the session-dependent markup on this flag keeps the first client
 * render byte-identical to the server render; the signed-in UI appears in the
 * post-hydration update instead.
 *
 * `useSyncExternalStore` is the right primitive: the server snapshot is always
 * `false`, the client snapshot is always `true`, and React only reads the client
 * snapshot after hydration has committed, so the flip can never race hydration.
 */

import { useSyncExternalStore } from "react";

/** Nothing ever notifies: the value changes exactly once, at hydration. */
function subscribe(): () => void {
  return () => {};
}

function getSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
