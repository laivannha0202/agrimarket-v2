"use client";

/**
 * Voucher card, shared by the catalogue screen and any future summary block.
 *
 * States each programme's real rules (minimum order, discount, validity window,
 * per-customer limit) and whether the code is currently usable. It never
 * claims a saving: the amount depends on the actual order and is computed by
 * the backend at checkout.
 */

import { Badge, Card, Group, Stack, Text } from "@mantine/core";
import { formatDate, formatMoney } from "@/lib/format";
import { voucherValueLabel } from "@/lib/vouchers";
import type { Voucher } from "@/lib/api/types";

export function VoucherCard({ voucher, usable }: { voucher: Voucher; usable: boolean }) {
  return (
    <Card
      padding="md"
      radius="md"
      withBorder
      h="100%"
      style={{
        borderLeft: `4px solid ${
          usable ? "var(--mantine-color-agri-8)" : "var(--mantine-color-gray-4)"
        }`,
      }}
    >
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Text fw={700} c={usable ? "agri.9" : "dimmed"} style={{ letterSpacing: 0.4 }}>
            {voucher.code}
          </Text>
          <Badge variant="light" color={usable ? "agri" : "gray"} radius="sm">
            {voucherValueLabel(voucher)}
          </Badge>
        </Group>

        <Text size="sm" fw={600}>
          {voucher.name}
        </Text>

        <Text size="xs" c="dimmed">
          Đơn từ {formatMoney(voucher.minOrderAmount)}
          {voucher.maxDiscount ? ` · tối đa ${formatMoney(voucher.maxDiscount)}` : ""}
        </Text>
        <Text size="xs" c="dimmed">
          Hiệu lực {formatDate(voucher.startsAt)} — {formatDate(voucher.endsAt)}
        </Text>

        {voucher.perCustomerLimit !== null ? (
          <Text size="xs" c="dimmed">
            Mỗi khách dùng tối đa {voucher.perCustomerLimit} lần
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}
