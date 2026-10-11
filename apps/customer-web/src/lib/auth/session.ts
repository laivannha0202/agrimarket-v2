/**
 * Auth session storage.
 *
 * The backend issues a bearer JWT (there is no HttpOnly cookie flow), so the
 * token is kept in `localStorage` under a single namespaced key. Passwords are
 * never stored and tokens are never logged.
 *
 * `localStorage` is an external store, so the React-facing reader is
 * `getSessionSnapshot` + `subscribeSession`, consumed through
 * `useSyncExternalStore`. That keeps the snapshot referentially stable (no
 * render loop), gives the server a well-defined value, and avoids the
 * hydration mismatch of reading storage during the first render.
 */

import type { AuthUser } from "@/lib/api/types";

const TOKEN_KEY = "agri.customer.token";
const USER_KEY = "agri.customer.user";

/** Same-tab notification; the `storage` event only fires in *other* tabs. */
const SESSION_EVENT = "agri:session-changed";

export interface SessionSnapshot {
  token: string | null;
  user: AuthUser | null;
}

const SERVER_SNAPSHOT: SessionSnapshot = { token: null, user: null };

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseUser(raw: string | null): AuthUser | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed || typeof parsed.id !== "number" || typeof parsed.role !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  if (!isBrowser()) return null;
  return safeGet(TOKEN_KEY);
}

export function getUser(): AuthUser | null {
  if (!isBrowser()) return null;
  return parseUser(safeGet(USER_KEY));
}

export function setSession(token: string, user: AuthUser): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // Storage unavailable (private mode): the session simply does not persist.
  }
  window.dispatchEvent(new CustomEvent(SESSION_EVENT));
}

export function clearSession(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch {
    // Nothing to clear.
  }
  window.dispatchEvent(new CustomEvent(SESSION_EVENT));
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

// ---------------------------------------------------------------------------
// External-store adapter
// ---------------------------------------------------------------------------

let cachedSnapshot: SessionSnapshot = SERVER_SNAPSHOT;
let cachedKey = "";

/**
 * Stable snapshot of the session. The reference only changes when the stored
 * values actually change, which is what `useSyncExternalStore` requires.
 */
export function getSessionSnapshot(): SessionSnapshot {
  if (!isBrowser()) return SERVER_SNAPSHOT;
  const token = safeGet(TOKEN_KEY);
  const userRaw = safeGet(USER_KEY);
  const key = `${token ?? ""}\u0000${userRaw ?? ""}`;
  if (key !== cachedKey) {
    cachedKey = key;
    cachedSnapshot = { token, user: parseUser(userRaw) };
  }
  return cachedSnapshot;
}

/** Server / pre-hydration snapshot: always signed out. */
export function getServerSessionSnapshot(): SessionSnapshot {
  return SERVER_SNAPSHOT;
}

export function subscribeSession(onChange: () => void): () => void {
  if (!isBrowser()) return () => {};
  window.addEventListener(SESSION_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SESSION_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
