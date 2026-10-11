"use client";

/**
 * Storefront header.
 *
 * Desktop: logo, large search, quick links, cart, account.
 * Mobile: logo, search icon, cart, burger -> drawer.
 *
 * There is deliberately no Admin / warehouse / QC / finance entry point.
 */

import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Burger,
  Button,
  Container,
  Divider,
  Drawer,
  Group,
  Indicator,
  Menu,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import {
  IconChevronDown,
  IconHome,
  IconLogout,
  IconMapPin,
  IconPackage,
  IconQrcode,
  IconSearch,
  IconShoppingCart,
  IconUser,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { useAuth } from "@/lib/auth/useAuth";
import { useIsHydrated } from "@/lib/hooks/useIsHydrated";
import { layout } from "@/theme";

const NAV_LINKS = [
  { href: "/", label: "Trang chủ" },
  { href: "/san-pham", label: "Sản phẩm" },
  { href: "/trang-trai", label: "Trang trại" },
  { href: "/truy-xuat", label: "Truy xuất nguồn gốc" },
];

function useCartCount() {
  const { user } = useAuth();
  const hydrated = useIsHydrated();
  const { data } = useQuery({
    queryKey: queryKeys.cart.me(),
    queryFn: resources.getCart,
    enabled: Boolean(user),
    staleTime: 10_000,
  });
  // The badge is session-dependent: keep it off until hydration so the server
  // HTML and the first client render agree.
  if (!hydrated || !data) return 0;
  return data.items.length;
}

export function Header() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, logout, isCustomer } = useAuth();
  const hydrated = useIsHydrated();
  const cartCount = useCartCount();
  const [drawerOpened, drawer] = useDisclosure(false);

  // The session is read from `localStorage`, so the server always renders the
  // visitor header. Rendering the signed-in header only after hydration keeps
  // the first client render identical to the server render, which is what
  // React requires. Until then the visitor (login) header is shown.
  const signedIn = hydrated && Boolean(user) && isCustomer;

  const urlSearch = searchParams.get("search") ?? "";
  const [query, setQuery] = useState(urlSearch);
  const [lastUrlSearch, setLastUrlSearch] = useState(urlSearch);

  // Keep the search box in sync with the URL (?search=...) when the customer
  // navigates (back/forward, a header search, a link). Adjusting state during
  // render is the documented alternative to a setState-in-effect.
  if (urlSearch !== lastUrlSearch) {
    setLastUrlSearch(urlSearch);
    setQuery(urlSearch);
  }

  const submitSearch = (event?: React.FormEvent) => {
    event?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      router.push("/san-pham");
      return;
    }
    router.push(`/san-pham?search=${encodeURIComponent(trimmed)}`);
    drawer.close();
  };

  const searchField = (
    <TextInput
      value={query}
      onChange={(event) => setQuery(event.currentTarget.value)}
      placeholder="Tìm nông sản, ví dụ: cà chua"
      leftSection={<IconSearch size={18} />}
      radius="md"
      size="md"
      aria-label="Tìm kiếm sản phẩm"
      onKeyDown={(event) => {
        if (event.key === "Enter") submitSearch();
      }}
      rightSectionWidth={88}
      rightSection={
        <Button
          size="compact-sm"
          radius="sm"
          onClick={() => submitSearch()}
          mr={4}
          aria-label="Tìm kiếm"
        >
          Tìm
        </Button>
      }
    />
  );

  return (
    <>
      <Box
        component="header"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: "#ffffff",
          borderBottom: "1px solid var(--agri-border)",
        }}
      >
        <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }}>
          <Group h={layout.headerHeight} gap="md" wrap="nowrap" visibleFrom="md">
            <Link href="/" aria-label="AgriMarket - Trang chủ">
              <Group gap={8} wrap="nowrap">
                <Box
                  w={32}
                  h={32}
                  style={{
                    borderRadius: 8,
                    background: "var(--mantine-color-agri-8)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <Text c="white" fw={800} size="sm">
                    A
                  </Text>
                </Box>
                <Text fw={800} size="lg" c="agri.9">
                  AgriMarket
                </Text>
              </Group>
            </Link>

            <Box style={{ flex: 1, maxWidth: 560 }}>{searchField}</Box>

            <Group gap={4} wrap="nowrap">
              {NAV_LINKS.slice(1).map((link) => (
                <Button
                  key={link.href}
                  component={Link}
                  href={link.href}
                  variant="subtle"
                  color="gray"
                  size="sm"
                >
                  {link.label}
                </Button>
              ))}
            </Group>

            <Group gap="xs" wrap="nowrap">
              <Indicator
                label={cartCount}
                size={16}
                disabled={cartCount === 0}
                color="agri"
                offset={4}
              >
                <ActionIcon
                  component={Link}
                  href="/gio-hang"
                  variant="default"
                  size="lg"
                  aria-label="Giỏ hàng"
                >
                  <IconShoppingCart size={20} />
                </ActionIcon>
              </Indicator>

              {signedIn && user ? (
                <Menu shadow="md" width={220} position="bottom-end">
                  <Menu.Target>
                    <UnstyledButton aria-label="Tài khoản">
                      <Group gap={8} wrap="nowrap">
                        <Avatar size={32} radius="xl" color="agri">
                          {user.fullName.trim().charAt(0).toUpperCase()}
                        </Avatar>
                        <Text size="sm" fw={600} visibleFrom="lg" maw={110} truncate>
                          {user.fullName}
                        </Text>
                        <IconChevronDown size={14} />
                      </Group>
                    </UnstyledButton>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Label>{user.email}</Menu.Label>
                    <Menu.Item
                      component={Link}
                      href="/tai-khoan"
                      leftSection={<IconUser size={16} />}
                    >
                      Tài khoản của tôi
                    </Menu.Item>
                    <Menu.Item
                      component={Link}
                      href="/don-hang"
                      leftSection={<IconPackage size={16} />}
                    >
                      Đơn hàng của tôi
                    </Menu.Item>
                    <Menu.Item
                      component={Link}
                      href="/tai-khoan/dia-chi"
                      leftSection={<IconMapPin size={16} />}
                    >
                      Sổ địa chỉ
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                      color="red"
                      leftSection={<IconLogout size={16} />}
                      onClick={logout}
                    >
                      Đăng xuất
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              ) : (
                <Button component={Link} href="/dang-nhap" size="sm">
                  Đăng nhập
                </Button>
              )}
            </Group>
          </Group>

          {/* Mobile bar */}
          <Group h={layout.headerHeightMobile} gap="sm" wrap="nowrap" hiddenFrom="md">
            <Burger
              opened={drawerOpened}
              onClick={drawer.toggle}
              size="sm"
              aria-label="Mở menu"
            />
            <Link href="/" aria-label="AgriMarket - Trang chủ">
              <Text fw={800} size="md" c="agri.9">
                AgriMarket
              </Text>
            </Link>
            <Box style={{ flex: 1 }} />
            <ActionIcon
              component={Link}
              href="/truy-xuat"
              variant="default"
              size="lg"
              aria-label="Truy xuất nguồn gốc"
            >
              <IconQrcode size={20} />
            </ActionIcon>
            <Indicator
              label={cartCount}
              size={16}
              disabled={cartCount === 0}
              color="agri"
              offset={4}
            >
              <ActionIcon
                component={Link}
                href="/gio-hang"
                variant="default"
                size="lg"
                aria-label="Giỏ hàng"
              >
                <IconShoppingCart size={20} />
              </ActionIcon>
            </Indicator>
          </Group>
        </Container>
      </Box>

      <Drawer
        opened={drawerOpened}
        onClose={drawer.close}
        title="AgriMarket"
        size="xs"
        hiddenFrom="md"
      >
        <Stack gap="xs">
          {searchField}
          <Divider my="xs" />
          {NAV_LINKS.map((link) => (
            <Button
              key={link.href}
              component={Link}
              href={link.href}
              variant="subtle"
              color="gray"
              justify="flex-start"
              leftSection={
                link.href === "/" ? <IconHome size={18} /> : <IconQrcode size={18} />
              }
              onClick={drawer.close}
            >
              {link.label}
            </Button>
          ))}
          <Divider my="xs" />
          {signedIn && user ? (
            <>
              <Group gap="sm" px="xs">
                <Avatar size={36} radius="xl" color="agri">
                  {user.fullName.trim().charAt(0).toUpperCase()}
                </Avatar>
                <Box>
                  <Text size="sm" fw={600}>
                    {user.fullName}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {user.email}
                  </Text>
                </Box>
              </Group>
              <Button
                component={Link}
                href="/tai-khoan"
                variant="subtle"
                color="gray"
                justify="flex-start"
                leftSection={<IconUser size={18} />}
                onClick={drawer.close}
              >
                Tài khoản
              </Button>
              <Button
                component={Link}
                href="/don-hang"
                variant="subtle"
                color="gray"
                justify="flex-start"
                leftSection={<IconPackage size={18} />}
                onClick={drawer.close}
              >
                Đơn hàng của tôi
              </Button>
              <Button
                variant="subtle"
                color="red"
                justify="flex-start"
                leftSection={<IconLogout size={18} />}
                onClick={() => {
                  drawer.close();
                  logout();
                }}
              >
                Đăng xuất
              </Button>
            </>
          ) : (
            <Button component={Link} href="/dang-nhap" onClick={drawer.close}>
              Đăng nhập
            </Button>
          )}
          {hydrated && user && !isCustomer ? (
            <Badge color="orange" variant="light">
              Tài khoản không dành cho khu vực mua hàng
            </Badge>
          ) : null}
        </Stack>
      </Drawer>
    </>
  );
}
