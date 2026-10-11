"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api/client";
import { clearSession, getToken } from "@/lib/auth/session";
import { theme } from "@/theme";

/**
 * Global providers.
 *
 * A 401 clears the local session and sends the customer to the login page with
 * a `tiep-theo` (next) parameter — the backend stays the source of truth for
 * authorization. Navigation goes through the App Router so the client cache and
 * history stay consistent.
 */
function useUnauthorizedHandler() {
  const router = useRouter();

  const handleUnauthorized = useCallback(() => {
    if (!getToken()) return;
    clearSession();
    const next = window.location.pathname + window.location.search;
    router.replace(`/dang-nhap?tiep-theo=${encodeURIComponent(next)}`);
  }, [router]);

  useEffect(() => {
    window.addEventListener("agri:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("agri:unauthorized", handleUnauthorized);
  }, [handleUnauthorized]);
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Never retry auth/permission/business failures.
              if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
                return false;
              }
              return failureCount < 2;
            },
          },
        },
      }),
  );

  useUnauthorizedHandler();

  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="light">
        <Notifications position="top-right" limit={3} />
        {children}
      </MantineProvider>
    </QueryClientProvider>
  );
}
