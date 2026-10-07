"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import {
  clearSession,
  getStoredUser,
  getToken,
  isAdmin,
  setSession,
} from "@/lib/auth/session";
import type { AuthUser, LoginResponse } from "@/types/api";

interface AuthContextValue {
  user: AuthUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Hydrate synchronously from storage via lazy initialisers so the effect
  // only performs the async /auth/me verification (no setState in the effect
  // body, which React 19 flags as a cascading render).
  const [user, setUser] = useState<AuthUser | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = getStoredUser();
    return stored && isAdmin(stored) ? stored : null;
  });
  const [ready, setReady] = useState<boolean>(
    () => typeof window !== "undefined" && getToken() === null,
  );
  const router = useRouter();
  const queryClient = useQueryClient();

  // Verify the stored session with GET /auth/me.
  useEffect(() => {
    let cancelled = false;
    if (!getToken()) return;

    api
      .get<AuthUser>("/auth/me")
      .then((me) => {
        if (cancelled) return;
        if (!isAdmin(me)) {
          clearSession();
          setUser(null);
          return;
        }
        setUser(me);
      })
      .catch(() => {
        if (cancelled) return;
        clearSession();
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Global 401 handling: clear session and bounce to login.
  useEffect(() => {
    const handler = () => {
      clearSession();
      setUser(null);
      queryClient.clear();
      if (window.location.pathname !== "/login") {
        router.replace("/login");
      }
    };
    window.addEventListener("agri:unauthorized", handler);
    return () => window.removeEventListener("agri:unauthorized", handler);
  }, [queryClient, router]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<LoginResponse>("/auth/login", { email, password });
    if (!isAdmin(res.user)) {
      throw new Error("Tài khoản này không có quyền truy cập trang quản trị.");
    }
    setSession(res.accessToken, res.user);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    queryClient.clear();
    router.replace("/login");
  }, [queryClient, router]);

  const refresh = useCallback(async () => {
    const me = await api.get<AuthUser>("/auth/me");
    setUser(me);
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, logout, refresh }),
    [user, ready, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
