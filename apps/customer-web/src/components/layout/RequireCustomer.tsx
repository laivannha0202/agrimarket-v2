"use client";

/**
 * Guard for pages that need a signed-in customer.
 *
 * Renders a login prompt instead of redirecting silently, so the customer
 * understands why the page is not available. Admins are told the account is not
 * a customer account (the backend would reject those calls with 403 anyway).
 */

import { Alert, Button, Center, Loader, Stack, Text, Title } from "@mantine/core";
import { IconLock, IconShieldOff } from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth/useAuth";
import { useIsHydrated } from "@/lib/hooks/useIsHydrated";

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
        <Stack align="center" gap="sm">
          <Loader size="md" />
          <Text size="sm" c="dimmed">
            Đang kiểm tra phiên đăng nhập…
          </Text>
        </Stack>
      </Center>
    );
  }

  if (!isAuthenticated) {
    return (
      <Center py={60}>
        <Stack align="center" gap="md" maw={420}>
          <IconLock size={40} color="#868e96" />
          <Title order={3} ta="center">
            {title}
          </Title>
          <Text size="sm" c="dimmed" ta="center">
            Bạn cần đăng nhập bằng tài khoản khách hàng để tiếp tục.
          </Text>
          <Button
            component={Link}
            href={`/dang-nhap?tiep-theo=${encodeURIComponent(pathname)}`}
          >
            Đăng nhập
          </Button>
        </Stack>
      </Center>
    );
  }

  if (user && user.role !== "CUSTOMER") {
    return (
      <Center py={60}>
        <Alert
          color="orange"
          variant="light"
          icon={<IconShieldOff size={18} />}
          title="Tài khoản không phù hợp"
          maw={460}
        >
          <Stack gap="sm">
            <Text size="sm">
              Tài khoản quản trị không sử dụng được khu vực mua hàng. Vui lòng
              đăng nhập bằng tài khoản khách hàng.
            </Text>
            <Button component={Link} href="/" variant="light" color="orange" size="xs">
              Về trang chủ
            </Button>
          </Stack>
        </Alert>
      </Center>
    );
  }

  return <>{children}</>;
}
