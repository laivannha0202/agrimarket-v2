"use client";

import { Box, Container, Divider, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconLeaf, IconQrcode, IconShieldCheck, IconTruck } from "@tabler/icons-react";
import Link from "next/link";
import { layout } from "@/theme";

const COMMITMENTS = [
  { icon: IconLeaf, title: "Nông sản theo mùa", desc: "Nguồn hàng từ hợp tác xã và trang trại liên kết." },
  { icon: IconQrcode, title: "Truy xuất nguồn gốc", desc: "Tra cứu lô hàng, vụ mùa và trang trại." },
  { icon: IconShieldCheck, title: "Kiểm định chất lượng", desc: "Lô hàng phải đạt kiểm định mới được bán." },
  { icon: IconTruck, title: "Giao hàng tận nơi", desc: "Theo dõi trạng thái giao hàng trong đơn của bạn." },
];

export function Footer() {
  return (
    <Box
      component="footer"
      mt={{ base: 48, sm: 64 }}
      py={{ base: 32, sm: 40 }}
      style={{ background: "#ffffff", borderTop: "1px solid var(--agri-border)" }}
    >
      <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }}>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="xl">
          {COMMITMENTS.map((item) => (
            <Group key={item.title} gap="sm" align="flex-start" wrap="nowrap">
              <item.icon size={22} color="var(--mantine-color-agri-8)" />
              <Stack gap={2}>
                <Text fw={600} size="sm">
                  {item.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {item.desc}
                </Text>
              </Stack>
            </Group>
          ))}
        </SimpleGrid>
        <Divider my="xl" />

        <Group justify="space-between" align="flex-start" wrap="wrap" gap="lg">
          <Stack gap={6}>
            <Text fw={800} size="lg" c="agri.9">
              AgriMarket
            </Text>
            <Text size="sm" c="dimmed" maw={420}>
              Nền tảng thương mại điện tử nông sản tích hợp truy xuất nguồn gốc.
            </Text>
          </Stack>

          <Group gap="xl" align="flex-start" wrap="wrap">
            <Stack gap={6}>
              <Text fw={600} size="sm">
                Mua sắm
              </Text>
              <Text component={Link} href="/san-pham" size="sm" c="dimmed">
                Sản phẩm
              </Text>
              <Text component={Link} href="/trang-trai" size="sm" c="dimmed">
                Trang trại
              </Text>
              <Text component={Link} href="/gio-hang" size="sm" c="dimmed">
                Giỏ hàng
              </Text>
            </Stack>
            <Stack gap={6}>
              <Text fw={600} size="sm">
                Nguồn gốc
              </Text>
              <Text component={Link} href="/truy-xuat" size="sm" c="dimmed">
                Tra cứu mã truy xuất
              </Text>
            </Stack>
            <Stack gap={6}>
              <Text fw={600} size="sm">
                Tài khoản
              </Text>
              <Text component={Link} href="/don-hang" size="sm" c="dimmed">
                Đơn hàng của tôi
              </Text>
              <Text component={Link} href="/tai-khoan" size="sm" c="dimmed">
                Thông tin cá nhân
              </Text>
            </Stack>
          </Group>
        </Group>

        <Divider my="lg" />
        <Text size="xs" c="dimmed">
          © {new Date().getFullYear()} AgriMarket. Đồ án xây dựng nền tảng bán nông sản tích hợp
          truy xuất nguồn gốc.
        </Text>
      </Container>
    </Box>
  );
}
