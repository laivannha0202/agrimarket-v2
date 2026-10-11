import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp, ConfigProvider } from "antd";

/**
 * Render a page under the same providers the real app uses (React Query +
 * antd ConfigProvider + antd App context), so `App.useApp()` message/modal
 * hooks and query hooks behave as in production.
 *
 * Queries are configured with retry disabled and no caching delay so tests
 * resolve deterministically.
 */
export function renderWithProviders(ui: ReactElement): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <AntdApp>{children}</AntdApp>
        </ConfigProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}
