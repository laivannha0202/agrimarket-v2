"use client";

/**
 * Account area navigation — web twin of the grouped rows on the Mobile account
 * tab: icon tile, label, chevron, hairline dividers between rows and an
 * uppercase group title ("Mua sắm" / "Tài khoản" / "Hỗ trợ").
 *
 * On desktop it renders as the familiar sidebar; on phones it stacks above the
 * content exactly like the app's list of rows.
 *
 * The row list only contains destinations that really exist in this build.
 * "Thông tin cá nhân" opens this very hub page (the web keeps the profile form
 * inline instead of a separate screen), so it is the active row there.
 */

import { Box, Card, Text } from "@mantine/core";
import {
  IconChevronRight,
  IconKey,
  IconLeaf,
  IconMapPin,
  IconMessageReport,
  IconPackage,
  IconPackageExport,
  IconStar,
  IconTicket,
  IconUser,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS: Array<{
  title: string;
  links: Array<{ href: string; label: string; icon: typeof IconUser }>;
}> = [
  {
    title: "Mua sắm",
    links: [
      { href: "/don-hang", label: "Đơn hàng của tôi", icon: IconPackage },
      { href: "/tra-hang", label: "Trả hàng", icon: IconPackageExport },
      { href: "/danh-gia", label: "Đánh giá của tôi", icon: IconStar },
    ],
  },
  {
    title: "Tài khoản",
    links: [
      { href: "/tai-khoan", label: "Thông tin cá nhân", icon: IconUser },
      { href: "/tai-khoan/dia-chi", label: "Địa chỉ giao hàng", icon: IconMapPin },
      { href: "/tai-khoan/doi-mat-khau", label: "Đổi mật khẩu", icon: IconKey },
      { href: "/ma-giam-gia", label: "Mã giảm giá", icon: IconTicket },
    ],
  },
  {
    title: "Hỗ trợ",
    links: [
      { href: "/khieu-nai", label: "Khiếu nại", icon: IconMessageReport },
      { href: "/trang-trai", label: "Trang trại đối tác", icon: IconLeaf },
    ],
  },
];

export function AccountNav() {
  const pathname = usePathname();

  return (
    <Box w={{ base: "100%", md: 260 }} style={{ flexShrink: 0 }}>
      {SECTIONS.map((section) => (
        <Box key={section.title}>
          <Text
            fz={12}
            fw={700}
            c="var(--agri-muted)"
            tt="uppercase"
            mt={12}
            mb={6}
            style={{ letterSpacing: 0.5 }}
          >
            {section.title}
          </Text>
          <Card padding={0} radius={12} withBorder style={{ overflow: "hidden" }}>
            {section.links.map((link, index) => {
              const active = pathname === link.href;
              return (
                <Box
                  key={link.href}
                  component={Link}
                  href={link.href}
                  className="agri-press"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 48,
                    paddingLeft: 12,
                    paddingRight: 12,
                    background: active ? "var(--agri-primary-soft)" : "var(--agri-surface)",
                    borderTop: index > 0 ? "1px solid var(--agri-border)" : undefined,
                  }}
                >
                  <Box
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: "var(--agri-primary-soft)",
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    <link.icon size={17} color="var(--agri-primary)" aria-hidden />
                  </Box>
                  <Text
                    fz={14}
                    fw={600}
                    c={active ? "var(--agri-primary-dark)" : "var(--agri-text)"}
                    style={{ flex: 1 }}
                  >
                    {link.label}
                  </Text>
                  <IconChevronRight size={16} color="var(--agri-muted-soft)" aria-hidden />
                </Box>
              );
            })}
          </Card>
        </Box>
      ))}
    </Box>
  );
}
