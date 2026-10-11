import { useQuery, useQueryClient, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "./lib/api-client";
import { resources } from "./lib/resources";
import { clearSession, getToken, getUser, setSession, subscribeSession } from "./lib/session";
import type { AuthUser } from "./lib/types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, gcTime: 5 * 60_000 },
    mutations: { retry: 0 },
  },
});

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  /**
   * Stores a token issued by a route that rotates the session.
   *
   * `PATCH /auth/change-password` invalidates every token issued earlier (the
   * backend stamps `passwordChangedAt` and `JwtStrategy` rejects anything older),
   * so the device that made the change would be signed out with the rest unless
   * it adopts the fresh token the API returns. The cached user is kept: the
   * identity did not change.
   */
  adoptToken: (token: string) => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  token: null,
  user: null,
  hydrated: false,
  login: async () => {
    throw new Error("AuthProvider missing");
  },
  logout: async () => {},
  refreshMe: async () => {},
  adoptToken: async () => {},
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

function AuthInner({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [storedUser, setStoredUser] = useState<AuthUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [t, u] = await Promise.all([getToken(), getUser()]);
      if (alive) {
        setToken(t);
        setStoredUser(u);
        setHydrated(true);
      }
    })();
    return subscribeSession(() => {
      (async () => {
        const [t, u] = await Promise.all([getToken(), getUser()]);
        setToken(t);
        setStoredUser(u);
      })();
    });
  }, []);

  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => resources.me(),
    enabled: hydrated && token !== null,
    retry: false,
  });

  useEffect(() => {
    if (meQuery.error instanceof ApiError && meQuery.error.status === 401) {
      void clearSession();
      client.clear();
    }
  }, [meQuery.error, client]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await resources.login(email.trim().toLowerCase(), password);
      if (res.user.role !== "CUSTOMER") {
        throw new ApiError(403, "Tài khoản này không dùng cho ứng dụng khách hàng.");
      }
      await setSession(res.accessToken, res.user);
      client.clear();
      setToken(res.accessToken);
      setStoredUser(res.user);
      return res.user;
    },
    [client],
  );

  const logout = useCallback(async () => {
    await clearSession();
    client.clear();
    setToken(null);
    setStoredUser(null);
  }, [client]);

  const refreshMe = useCallback(async () => {
    await meQuery.refetch();
  }, [meQuery]);

  const adoptToken = useCallback(async (next: string) => {
    // The identity is unchanged by a password change, so the stored user is
    // reused; only the credential is replaced.
    const current = await getUser();
    if (!current) return;
    await setSession(next, current);
    setToken(next);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      token,
      user: meQuery.data ?? storedUser,
      hydrated,
      login,
      logout,
      refreshMe,
      adoptToken,
    }),
    [token, meQuery.data, storedUser, hydrated, login, logout, refreshMe, adoptToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthInner>{children}</AuthInner>
    </QueryClientProvider>
  );
}
