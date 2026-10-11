/**
 * Auth session storage.
 *
 * NATIVE (the shipped target): `expo-secure-store`, which is the encrypted
 * Keychain / Keystore. Passwords are never stored — only the bearer JWT and the
 * small user object the backend returned.
 *
 * WEB: `expo-secure-store` ships a **no-op stub** for web (`ExpoSecureStore.web.js`
 * is literally `export default {}`), so `getItemAsync` throws and every call here
 * fell into the `catch` — which meant the web build could never hold a session at
 * all and every authenticated screen rendered "please log in". The web build is
 * not a shipped target: it exists so the screen-sweep/screenshot harness can
 * exercise the real UI against the real backend. Without a web adapter, cart,
 * checkout, orders and account were **unverifiable** on web.
 *
 * So on web only, `localStorage` is used. That is deliberately not described as
 * secure storage — it is a harness affordance, and native behaviour is unchanged.
 * Nothing here invents data: it stores exactly what the backend issued.
 */

import * as SecureStore from "expo-secure-store";
import type { AuthUser } from "./types";

const TOKEN_KEY = "agri.customer.token";
const USER_KEY = "agri.customer.user";

/**
 * Is the real (native) SecureStore usable here?
 *
 * Checked at runtime rather than by importing `Platform` from `react-native`:
 * importing React Native into a plain-Node unit test drags in its Flow-typed
 * source and the test runner cannot parse it. Probing the module also answers
 * the question that actually matters — "can this store hold a token?" — instead
 * of inferring it from the platform name.
 */
let secureStoreUsable: boolean | null = null;

async function canUseSecureStore(): Promise<boolean> {
  if (secureStoreUsable !== null) return secureStoreUsable;
  try {
    // The web build of expo-secure-store is an empty object, so this throws.
    await SecureStore.getItemAsync(TOKEN_KEY);
    secureStoreUsable = true;
  } catch {
    secureStoreUsable = false;
  }
  return secureStoreUsable;
}

type SessionListener = () => void;
const listeners = new Set<SessionListener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeSession(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function read(key: string): Promise<string | null> {
  if (await canUseSecureStore()) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  }
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

async function write(key: string, value: string): Promise<void> {
  if (await canUseSecureStore()) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      /* storage unavailable: session simply does not persist */
    }
    return;
  }
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage unavailable: session simply does not persist */
  }
}

async function remove(key: string): Promise<void> {
  if (await canUseSecureStore()) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      /* nothing to clear */
    }
    return;
  }
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}

export async function getToken(): Promise<string | null> {
  return read(TOKEN_KEY);
}

export async function getUser(): Promise<AuthUser | null> {
  const raw = await read(USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed || typeof parsed.id !== "number" || typeof parsed.role !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setSession(token: string, user: AuthUser): Promise<void> {
  await write(TOKEN_KEY, token);
  await write(USER_KEY, JSON.stringify(user));
  notify();
}

export async function clearSession(): Promise<void> {
  await remove(TOKEN_KEY);
  await remove(USER_KEY);
  notify();
}
