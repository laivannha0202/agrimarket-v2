import { describe, expect, it } from "vitest";
import { isReady, resolveLoadState } from "../load-state";

/**
 * These tests pin the fix for the "ERROR and EMPTY shown together" bug:
 * a screen must resolve to exactly ONE state, and `ready` is the only state
 * that renders content.
 */
describe("resolveLoadState", () => {
  it("returns exactly one state for every combination of flags", () => {
    for (const isPending of [true, false]) {
      for (const isError of [true, false]) {
        for (const isEmpty of [true, false]) {
          const state = resolveLoadState({ isPending, isError, isEmpty });
          expect(["loading", "error", "empty", "ready"]).toContain(state);
        }
      }
    }
  });

  it("never reports empty while an error is present (the old bug)", () => {
    expect(resolveLoadState({ isPending: false, isError: true, isEmpty: true })).toBe("error");
  });

  it("never reports empty while still loading", () => {
    expect(resolveLoadState({ isPending: true, isError: false, isEmpty: true })).toBe("loading");
  });

  it("prefers loading over error (in-flight request wins)", () => {
    expect(resolveLoadState({ isPending: true, isError: true, isEmpty: true })).toBe("loading");
  });

  it("reports ready only when loaded, healthy and non-empty", () => {
    expect(resolveLoadState({ isPending: false, isError: false, isEmpty: false })).toBe("ready");
  });

  it("reports empty only when loaded, healthy and empty", () => {
    expect(resolveLoadState({ isPending: false, isError: false, isEmpty: true })).toBe("empty");
  });

  it("exposes ready as the only content-rendering state", () => {
    expect(isReady("ready")).toBe(true);
    expect(isReady("loading")).toBe(false);
    expect(isReady("error")).toBe(false);
    expect(isReady("empty")).toBe(false);
  });
});
