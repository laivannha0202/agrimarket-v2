"use client";

/**
 * Voucher catalogue — the "Mã giảm giá" screen the Mobile app also has.
 *
 * Read-only by design. The backend exposes `GET /vouchers` (the public
 * catalogue) but no "claim" or "my vouchers" endpoint, so no such action is
 * offered here: the code is chosen at checkout, where it is validated against
 * the real order and the discount is computed by the server.
 */

import {
  Box,
  Breadcrumbs,
  Button,
  Card,
  Container,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconInfoCircle, IconShoppingCart, IconTicket } from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { useNow } from "@/lib/hooks/useNow";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/States";
import { VoucherCard } from "@/components/promotion/VoucherCard";
import { splitVouchers } from "@/lib/vouchers";
import { layout } from "@/theme";

export function VoucherListView() {
  const now = useNow();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.vouchers.list(50),
    queryFn: () => resources.listVouchers(50),
    staleTime: 60_000,
  });

  const vouchers = data?.data ?? [];

  /**
   * `null` subtotal: with no order in view the minimum-order rule does not
   * apply, so every code that is genuinely live reads as usable. The other
   * rules (window, quota, per-customer) still decide.
   *
   * Until the clock is known (`now === 0`, the hydration render) the period
   * check is skipped rather than treating every code as expired.
   */
  const { eligible, ineligible } = splitVouchers(vouchers, null, {
    now: now === 0 ? undefined : now,
  });

  return (
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Breadcrumbs separator="/" visibleFrom="sm">
          <Text component={Link} href="/" size="sm" c="dimmed">
            Trang chủ
          </Text>
          <Text size="sm">Mã giảm giá</Text>
        </Breadcrumbs>

        <Stack gap={4}>
          <Title order={2}>Mã giảm giá</Title>
          <Text size="sm" c="dimmed">
            Các chương trình giảm giá đang mở trên AgriMarket. Mã được chọn ở bước đặt hàng
            để hệ thống kiểm tra theo đúng đơn hàng của bạn.
          </Text>
        </Stack>

        {isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <ListSkeleton rows={3} />
        ) : vouchers.length === 0 ? (
          <EmptyState
            icon={<IconTicket size={28} />}
            title="Chưa có mã giảm giá"
            description="Hiện chưa có chương trình giảm giá nào đang mở. Danh sách sẽ cập nhật khi hệ thống mở chương trình mới."
          />
        ) : (
          <Stack gap="lg">
            {eligible.length > 0 ? (
              <Stack gap="sm">
                <Text fw={700} size="sm" c="dimmed" tt="uppercase">
                  Dùng được
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
                  {eligible.map((option) => (
                    <VoucherCard key={option.voucher.id} voucher={option.voucher} usable />
                  ))}
                </SimpleGrid>
              </Stack>
            ) : null}

            {ineligible.length > 0 ? (
              <Stack gap="sm">
                <Text fw={700} size="sm" c="dimmed" tt="uppercase">
                  Chưa dùng được
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
                  {ineligible.map((option) => (
                    <Stack key={option.voucher.id} gap={4}>
                      <VoucherCard voucher={option.voucher} usable={false} />
                      {option.reason ? (
                        <Text size="xs" c="red.7">
                          {option.reason}
                        </Text>
                      ) : null}
                    </Stack>
                  ))}
                </SimpleGrid>
              </Stack>
            ) : null}

            <Divider />

            <Card padding="md" radius="md" withBorder>
              <Group justify="space-between" wrap="wrap" gap="md">
                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <IconInfoCircle size={18} color="var(--mantine-color-agri-8)" />
                  <Box>
                    <Text size="sm" fw={600}>
                      Chọn mã ở bước đặt hàng
                    </Text>
                    <Text size="xs" c="dimmed">
                      Hệ thống tính số tiền giảm dựa trên đơn hàng thực tế của bạn.
                    </Text>
                  </Box>
                </Group>
                <Group gap="sm">
                  <Button
                    component={Link}
                    href="/gio-hang"
                    variant="default"
                    size="sm"
                    leftSection={<IconShoppingCart size={16} />}
                  >
                    Xem giỏ hàng
                  </Button>
                  <Button component={Link} href="/thanh-toan" size="sm">
                    Tới đặt hàng
                  </Button>
                </Group>
              </Group>
            </Card>
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
