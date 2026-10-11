"use client";

/**
 * Auth hook.
 *
 * The session lives in `localStorage`, which is an external store, so it is read
 * with `useSyncExternalStore` instead of being mirrored into React state from an
 * effect. That gives a correct server snapshot (signed out), a stable client
 * snapshot, and no cascading render on mount.
 *
 * The backend is the source of truth: `GET /auth/me` is the verification call,
 * and an ADMIN logging in here is told the account does not belong to the
 * customer storefront rather than being pushed into a customer account.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";
import { resources } from "@/lib/api/resources";
import {
  clearSession,
  getServerSessionSnapshot,
  getSessionSnapshot,
  setSession,
  subscribeSession,
} from "@/lib/auth/session";import type { AuthUser } from "@/lib/api/types";

export function useAuth() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const session = useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getServerSessionSnapshot,
  );

  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: resources.me,
    enabled: Boolean(session.token),
    staleTime: 5 * 60_000,
    retry: false,
  });

  // The verified user wins; the cached copy only avoids a flash while loading.
  const user: AuthUser | null = meQuery.data ?? session.user;

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await resources.login(email, password);
      setSession(result.accessToken, result.user);
      queryClient.clear();
      return result.user;
    },
    [queryClient],
  );

  /**
   * Stores a token issued by a route that rotates the session (a password
   * change returns a fresh one because the old token is invalidated
   * server-side). The cached user is kept: the identity did not change.
   */
  const adoptToken = useCallback(
    (token: string) => {
      const current = getSessionSnapshot().user;
      if (!current) return;
      setSession(token, current);
    },
    [],
  );

  const logout = useCallback(() => {
    clearSession();
    queryClient.clear();
    router.push("/");
  }, [queryClient, router]);

  return {
    user,
    isCustomer: user?.role === "CUSTOMER",
    isAdmin: user?.role === "ADMIN",
    isLoading: Boolean(session.token) && meQuery.isLoading,
    isAuthenticated: Boolean(session.token),
    login,
    adoptToken,
    logout,
    refetch: meQuery.refetch,
  };
}
