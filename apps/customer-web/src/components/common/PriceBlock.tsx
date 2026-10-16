"use client";

/**
 * Price display.
 *
 * Shows the effective price and, only when a real promotion applies, the
 * original price struck through plus a discount badge. Prices always come from
 * the backend data (`basePrice` + public promotions); nothing is hardcoded.
 */

import { Group, Stack, Text } from "@mantine/core";
import { discountPercent, formatMoney } from "@/lib/format";
import { ToneBadge } from "@/components/ui/kit";
import type { EffectivePrice } from "@/lib/promotions";

export function PriceText({
  price,
  size = "md",
  fw = 700,
}: {
  price: EffectivePrice | null;
  size?: string;
  fw?: number;
}) {
  if (!price) {
    return (
      <Text size={size} c="var(--agri-muted)">
        Liên hệ
      </Text>
    );
  }

  return (
    <Text size={size} fw={fw} c="var(--agri-primary-dark)" style={{ lineHeight: 1.2 }}>
      {formatMoney(price.unitPrice)}
    </Text>
  );
}

export function PriceBlock({
  price,
  showSource = true,
  align = "flex-start",
}: {
  price: EffectivePrice | null;
  showSource?: boolean;
  align?: "flex-start" | "center" | "flex-end";
}) {
  if (!price) {
    return (
      <Text size="sm" c="var(--agri-muted)">
        Chưa có giá
      </Text>
    );
  }

  const percent = discountPercent(price.basePrice, price.unitPrice);

  return (
    <Stack gap={2} align={align}>
      <Group gap={8} wrap="nowrap" align="baseline">
        <Text fw={700} size="lg" c="var(--agri-primary-dark)" style={{ lineHeight: 1.2 }}>
          {formatMoney(price.unitPrice)}
        </Text>
        {price.source !== "NONE" ? (
          <Text size="sm" c="var(--agri-muted)" td="line-through">
            {formatMoney(price.basePrice)}
          </Text>
        ) : null}
      </Group>
      {showSource && price.source !== "NONE" ? (
        <Group gap={6}>
          <ToneBadge tone={price.source === "FLASH_SALE" ? "red" : "green"}>
            {price.source === "FLASH_SALE" ? "Flash Sale" : "Đang giảm giá"}
          </ToneBadge>
          {percent !== null ? (
            <Text size="xs" c="var(--agri-danger)" fw={600}>
              -{percent}%
            </Text>
          ) : null}
        </Group>
      ) : null}
    </Stack>
  );
}

/** Struck-through original price only (used in the cart summary). */
export function OriginalPrice({ value }: { value: string | number }) {
  return (
    <Text size="xs" c="var(--agri-muted)" td="line-through">
      {formatMoney(value)}
    </Text>
  );
}
