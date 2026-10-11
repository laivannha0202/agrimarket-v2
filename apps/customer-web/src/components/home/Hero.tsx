"use client";

/**
 * Hero banner.
 *
 * The backend has no banner-management API, so this is deliberately static
 * BRAND content only (headline + traceability CTA). No product, price or
 * promotion is fabricated here — those all come from the API below it.
 */

import { Badge, Box, Button, Container, Group, Stack, Text, Title } from "@mantine/core";
import { IconArrowRight, IconQrcode } from "@tabler/icons-react";
import Link from "next/link";
import { layout } from "@/theme";

export function Hero() {
  return (
    <Box
      style={{
        background: "#ffffff",
        borderBottom: "1px solid var(--agri-border)",
      }}
    >
      <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }}>
        <Group
          justify="space-between"
          align="center"
          gap="xl"
          py={{ base: 28, sm: 40 }}
          wrap="wrap"
        >
          <Stack gap="md" maw={560}>
            <Badge variant="light" color="agri" size="md" radius="sm" w="fit-content">
              Nông sản theo mùa
            </Badge>
            <Title order={1} fz={{ base: 28, sm: 38 }} lh={1.2}>
              Nông sản sạch từ hợp tác xã, rõ nguồn gốc đến từng lô hàng
            </Title>
            <Text c="dimmed" size="md">
              Mỗi lô hàng đều có mã truy xuất: bạn xem được vụ mùa, trang trại, kết quả
              kiểm định chất lượng và chứng nhận còn hiệu lực.
            </Text>
            <Group gap="sm" wrap="wrap">
              <Button
                component={Link}
                href="/san-pham"
                size="md"
                rightSection={<IconArrowRight size={18} />}
              >
                Mua nông sản
              </Button>
              <Button
                component={Link}
                href="/truy-xuat"
                size="md"
                variant="default"
                leftSection={<IconQrcode size={18} />}
              >
                Truy xuất nguồn gốc
              </Button>
            </Group>
          </Stack>

          <Box
            w={{ base: "100%", sm: 320 }}
            p="lg"
            style={{
              borderRadius: 12,
              border: "1px solid var(--agri-border)",
              background: "var(--mantine-color-agri-0)",
            }}
          >
            <Stack gap="sm">
              <IconQrcode size={30} color="var(--mantine-color-agri-8)" />
              <Text fw={700}>Tem truy xuất trên mỗi lô hàng</Text>
              <Text size="sm" c="dimmed">
                Nhập mã in trên tem để xem toàn bộ hành trình của sản phẩm, từ thu hoạch
                đến khi nhập kho.
              </Text>
              <Button
                component={Link}
                href="/truy-xuat"
                variant="light"
                size="sm"
                w="fit-content"
              >
                Nhập mã truy xuất
              </Button>
            </Stack>
          </Box>
        </Group>
      </Container>
    </Box>
  );
}
