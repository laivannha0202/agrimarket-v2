"use client";

/**
 * Bottom tab bar (phones only) — the web twin of the Mobile app's tabs.
 *
 * Rendered only on the five tab screens (see `activeTab`); stack screens
 * (checkout, order detail, auth…) show a back button in the app bar instead,
 * exactly like the Expo Router navigator.
 */

import { Box, Text, UnstyledButton } from "@mantine/core";
import {
  IconHome,
  IconLayoutGrid,
  IconQrcode,
  IconShoppingCart,
  IconUser,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { queryKeys } from "@/lib/api/query-keys";
import { resources } from "@/lib/api/resources";
import { useAuth } from "@/lib/auth/useAuth";
import { useIsHydrated } from "@/lib/hooks/useIsHydrated";
import { activeTab, TABS, type TabKey } from "@/components/layout/nav";

const TAB_ICONS: Record<TabKey, typeof IconHome> = {
  home: IconHome,
  catalog: IconLayoutGrid,
  trace: IconQrcode,
  cart: IconShoppingCart,
  account: IconUser,
};

function useCartCount() {
  const { user } = useAuth();
  const hydrated = useIsHydrated();
  const { data } = useQuery({
    queryKey: queryKeys.cart.me(),
    queryFn: resources.getCart,
    enabled: Boolean(user),
    staleTime: 10_000,
  });
  // Session-dependent: keep the badge off until hydration so SSR and the first
  // client render agree.
  if (!hydrated || !data) return 0;
  return data.items.length;
}

export function MobileTabBar() {
  const pathname = usePathname();
  const active = activeTab(pathname);
  const cartCount = useCartCount();

  if (!active) return null;

  return (
    <Box
      component="nav"
      hiddenFrom="md"
      aria-label="Điều hướng chính"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100,
        background: "var(--agri-surface)",
        borderTop: "1px solid var(--agri-border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <Box
        style={{
          display: "flex",
          alignItems: "stretch",
          justifyContent: "space-between",
        }}
      >
        {TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.key];
          const isActive = tab.key === active;
          return (
            <UnstyledButton
              key={tab.key}
              component={Link}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              style={{
                flex: 1,
                minHeight: 60,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                paddingTop: 6,
                paddingBottom: 4,
              }}
            >
              <Box style={{ position: "relative", display: "grid", placeItems: "center", height: 26 }}>
                <Icon
                  size={22}
                  stroke={isActive ? 2 : 1.75}
                  color={isActive ? "var(--agri-primary)" : "var(--agri-muted-soft)"}
                />
                {tab.key === "cart" && cartCount > 0 ? (
                  <Box
                    component="span"
                    aria-label={`${cartCount} sản phẩm trong giỏ`}
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -10,
                      minWidth: 16,
                      height: 16,
                      padding: "0 4px",
                      borderRadius: 999,
                      background: "var(--agri-danger)",
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 700,
                      lineHeight: "16px",
                      textAlign: "center",
                    }}
                  >
                    {cartCount > 99 ? "99+" : cartCount}
                  </Box>
                ) : null}
              </Box>
              <Text
                fz={11}
                lh="15px"
                fw={isActive ? 700 : 600}
                style={{
                  color: isActive ? "var(--agri-primary)" : "var(--agri-muted-soft)",
                }}
              >
                {tab.label}
              </Text>
            </UnstyledButton>
          );
        })}
      </Box>
    </Box>
  );
}
