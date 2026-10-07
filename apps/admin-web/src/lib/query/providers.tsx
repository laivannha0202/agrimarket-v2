"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp, ConfigProvider } from "antd";
import viVN from "antd/locale/vi_VN";
import { AuthProvider } from "@/lib/auth/auth-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={viVN}
        theme={{
          token: {
            colorPrimary: "#2f8f4e",
            colorInfo: "#2f8f4e",
            borderRadius: 6,
            fontSize: 14,
            controlHeight: 34,
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
          },
          components: {
            Layout: {
              headerBg: "#ffffff",
              bodyBg: "#f5f6f7",
              siderBg: "#ffffff",
            },
            Menu: {
              itemSelectedBg: "#e9f5ee",
              itemSelectedColor: "#2f8f4e",
              itemHeight: 38,
            },
            Table: {
              headerBg: "#fafafa",
              cellPaddingBlock: 12,
            },
          },
        }}
      >
        <AntdApp>
          <AuthProvider>{children}</AuthProvider>
        </AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
