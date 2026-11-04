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

import { Box, Button, Container, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconInfoCircle, IconLock, IconTicket } from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { useNow } from "@/lib/hooks/useNow";
import { useAuth } from "@/lib/auth/useAuth";
import { useIsHydrated } from "@/lib/hooks/useIsHydrated";
import { EmptyState, ErrorState } from "@/components/common/States";
import { VoucherCard } from "@/components/promotion/VoucherCard";
import { splitVouchers } from "@/lib/vouchers";
import { AppCard } from "@/components/ui/kit";
import { layout } from "@/theme";

export function VoucherListView() {
  const now = useNow();
  const hydrated = useIsHydrated();
  const { user, isCustomer } = useAuth();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.vouchers.list(50),
    queryFn: () => resources.listVouchers(50),
    staleTime: 60_000,
  });

  const vouchers = data?.data ?? [];

  const { eligible, ineligible } = splitVouchers(vouchers, null, {
    now: now === 0 ? undefined : now,
  });

  const signedIn = hydrated && Boolean(user) && isCustomer;
  const showGuestInvite = hydrated && !signedIn;

  /**
   * One programme leaves half of the desktop row empty. Pairing it with the
   * usage guide keeps that row composed instead of showing a card and a void.
   */
  const guideBesideCard = eligible.length + ineligible.length === 1;

  return (
    <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 16, sm: 28 }}>
      <Stack gap={18}>
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

        {/* Page header */}
        <Stack gap={6} maw={760}>
          <Group gap={10} align="center" wrap="nowrap">
            <Box
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                display: "grid",
                placeItems: "center",
                background: "var(--agri-primary-soft)",
                border: "1px solid var(--agri-primary-border)",
                flexShrink: 0,
              }}
            >
              <IconTicket size={20} color="var(--agri-primary)" aria-hidden />
            </Box>
            <Text fz={{ base: 22, sm: 28 }} fw={800} c="var(--agri-text-strong)" lh={1.15}>
              Ưu đãi nông sản
            </Text>
          </Group>
          <Text fz={{ base: 13.5, sm: 15 }} c="var(--agri-muted)" lh={1.5} maw={680}>
            Khám phá các chương trình khuyến mãi đang áp dụng tại AgriMarket.
          </Text>
        </Stack>

        {/* Guest invite — informational, never forced. */}
        {showGuestInvite ? (
          <AppCard
            padding={14}
            style={{
              borderColor: "var(--agri-primary-border)",
              background: "var(--agri-primary-soft)",
            }}
          >
            <Group gap={12} align="center" wrap="wrap">
              <Box
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 999,
                  display: "grid",
                  placeItems: "center",
                  background: "var(--agri-surface)",
                  border: "1px solid var(--agri-primary-border)",
                  flexShrink: 0,
                }}
              >
                <IconLock size={18} color="var(--agri-primary)" aria-hidden />
              </Box>
              <Stack gap={2} style={{ flex: 1, minWidth: 220, maxWidth: 760 }}>
                <Text fz={14} fw={700} c="var(--agri-text-strong)">
                  Đăng nhập để sử dụng mã tại checkout
                </Text>
                <Text fz={12.5} c="var(--agri-muted)" lh={1.45}>
                  Bạn vẫn có thể xem và sao chép các mã công khai. Đăng nhập giúp theo dõi trạng
                  thái sử dụng và áp dụng mã khi đặt hàng.
                </Text>
              </Stack>
              <Button
                component={Link}
                href="/dang-nhap?tiep-theo=%2Fma-giam-gia"
                radius={8}
                color="agri"
                w={{ base: "100%", sm: "auto" }}
                ml={{ base: 0, sm: "auto" }}
                styles={{ root: { minHeight: 44 }, label: { fontSize: 13.5, fontWeight: 700 } }}
              >
                Đăng nhập
              </Button>
            </Group>
          </AppCard>
        ) : null}

        {isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <Stack gap={10}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Box
                key={i}
                style={{
                  height: 140,
                  borderRadius: 12,
                  background: "var(--agri-surface)",
                  border: "1px solid var(--agri-border)",
                }}
              />
            ))}
          </Stack>
        ) : vouchers.length === 0 ? (
          <EmptyState
            kind="search"
            icon={<IconTicket size={28} />}
            title="Chưa có mã giảm giá"
            description="Hiện chưa có chương trình giảm giá nào đang mở. Danh sách sẽ cập nhật khi hệ thống mở chương trình mới."
          />
        ) : (
          <Stack gap={18}>
            {eligible.length > 0 ? (
              <Stack gap={10}>
                <SectionLabel
                  title="Đang có hiệu lực"
                  description="Các mã đang trong thời gian áp dụng và còn lượt sử dụng."
                />
                {eligible.length === 1 ? (
                  guideBesideCard ? (
                    <SimpleGrid cols={{ base: 1, md: 2 }} spacing={{ base: 10, sm: 14 }}>
                      <VoucherCard voucher={eligible[0].voucher} usable />
                      <GuideCard />
                    </SimpleGrid>
                  ) : (
                    <Box maw={{ base: "100%", md: 640 }} w="100%">
                      <VoucherCard voucher={eligible[0].voucher} usable />
                    </Box>
                  )
                ) : (
                  <SimpleGrid cols={{ base: 1, md: 2 }} spacing={{ base: 10, sm: 14 }}>
                    {eligible.map((option) => (
                      <VoucherCard key={option.voucher.id} voucher={option.voucher} usable />
                    ))}
                  </SimpleGrid>
                )}
              </Stack>
            ) : null}

            {ineligible.length > 0 ? (
              <Stack gap={10}>
                <SectionLabel
                  title="Chưa dùng được"
                  description="Các mã chưa bắt đầu, hết hạn, hết lượt hoặc chưa đủ điều kiện."
                />
                {ineligible.length === 1 ? (
                  guideBesideCard ? (
                    <SimpleGrid cols={{ base: 1, md: 2 }} spacing={{ base: 10, sm: 14 }}>
                      <VoucherCard
                        voucher={ineligible[0].voucher}
                        usable={false}
                        reason={ineligible[0].reason}
                      />
                      <GuideCard />
                    </SimpleGrid>
                  ) : (
                    <Box maw={{ base: "100%", md: 640 }} w="100%">
                      <VoucherCard
                        voucher={ineligible[0].voucher}
                        usable={false}
                        reason={ineligible[0].reason}
                      />
                    </Box>
                  )
                ) : (
                  <SimpleGrid cols={{ base: 1, md: 2 }} spacing={{ base: 10, sm: 14 }}>
                    {ineligible.map((option) => (
                      <VoucherCard
                        key={option.voucher.id}
                        voucher={option.voucher}
                        usable={false}
                        reason={option.reason}
                      />
                    ))}
                  </SimpleGrid>
                )}
              </Stack>
            ) : null}

            {guideBesideCard ? null : <GuideCard />}

            <Text fz={12} c="var(--agri-muted)" lh={1.5} px={2} maw={760}>
              Trạng thái “Đang có hiệu lực” phản ánh chương trình và lượt sử dụng chung. Việc mã có
              áp dụng được cho đơn hàng cụ thể sẽ được hệ thống kiểm tra tại bước thanh toán.
            </Text>
          </Stack>
        )}
      </Stack>
    </Container>
  );
}

