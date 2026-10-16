"use client";

/**
 * Mã giảm giá — web twin of the Mobile `vouchers` screen.
 *
 * A read-only catalogue of the vouchers the backend currently serves
 * (`GET /vouchers`). There is no "claim" or "my voucher" endpoint, so the
 * screen never offers one: the code is chosen at checkout, where it is
 * validated against the real order and the discount is computed by the server.
 *
 * The list is therefore *informational*: it states each programme's real rules
 * and whether the code is currently usable at all. It deliberately does not
 * judge whether a code fits a particular cart — that depends on the order, and
 * the checkout screen is where the code is picked and the exact saving shown.
 */

import { Box, Container, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconChevronRight, IconInfoCircle, IconTicket } from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { useNow } from "@/lib/hooks/useNow";
import { EmptyState, ErrorState } from "@/components/common/States";
import { VoucherCard } from "@/components/promotion/VoucherCard";
import { splitVouchers } from "@/lib/vouchers";
import { AppCard, LoadingView } from "@/components/ui/kit";
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
    <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
      <Stack gap={12}>
        {/* Desktop-only breadcrumb trail; the phone uses the app bar's back button. */}
        <Group gap={6} visibleFrom="sm" wrap="wrap">
          <Text component={Link} href="/" fz={13} c="var(--agri-muted)">
            Trang chủ
          </Text>
          <Text fz={13} c="var(--agri-muted-soft)">
            /
          </Text>
          <Text fz={13} c="var(--agri-text)">
            Mã giảm giá
          </Text>
        </Group>

        {isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <LoadingView label="Đang tải mã giảm giá…" />
        ) : vouchers.length === 0 ? (
          <EmptyState
            kind="search"
            icon={<IconTicket size={28} />}
            title="Chưa có mã giảm giá"
            description="Hiện chưa có chương trình giảm giá nào đang mở. Danh sách sẽ cập nhật khi hệ thống mở chương trình mới."
          />
        ) : (
          <Stack gap={12}>
            {eligible.length > 0 ? (
              <Stack gap={8}>
                <Text fz={13} fw={700} c="var(--agri-muted)">
                  Dùng được
                </Text>
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing={8}>
                  {eligible.map((option) => (
                    <VoucherCard key={option.voucher.id} voucher={option.voucher} usable />
                  ))}
                </SimpleGrid>
              </Stack>
            ) : null}

            {ineligible.length > 0 ? (
              <Stack gap={8}>
                <Text fz={13} fw={700} c="var(--agri-muted)">
                  Chưa dùng được
                </Text>
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing={8}>
                  {ineligible.map((option) => (
                    <VoucherCard
                      key={option.voucher.id}
                      voucher={option.voucher}
                      usable={false}
                      reason={option.reason}
                    />
                  ))}
                </SimpleGrid>
              </Stack>
            ) : null}

            {/* Mobile `pickRow`: the checkout screen is where a code is applied. */}
            <AppCard
              component={Link}
              href="/thanh-toan"
              padding={12}
              className="agri-press"
              style={{ borderColor: "var(--agri-primary-border)" }}
            >
              <Group gap={8} align="center" wrap="nowrap">
                <IconTicket size={17} color="var(--agri-primary)" aria-hidden />
                <Text fz={14} fw={700} c="var(--agri-primary-dark)" style={{ flex: 1 }}>
                  Chọn mã ở bước đặt hàng
                </Text>
                <IconChevronRight size={15} color="var(--agri-primary)" aria-hidden />
              </Group>
            </AppCard>

            <Group gap={6} align="flex-start" wrap="nowrap" px={4}>
              <Box style={{ flexShrink: 0, marginTop: 1, display: "inline-flex" }}>
                <IconInfoCircle size={15} color="var(--agri-info)" aria-hidden />
              </Box>
              <Text fz={12} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
                Hệ thống tính số tiền giảm dựa trên đơn hàng thực tế của bạn.
              </Text>
            </Group>
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
