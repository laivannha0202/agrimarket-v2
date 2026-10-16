"use client";

/**
 * Storefront header.
 *
 * Desktop (≥ md): logo, large search, quick links, cart, account — the web
 * layout, styled with the app tokens.
 *
 * Phone (< md): the native-style app bar from the Mobile app — brand row with
 * quick icons + search pill on the home screen, or Back + screen title on every
 * other screen. There is deliberately no Admin / warehouse / QC / finance entry
 * point.
 */

import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Container,
  Group,
  Menu,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import {
  IconArrowLeft,
  IconChevronDown,
  IconLogout,
  IconMapPin,
  IconPackage,
  IconQrcode,
  IconSearch,
  IconShoppingCart,
  IconTicket,
  IconUser,
} from "@tabler/icons-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { useAuth } from "@/lib/auth/useAuth";
import { useIsHydrated } from "@/lib/hooks/useIsHydrated";
import { screenTitle } from "@/components/layout/nav";
import { layout } from "@/theme";

const NAV_LINKS = [
  { href: "/san-pham", label: "Sản phẩm" },
  { href: "/trang-trai", label: "Trang trại" },
  { href: "/ma-giam-gia", label: "Mã giảm giá" },
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

/** Round icon button used in the phone brand row (trace + cart shortcuts). */
function PhoneIconButton({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <ActionIcon
      component={Link}
      href={href}
      aria-label={label}
      radius={999}
      size={36}
      variant="light"
      color="agri"
    >
      {children}
    </ActionIcon>
  );
}

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, logout, isCustomer } = useAuth();
  const hydrated = useIsHydrated();
  const cartCount = useCartCount();

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
  };

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  const isHome = pathname === "/";
  const isTrace = pathname.startsWith("/truy-xuat");
  const isCart = pathname === "/gio-hang";
  const title = screenTitle(pathname);

  const searchField = (
    <TextInput
      value={query}
      onChange={(event) => setQuery(event.currentTarget.value)}
      placeholder="Tìm rau củ, trái cây, trang trại…"
      leftSection={<IconSearch size={18} />}
      radius={999}
      size="md"
      aria-label="Tìm kiếm sản phẩm"
      onKeyDown={(event) => {
        if (event.key === "Enter") submitSearch();
      }}
      rightSectionWidth={88}
      rightSection={
        <Button size="compact-sm" radius={999} onClick={() => submitSearch()} mr={4} aria-label="Tìm kiếm">
          Tìm
        </Button>
      }
    />
  );

  return (
    <>
      {/* ----- Desktop header ---------------------------------------------- */}
      <Box
        component="header"
        visibleFrom="md"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: "var(--agri-surface)",
          borderBottom: "1px solid var(--agri-border)",
        }}
      >
        <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }}>
          <Group h={layout.headerHeight} gap="md" wrap="nowrap">
            <Link href="/" aria-label="AgriMarket - Trang chủ">
              <Group gap={8} wrap="nowrap">
                <Image
                  src="/design/brand/leaf_mark_512.png"
                  alt=""
                  width={34}
                  height={34}
                  style={{ borderRadius: 8 }}
                />
                <Box>
                  <Text fw={700} size="lg" c="agri.9" lh={1.1}>
                    AgriMarket
                  </Text>
                  <Text size="xs" c="var(--agri-muted)" lh={1.2}>
                    Nông sản sạch, rõ nguồn gốc
                  </Text>
                </Box>
              </Group>
            </Link>

            <Box style={{ flex: 1, maxWidth: 560 }}>{searchField}</Box>

            <Group gap={4} wrap="nowrap">
              {NAV_LINKS.map((link) => (
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
              <UnstyledButton
                component={Link}
                href="/gio-hang"
                aria-label="Giỏ hàng"
                style={{ display: "inline-flex" }}
              >
                <Box
                  style={{
                    position: "relative",
                    width: 40,
                    height: 40,
                    borderRadius: 999,
                    background: "var(--agri-primary-soft)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <IconShoppingCart size={20} color="var(--agri-primary)" />
                  {cartCount > 0 ? (
                    <Box
                      component="span"
                      style={{
                        position: "absolute",
                        top: -2,
                        right: -2,
                        minWidth: 18,
                        height: 18,
                        padding: "0 4px",
                        borderRadius: 999,
                        background: "var(--agri-danger)",
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 700,
                        lineHeight: "18px",
                        textAlign: "center",
                      }}
                    >
                      {cartCount > 99 ? "99+" : cartCount}
                    </Box>
                  ) : null}
                </Box>
              </UnstyledButton>

              {signedIn && user ? (
                <Menu shadow="md" width={240} position="bottom-end">
                  <Menu.Target>
                    <UnstyledButton aria-label="Tài khoản">
                      <Group gap={8} wrap="nowrap">
                        <Avatar size={32} radius="xl" color="agri">
                          {user.fullName.trim().charAt(0).toUpperCase()}
                        </Avatar>
                        <Text size="sm" fw={600} maw={110} truncate visibleFrom="lg">
                          {user.fullName}
                        </Text>
                        <IconChevronDown size={14} />
                      </Group>
                    </UnstyledButton>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Label>{user.email}</Menu.Label>
                    <Menu.Item component={Link} href="/tai-khoan" leftSection={<IconUser size={16} />}>
                      Tài khoản của tôi
                    </Menu.Item>
                    <Menu.Item component={Link} href="/don-hang" leftSection={<IconPackage size={16} />}>
                      Đơn hàng của tôi
                    </Menu.Item>
                    <Menu.Item
                      component={Link}
                      href="/tai-khoan/dia-chi"
                      leftSection={<IconMapPin size={16} />}
                    >
                      Sổ địa chỉ
                    </Menu.Item>
                    <Menu.Item component={Link} href="/ma-giam-gia" leftSection={<IconTicket size={16} />}>
                      Mã giảm giá
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={logout}>
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
        </Container>
      </Box>

      {/* ----- Phone app bar ------------------------------------------------ */}
      <Box
        component="header"
        hiddenFrom="md"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: "var(--agri-surface)",
          borderBottom: "1px solid var(--agri-border)",
        }}
      >
        {isHome ? (
          <Stack gap={8} px={12} pt={10} pb={10}>
            <Group justify="space-between" wrap="nowrap" align="center">
              <Group gap={8} wrap="nowrap" align="center">
                <Image
                  src="/design/brand/leaf_mark_512.png"
                  alt=""
                  width={34}
                  height={34}
                  style={{ borderRadius: 8 }}
                />
                <Box>
                  <Text fz={18} fw={700} c="var(--agri-primary)" lh="22px">
                    AgriMarket
                  </Text>
                  <Text fz={12} c="var(--agri-muted)" lh="15px">
                    Nông sản sạch, rõ nguồn gốc
                  </Text>
                </Box>
              </Group>
              <Group gap={8} wrap="nowrap">
                <PhoneIconButton href="/truy-xuat" label="Truy xuất nguồn gốc">
                  <IconQrcode size={19} />
                </PhoneIconButton>
                <Box style={{ position: "relative", display: "inline-flex" }}>
                  <PhoneIconButton href="/gio-hang" label="Giỏ hàng">
                    <IconShoppingCart size={19} />
                  </PhoneIconButton>
                  {cartCount > 0 ? (
                    <Box
                      component="span"
                      style={{
                        position: "absolute",
                        top: -3,
                        right: -3,
                        minWidth: 17,
                        height: 17,
                        padding: "0 4px",
                        borderRadius: 999,
                        background: "var(--agri-danger)",
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 700,
                        lineHeight: "17px",
                        textAlign: "center",
                        pointerEvents: "none",
                      }}
                    >
                      {cartCount > 99 ? "99+" : cartCount}
                    </Box>
                  ) : null}
                </Box>
              </Group>
            </Group>
            {searchField}
          </Stack>
        ) : (
          <Group h={layout.headerHeightMobile} px={6} gap={2} wrap="nowrap" align="center">
            <ActionIcon
              variant="subtle"
              color="gray"
              size={40}
              radius={999}
              onClick={goBack}
              aria-label="Quay lại"
            >
              <IconArrowLeft size={22} color="var(--agri-text-strong)" />
            </ActionIcon>
            <Text fz={17} fw={700} c="var(--agri-text-strong)" truncate style={{ flex: 1 }}>
              {title}
            </Text>
            {!isTrace ? (
              <PhoneIconButton href="/truy-xuat" label="Truy xuất nguồn gốc">
                <IconQrcode size={19} />
              </PhoneIconButton>
            ) : null}
            {!isCart ? (
              <Box style={{ position: "relative", display: "inline-flex" }}>
                <PhoneIconButton href="/gio-hang" label="Giỏ hàng">
                  <IconShoppingCart size={19} />
                </PhoneIconButton>
                {cartCount > 0 ? (
                  <Box
                    component="span"
                    style={{
                      position: "absolute",
                      top: -3,
                      right: -3,
                      minWidth: 17,
                      height: 17,
                      padding: "0 4px",
                      borderRadius: 999,
                      background: "var(--agri-danger)",
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 700,
                      lineHeight: "17px",
                      textAlign: "center",
                      pointerEvents: "none",
                    }}
                  >
                    {cartCount > 99 ? "99+" : cartCount}
                  </Box>
                ) : null}
              </Box>
            ) : null}
          </Group>
        )}
      </Box>

      {hydrated && user && !isCustomer ? (
        <Box hiddenFrom="md" px={12} py={6} style={{ background: "var(--agri-warning-soft)" }}>
          <Badge color="orange" variant="transparent" size="sm">
            Tài khoản không dành cho khu vực mua hàng
          </Badge>
        </Box>
      ) : null}
    </>
  );
}
