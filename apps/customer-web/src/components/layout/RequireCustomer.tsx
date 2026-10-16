"use client";

/**
 * Guard for pages that need a signed-in customer.
 *
 * Renders a login prompt instead of redirecting silently, so the customer
 * understands why the page is not available. Admins are told the account is not
 * a customer account (the backend would reject those calls with 403 anyway).
 *
 * Styling follows the app tokens: a soft warning box for the wrong-account
 * case (same look as the notices on the Mobile screens) instead of a Mantine
 * `Alert`.
 */

import { Box, Button, Center, Group, Stack, Text } from "@mantine/core";
import { IconLock, IconShieldOff } from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth/useAuth";
import { useIsHydrated } from "@/lib/hooks/useIsHydrated";
import { LoadingView } from "@/components/ui/kit";

export function RequireCustomer({
  children,
  title = "Vui lòng đăng nhập",
}: {
  children: ReactNode;
  title?: string;
}) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const pathname = usePathname();
  const hydrated = useIsHydrated();

  // The session lives in `localStorage`, so the server cannot know it. Until
  // hydration completes the guard renders its loading state, which is what the
  // server rendered too — no hydration mismatch, and no flash of the login
  // prompt for a signed-in customer.
  if (!hydrated || isLoading) {
    return (
      <Center py={80}>
        <LoadingView label="Đang kiểm tra phiên đăng nhập…" />
      </Center>
    );
  }

  if (!isAuthenticated) {
    return (
      <Center py={60} px={12}>
        <Stack align="center" gap={12} maw={420}>
          <Box
            style={{
              width: 56,
              height: 56,
              borderRadius: 999,
              background: "var(--agri-primary-soft)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <IconLock size={26} color="var(--agri-primary)" aria-hidden />
          </Box>
          <Text fz={18} fw={700} c="var(--agri-text-strong)" ta="center">
            {title}
          </Text>
          <Text fz={13} lh="19px" c="var(--agri-muted)" ta="center">
            Bạn cần đăng nhập bằng tài khoản khách hàng để tiếp tục.
          </Text>
          <Button
            component={Link}
            href={`/dang-nhap?tiep-theo=${encodeURIComponent(pathname)}`}
            radius={8}
            fullWidth
            styles={{ root: { minHeight: 48 }, label: { fontSize: 15, fontWeight: 700 } }}
          >
            Đăng nhập
          </Button>
        </Stack>
      </Center>
    );
  }

  if (user && user.role !== "CUSTOMER") {
    return (
      <Center py={60} px={12}>
        <Stack
          gap={6}
          maw={460}
          style={{
            background: "var(--agri-warning-soft)",
            border: "1px solid var(--agri-warning)",
            borderRadius: 12,
            padding: 16,
            width: "100%",
          }}
        >
          <Group gap={6} align="center" wrap="nowrap">
            <IconShieldOff size={18} color="var(--agri-warning)" aria-hidden />
            <Text fz={14.5} fw={700} c="var(--agri-warning)">
              Tài khoản không phù hợp
            </Text>
          </Group>
          <Text fz={13} lh="19px" c="var(--agri-text)">
            Tài khoản quản trị không sử dụng được khu vực mua hàng. Vui lòng đăng nhập bằng tài
            khoản khách hàng.
          </Text>
          <Button
            component={Link}
            href="/"
            variant="default"
            radius={8}
            mt={6}
            styles={{ root: { minHeight: 40 }, label: { fontSize: 13, fontWeight: 700 } }}
          >
            Về trang chủ
          </Button>
        </Stack>
      </Center>
    );
  }

  return <>{children}</>;
}
