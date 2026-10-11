/**
 * Screen state machine.
 *
 * The mobile app must show EXACTLY ONE of: loading | error | empty | ready.
 * Deriving that from three independent booleans at every call site is what
 * produced the old "ERROR and EMPTY rendered together" bug (a screen showed
 * both a red error and a grey empty state, and left a screen-tall blank gap).
 *
 * Kept in `lib/` (not in the component file) so it can be unit-tested without
 * a React Native renderer.
 */

export type LoadState = "loading" | "error" | "empty" | "ready";

/** Priority is deliberate: loading > error > empty > ready. */
export function resolveLoadState(opts: {
  isPending: boolean;
  isError: boolean;
  isEmpty: boolean;
}): LoadState {
  if (opts.isPending) return "loading";
  if (opts.isError) return "error";
  if (opts.isEmpty) return "empty";
  return "ready";
}

/** True only when content should be rendered (no state block on screen). */
export function isReady(state: LoadState): boolean {
  return state === "ready";
}
