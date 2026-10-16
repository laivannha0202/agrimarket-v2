"use client";

/**
 * Voucher card — web twin of the Mobile voucher `renderCard`.
 *
 * Left rail (green when usable, gray when not), code, value pill and the
 * programme's real rules (minimum order, discount cap, validity window, quota).
 * It never claims a saving: the amount depends on the actual order and is
 * computed by the backend at checkout. `reason` is rendered inside the card,
 * exactly like the app renders `option.reason` on ineligible cards.
 */

import { Box, Group, Stack, Text } from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowDownCircle,
  IconCalendar,
  IconShoppingCart,
  IconUsers,
} from "@tabler/icons-react";
import { formatDate, formatMoney } from "@/lib/format";
import { voucherValueLabel } from "@/lib/vouchers";
import { AppCard } from "@/components/ui/kit";
import type { Voucher } from "@/lib/api/types";

export function VoucherCard({
  voucher,
  usable,
  reason,
}: {
  voucher: Voucher;
  usable: boolean;
  reason?: string | null;
}) {
  return (
    <AppCard
      padding={0}
      style={{
        overflow: "hidden",
        background: usable ? "var(--agri-surface)" : "var(--agri-page)",
      }}
    >
      <Group gap={0} align="stretch" wrap="nowrap">
        <Box
          style={{
            width: 6,
            flexShrink: 0,
            background: usable ? "var(--agri-primary)" : "var(--agri-border-strong)",
          }}
        />
        <Stack gap={2} p={12} style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" align="center" gap={8} wrap="nowrap">
            <Text
              fz={16}
              fw={700}
              c={usable ? "var(--agri-primary)" : "var(--agri-muted)"}
              style={{ letterSpacing: 0.5, minWidth: 0 }}
              truncate
            >
              {voucher.code}
            </Text>
            <Box
              style={{
                background: usable ? "var(--agri-primary-soft)" : "var(--agri-page)",
                border: `1px solid ${usable ? "var(--agri-primary-border)" : "var(--agri-border)"}`,
                borderRadius: 999,
                padding: "2px 8px",
                flexShrink: 0,
              }}
            >
              <Text fz={12} fw={700} c={usable ? "var(--agri-primary-dark)" : "var(--agri-muted)"}>
                {voucherValueLabel(voucher)}
              </Text>
            </Box>
          </Group>

          <Text fz={14} fw={600} c="var(--agri-text)" mb={2}>
            {voucher.name}
          </Text>

          <MetaRow icon={<IconShoppingCart size={13} aria-hidden />}>
            Đơn tối thiểu {formatMoney(voucher.minOrderAmount)}
          </MetaRow>
          {voucher.maxDiscount ? (
            <MetaRow icon={<IconArrowDownCircle size={13} aria-hidden />}>
              Giảm tối đa {formatMoney(voucher.maxDiscount)}
            </MetaRow>
          ) : null}
          <MetaRow icon={<IconCalendar size={13} aria-hidden />}>
            {formatDate(voucher.startsAt)} – {formatDate(voucher.endsAt)}
          </MetaRow>
          {voucher.usageLimit !== null ? (
            <MetaRow icon={<IconUsers size={13} aria-hidden />}>
              Đã dùng {voucher.usedCount}/{voucher.usageLimit}
              {voucher.perCustomerLimit ? ` · tối đa ${voucher.perCustomerLimit}/khách` : ""}
            </MetaRow>
          ) : null}

          {!usable && reason ? (
            <Group gap={5} align="flex-start" wrap="nowrap" mt={4}>
              <IconAlertCircle
                size={13}
                color="var(--agri-danger)"
                style={{ flexShrink: 0, marginTop: 2 }}
                aria-hidden
              />
              <Text fz={12} lh="17px" c="var(--agri-danger)" style={{ flex: 1 }}>
                {reason}
              </Text>
            </Group>
          ) : null}
        </Stack>
      </Group>
    </AppCard>
  );
}

function MetaRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Group gap={5} align="center" wrap="nowrap" mt={2}>
      <Box c="var(--agri-muted-soft)" style={{ display: "inline-flex", flexShrink: 0 }}>
        {icon}
      </Box>
      <Text fz={12.5} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
        {children}
      </Text>
    </Group>
  );
}
