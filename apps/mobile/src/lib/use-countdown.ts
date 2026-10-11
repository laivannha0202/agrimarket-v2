/**
 * Live countdown hook.
 *
 * Kept in its own module because it is the only part that needs React Native
 * (`AppState`); the arithmetic lives in `countdown.ts` so it stays unit-testable
 * in a plain Node environment.
 *
 * THE CLOCK IS AN EXTERNAL STORE
 *
 * A countdown is a subscription to wall-clock time, so it is modelled with
 * `useSyncExternalStore`: the ticker notifies, and the value is read from
 * `Date.now()` quantised to whole seconds. Deriving it this way (rather than
 * copying a remaining-time number into state) means
 *
 *  - the display is always recomputed from `endsAt`, so it cannot drift;
 *  - a background/foreground cycle is correct by construction — Android may
 *    throttle timers while backgrounded, and on resume the `AppState` listener
 *    notifies, the snapshot is re-read, and the value jumps to the truth
 *    instead of continuing from a stale number;
 *  - nothing is written to state inside an effect.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { COUNTDOWN_TICK_MS, computeCountdown, type CountdownState } from "./countdown";

/** Whole seconds since the epoch — stable for a second at a time. */
function readSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** One shared ticker for every countdown on screen. */
function subscribeToClock(onChange: () => void): () => void {
  const id = setInterval(onChange, COUNTDOWN_TICK_MS);
  const sub = AppState.addEventListener("change", (status) => {
    if (status === "active") onChange();
  });
  return () => {
    clearInterval(id);
    sub.remove();
  };
}

/**
 * Live countdown to `endsAt`.
 *
 * `onExpire` fires once each time the deadline crosses while the component is
 * mounted — the hook that lets a screen re-read promotions instead of leaving
 * expired flash prices on display.
 */
export function useCountdown(
  endsAt: string | null | undefined,
  onExpire?: () => void,
): CountdownState {
  const nowSeconds = useSyncExternalStore(subscribeToClock, readSeconds, readSeconds);

  const state = computeCountdown(endsAt, nowSeconds * 1000);

  // The callback is held in a ref so a new inline closure on every render does
  // not re-fire the effect. The ref is written inside an effect, never during
  // render.
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  const expired = state.expired;
  useEffect(() => {
    if (expired) onExpireRef.current?.();
  }, [expired]);

  return state;
}

/**
 * Several deadlines on one shared ticker.
 *
 * A single subscription keeps the whole strip on the same "now", so two cards
 * can never disagree by a tick, and one expiry callback covers the group.
 */
export function useCountdowns(
  deadlines: (string | null | undefined)[],
  onAnyExpire?: () => void,
): CountdownState[] {
  const nowSeconds = useSyncExternalStore(subscribeToClock, readSeconds, readSeconds);

  const states = deadlines.map((deadline) => computeCountdown(deadline, nowSeconds * 1000));

  const onExpireRef = useRef(onAnyExpire);
  useEffect(() => {
    onExpireRef.current = onAnyExpire;
  }, [onAnyExpire]);

  const anyExpired = states.some((state) => state.expired);
  useEffect(() => {
    if (anyExpired) onExpireRef.current?.();
  }, [anyExpired]);

  return states;
}
