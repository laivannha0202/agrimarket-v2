"use client";

/**
 * Voucher card — web twin of the Mobile voucher `renderCard`.
 *
 * Left rail carries the discount value (the one thing the customer scans for);
 * the right side carries the programme name, the public code with a copy
 * action, the real rules (minimum order, discount cap, validity window, quota)
 * and the programme status. The amount actually saved is never computed here:
 * the backend computes it at checkout from the real order.
 */

import { useState } from "react";
import { Box, Button, Group, Stack, Text } from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowDownCircle,
  IconCalendar,
  IconCheck,
  IconCopy,
  IconShoppingCart,
  IconTicket,
  IconUsers,
} from "@tabler/icons-react";
import { formatDate, formatMoney } from "@/lib/format";
import { voucherValueLabel } from "@/lib/vouchers";
import { useNow } from "@/lib/hooks/useNow";
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
  const now = useNow();
  const [copied, setCopied] = useState(false);

  const status = programStatus(voucher, now);
  const remaining =
    voucher.usageLimit === null ? null : Math.max(0, voucher.usageLimit - voucher.usedCount);

  const copyCode = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(voucher.code);
      } else {
        const input = document.createElement("textarea");
        input.value = voucher.code;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.focus();
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <AppCard
      padding={0}
      style={{
        overflow: "hidden",
        height: "100%",
        background: usable ? "var(--agri-surface)" : "var(--agri-page)",
      }}
    >
      <Group gap={0} align="stretch" wrap="nowrap" style={{ minHeight: 132 }}>
        {/* Left rail: the discount value, the thing the customer scans for. */}
        <Box
          style={{
            width: 96,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: 12,
            background: usable ? "var(--agri-primary-soft)" : "var(--agri-page)",
            borderRight: "1px dashed var(--agri-border-strong)",
            textAlign: "center",
          }}
        >
          <Box
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              background: usable ? "var(--agri-primary)" : "var(--agri-border-strong)",
              color: "#ffffff",
            }}
          >
            <IconTicket size={17} aria-hidden />
          </Box>
          <Text
            fz={15}
            fw={800}
            c={usable ? "var(--agri-primary-dark)" : "var(--agri-muted)"}
            ta="center"
            lh={1.15}
            style={{ wordBreak: "break-word" }}
          >
            {voucherValueLabel(voucher)}
          </Text>
        </Box>

        {/* Right side: programme, code, rules, status. */}
        <Stack gap={6} p={{ base: 12, sm: 14 }} style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" align="flex-start" gap={8} wrap="wrap">
            <Text
              fz={15}
              fw={700}
              c="var(--agri-text-strong)"
              flex={{ base: "1 1 100%", sm: "1 1 0" }}
              miw={0}
              lineClamp={2}
            >
              {voucher.name}
            </Text>
            <StatusBadge label={status.label} tone={status.tone} />
          </Group>

          <Text fz={11.5} c="var(--agri-muted)" style={{ marginTop: -2 }}>
            Mã công khai · áp dụng tại bước thanh toán
          </Text>

          <Group gap={6} align="center" wrap="nowrap">
            <Box
              style={{
                flex: 1,
                minWidth: 0,
                background: "var(--agri-page)",
                border: "1px solid var(--agri-border)",
                borderRadius: 8,
                padding: "6px 10px",
              }}
            >
              <Text
                fz={14}
                fw={700}
                c="var(--agri-text-strong)"
                style={{ letterSpacing: 0.6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                truncate
              >
                {voucher.code}
              </Text>
            </Box>
            <Button
              type="button"
              size="sm"
              variant="light"
              color="agri"
              radius={8}
              leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              onClick={copyCode}
              aria-live="polite"
              styles={{ root: { minHeight: 36, paddingInline: 10 } }}
            >
              {copied ? "Đã chép" : "Sao chép"}
            </Button>
          </Group>

          <Stack gap={3} mt={2}>
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
            {remaining !== null ? (
              <MetaRow icon={<IconUsers size={13} aria-hidden />}>
                Còn {remaining} lượt
                {voucher.perCustomerLimit ? ` · tối đa ${voucher.perCustomerLimit}/khách` : ""}
              </MetaRow>
            ) : null}
          </Stack>

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
          ) : (
            <Text fz={11.5} c="var(--agri-muted)" lh="16px" mt={2}>
              Số tiền giảm cuối cùng được hệ thống tính theo đơn hàng thực tế.
            </Text>
          )}
        </Stack>
      </Group>
    </AppCard>
  );
}

function programStatus(
  voucher: Voucher,
  now: number,
): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (voucher.status !== "ACTIVE") {
    return { label: "Ngừng áp dụng", tone: "neutral" };
  }
  if (now === 0) {
    return { label: "Đang có hiệu lực", tone: "success" };
  }
  const start = new Date(voucher.startsAt).getTime();
  const end = new Date(voucher.endsAt).getTime();
  if (Number.isFinite(start) && now < start) {
    return { label: "Chưa bắt đầu", tone: "warning" };
  }
  if (Number.isFinite(end) && now > end) {
    return { label: "Đã hết hạn", tone: "danger" };
  }
  if (voucher.usageLimit !== null && voucher.usedCount >= voucher.usageLimit) {
    return { label: "Hết lượt", tone: "danger" };
  }
  return { label: "Đang có hiệu lực", tone: "success" };
}

function StatusBadge({ label, tone }: { label: string; tone: "success" | "warning" | "danger" | "neutral" }) {
  const colors =
    tone === "success"
      ? { bg: "var(--agri-primary-soft)", border: "var(--agri-primary-border)", fg: "var(--agri-primary-dark)" }
      : tone === "warning"
        ? { bg: "var(--agri-warning-soft)", border: "var(--agri-warning)", fg: "var(--agri-warning)" }
        : tone === "danger"
          ? { bg: "var(--agri-danger-soft)", border: "var(--agri-danger)", fg: "var(--agri-danger)" }
          : { bg: "var(--agri-page)", border: "var(--agri-border)", fg: "var(--agri-muted)" };

  return (
    <Box
      component="span"
      style={{
        flexShrink: 0,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 11.5,
        fontWeight: 700,
        lineHeight: "16px",
        color: colors.fg,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </Box>
  );
}

function MetaRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Group gap={6} align="center" wrap="nowrap">
      <Box c="var(--agri-muted-soft)" style={{ display: "inline-flex", flexShrink: 0 }}>
        {icon}
      </Box>
      <Text fz={12.5} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
        {children}
      </Text>
    </Group>
  );
}
