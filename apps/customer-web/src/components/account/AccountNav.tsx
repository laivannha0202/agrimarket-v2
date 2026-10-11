"use client";

/**
 * Account area navigation.
 *
 * A small vertical nav shared by the account screens. Profile details, the
 * address book and the password are editable because the customer endpoints
 * exist for all three.
 */

import { Box, Card, Group, Stack, Text } from "@mantine/core";
import {
  IconKey,
  IconMapPin,
  IconMessageReport,
  IconPackage,
  IconPackageExport,
  IconStar,
  IconUser,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/tai-khoan", label: "Thông tin cá nhân", icon: IconUser },
  { href: "/tai-khoan/doi-mat-khau", label: "Đổi mật khẩu", icon: IconKey },
  { href: "/tai-khoan/dia-chi", label: "Sổ địa chỉ", icon: IconMapPin },
  { href: "/don-hang", label: "Đơn hàng của tôi", icon: IconPackage },
  { href: "/tra-hang", label: "Trả hàng", icon: IconPackageExport },
  { href: "/khieu-nai", label: "Khiếu nại", icon: IconMessageReport },
  { href: "/danh-gia", label: "Đánh giá sản phẩm", icon: IconStar },
];

export function AccountNav() {
  const pathname = usePathname();

  return (
    <Card
      padding="sm"
      radius="md"
      withBorder
      w={{ base: "100%", md: 260 }}
      style={{ flexShrink: 0 }}
    >
      <Stack gap={4}>
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Box
              key={link.href}
              component={Link}
              href={link.href}
              px="sm"
              py={8}
              style={{
                borderRadius: 8,
                background: active ? "var(--mantine-color-agri-0)" : "transparent",
                color: active ? "var(--mantine-color-agri-9)" : "inherit",
              }}
            >
              <Group gap="sm" wrap="nowrap">
                <link.icon size={18} />
                <Text size="sm" fw={active ? 600 : 400}>
                  {link.label}
                </Text>
              </Group>
            </Box>
          );
        })}
      </Stack>
    </Card>
  );
}