/** Usage guide + the two entry points the customer needs next. */
function GuideCard() {
  return (
    <AppCard padding={14} style={{ borderColor: "var(--agri-primary-border)" }}>
      <Stack gap={10}>
        <Group gap={8} align="center" wrap="nowrap">
          <Box
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              display: "grid",
              placeItems: "center",
              background: "var(--agri-primary-soft)",
              flexShrink: 0,
            }}
          >
            <IconInfoCircle size={17} color="var(--agri-primary)" aria-hidden />
          </Box>
          <Text fz={14} fw={700} c="var(--agri-text-strong)">
            Cách sử dụng mã giảm giá
          </Text>
        </Group>
        <Stack gap={4} pl={2}>
          <GuideStep text="Sao chép mã bạn muốn sử dụng." />
          <GuideStep text="Thêm sản phẩm vào giỏ và tiến hành đặt hàng." />
          <GuideStep text="Nhập hoặc chọn mã tại bước thanh toán để hệ thống kiểm tra và tính giảm giá." />
          <GuideStep text="Số tiền giảm cuối cùng do backend xác nhận theo đơn hàng thực tế." />
        </Stack>
        <Group gap={10} wrap="wrap" mt={2}>
          <Button
            component={Link}
            href="/san-pham"
            radius={8}
            color="agri"
            styles={{ root: { minHeight: 44 }, label: { fontSize: 14, fontWeight: 700 } }}
          >
            Mua sắm ngay
          </Button>
          <Button
            component={Link}
            href="/thanh-toan"
            radius={8}
            variant="default"
            styles={{
              root: { minHeight: 44, borderColor: "var(--agri-primary-border)" },
              label: { fontSize: 14, fontWeight: 700, color: "var(--agri-primary-dark)" },
            }}
          >
            Đến thanh toán
          </Button>
        </Group>
      </Stack>
    </AppCard>
  );
}

function SectionLabel({ title, description }: { title: string; description: string }) {
  return (
    <Stack gap={2}>
      <Text fz={15} fw={700} c="var(--agri-text-strong)">
        {title}
      </Text>
      <Text fz={12.5} c="var(--agri-muted)" lh={1.45}>
        {description}
      </Text>
    </Stack>
  );
}

function GuideStep({ text }: { text: string }) {
  return (
    <Group gap={8} align="flex-start" wrap="nowrap">
      <Box
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: "var(--agri-primary)",
          marginTop: 7,
          flexShrink: 0,
        }}
      />
      <Text fz={13} c="var(--agri-text)" lh={1.5} style={{ flex: 1 }}>
        {text}
      </Text>
    </Group>
  );
}
