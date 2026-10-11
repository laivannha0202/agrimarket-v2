/**
 * Session storage behaviour.
 *
 * The bug this locks down: `expo-secure-store` ships a no-op stub on web, so
 * `getItemAsync` threw, every call fell into the `catch`, and the web build
 * could never hold a session — cart/checkout/orders/account all rendered
 * "please log in" and were unverifiable. The fallback is what makes them
 * reachable.
 *
 * These tests run in plain Node (no React Native import), which is itself the
 * constraint the module must respect.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/** In-memory stand-in for localStorage. */
function makeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    get size() {
      return map.size;
    },
  };
}

describe("session storage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("falls back to localStorage when SecureStore is a web stub", async () => {
    // Exactly what the web build of expo-secure-store does: the methods the
    // wrapper calls are undefined, so the call rejects.
    vi.doMock("expo-secure-store", () => ({
      getItemAsync: vi.fn(async () => {
        throw new TypeError("ExpoSecureStore.getValueWithKeyAsync is not a function");
      }),
      setItemAsync: vi.fn(async () => {
        throw new TypeError("not a function");
      }),
      deleteItemAsync: vi.fn(async () => {
        throw new TypeError("not a function");
      }),
    }));
    const ls = makeLocalStorage();
    vi.stubGlobal("localStorage", ls);

    const { setSession, getToken, getUser, clearSession } = await import("../session");

    await setSession("tok-123", { id: 14, role: "CUSTOMER" } as never);
    expect(ls.size).toBe(2);
    expect(await getToken()).toBe("tok-123");
    expect((await getUser())?.id).toBe(14);

    await clearSession();
    expect(ls.size).toBe(0);
    expect(await getToken()).toBeNull();
    expect(await getUser()).toBeNull();

    vi.unstubAllGlobals();
  });

  it("uses SecureStore when it actually works (native)", async () => {
    const store = new Map<string, string>();
    const setItemAsync = vi.fn(async (k: string, v: string) => void store.set(k, v));
    vi.doMock("expo-secure-store", () => ({
      getItemAsync: vi.fn(async (k: string) => store.get(k) ?? null),
      setItemAsync,
      deleteItemAsync: vi.fn(async (k: string) => void store.delete(k)),
    }));
    const ls = makeLocalStorage();
    vi.stubGlobal("localStorage", ls);

    const { setSession, getToken } = await import("../session");

    await setSession("native-tok", { id: 7, role: "CUSTOMER" } as never);
    expect(setItemAsync).toHaveBeenCalled();
    expect(await getToken()).toBe("native-tok");
    // The native path must NOT write to localStorage.
    expect(ls.size).toBe(0);

    vi.unstubAllGlobals();
  });

  it("treats a corrupt stored user as absent instead of crashing", async () => {
    vi.doMock("expo-secure-store", () => ({
      getItemAsync: vi.fn(async () => "not json"),
      setItemAsync: vi.fn(async () => {}),
      deleteItemAsync: vi.fn(async () => {}),
    }));
    const { getUser } = await import("../session");
    expect(await getUser()).toBeNull();
  });

  it("rejects a stored user missing the fields the app relies on", async () => {
    vi.doMock("expo-secure-store", () => ({
      getItemAsync: vi.fn(async () => JSON.stringify({ name: "no id or role" })),
      setItemAsync: vi.fn(async () => {}),
      deleteItemAsync: vi.fn(async () => {}),
    }));
    const { getUser } = await import("../session");
    expect(await getUser()).toBeNull();
  });
});
