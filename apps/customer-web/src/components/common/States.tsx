"use client";

/**
 * Loading / error / empty states.
 *
 * Styled like the Mobile app: a small illustration, bold title, muted
 * description and an optional action. Every state is in Vietnamese,
 * actionable, and never exposes HTTP codes, stack traces or backend internals.
 *
 * ILLUSTRATIONS ARE ILLUSTRATIONS: the empty/network/search artwork only ever
 * represents "nothing here" — it is never presented as a real product photo,
 * farm or delivery.
 */

import { Box, Button, Center, Group, Image, Skeleton, Stack, Text } from "@mantine/core";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconInbox,
  IconRefresh,
  IconShoppingCartOff,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api/client";

type EmptyIllustration = "cart" | "orders" | "search" | "network";

const ILLUSTRATIONS: Record<EmptyIllustration, { src: string; alt: string }> = {
  cart: { src: "/design/empty_states/empty_cart_360.png", alt: "Minh hoạ giỏ hàng trống" },
  orders: { src: "/design/empty_states/empty_orders_360.png", alt: "Minh hoạ danh sách đơn hàng trống" },
  search: { src: "/design/empty_states/empty_search_360.png", alt: "Minh hoạ không tìm thấy kết quả" },
  network: { src: "/design/empty_states/empty_network_360.png", alt: "Minh hoạ mất kết nối mạng" },
};

function Illustration({ kind }: { kind: EmptyIllustration }) {
  const art = ILLUSTRATIONS[kind];
  return (
    <Image src={art.src} alt={art.alt} w={132} h={132} fit="contain" aria-hidden />
  );
}

/**
 * Error state.
 *
 * The "no connection" artwork is shown ONLY when the request never reached the
 * server (`ApiError.status === 0`). A business error (4xx/5xx) gets the alert
 * icon instead — advising the customer to check Wi-Fi for a rejected voucher
 * would be wrong.
 */
export function ErrorState({
  error,
  onRetry,
  title,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const network = error instanceof ApiError && error.status === 0;
  const message =
    error instanceof ApiError
      ? error.message
      : "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.";

  return (
    <Center py={{ base: 32, sm: 48 }}>
      <Stack align="center" gap={10} maw={420} px={16}>
        {network ? (
          <Illustration kind="network" />
        ) : (
          <Box
            w={56}
            h={56}
            style={{
              borderRadius: 999,
              background: "var(--agri-danger-soft)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <IconAlertCircle size={26} color="var(--agri-danger)" />
          </Box>
        )}
        <Text fz={16} fw={700} c="var(--agri-text-strong)" ta="center">
          {title ?? (network ? "Không kết nối được máy chủ" : "Đã xảy ra lỗi")}
        </Text>
        <Text fz={13.5} c="var(--agri-muted)" ta="center" style={{ lineHeight: 1.45 }}>
          {message}
        </Text>
        {onRetry ? (
          <Button
            variant="default"
            radius={8}
            mt={4}
            leftSection={<IconRefresh size={16} />}
            styles={{
              root: {
                borderColor: "var(--agri-primary-border)",
                color: "var(--agri-primary)",
              },
            }}
            onClick={onRetry}
          >
            Thử lại
          </Button>
        ) : null}
      </Stack>
    </Center>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  kind,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  kind?: EmptyIllustration;
}) {
  return (
    <Center py={{ base: 40, sm: 56 }}>
      <Stack align="center" gap={10} maw={420} px={16}>
        {kind ? (
          <Illustration kind={kind} />
        ) : (
          <Box
            w={56}
            h={56}
            style={{
              borderRadius: 999,
              background: "var(--agri-primary-soft)",
              display: "grid",
              placeItems: "center",
            }}
          >
            {icon ?? <IconInbox size={26} color="var(--agri-primary)" />}
          </Box>
        )}
        <Text fz={16} fw={700} c="var(--agri-text-strong)" ta="center">
          {title}
        </Text>
        {description ? (
          <Text fz={13.5} c="var(--agri-muted)" ta="center" style={{ lineHeight: 1.45 }}>
            {description}
          </Text>
        ) : null}
        {action}
      </Stack>
    </Center>
  );
}

export function EmptyCartState({ action }: { action?: ReactNode }) {
  return (
    <EmptyState
      kind="cart"
      icon={<IconShoppingCartOff size={28} />}
      title="Giỏ hàng đang trống"
      description="Thêm nông sản vào giỏ để tiến hành đặt hàng."
      action={action}
    />
  );
}

export function NotFoundState({
  title = "Không tìm thấy nội dung",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState
      icon={<IconAlertTriangle size={26} color="var(--agri-danger)" />}
      title={title}
      description={description}
      action={action}
    />
  );
}

/** Product card grid skeleton with a stable card shape. */
export function ProductGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <Group gap={12} wrap="wrap" align="stretch">
      {Array.from({ length: count }).map((_, i) => (
        <Stack
          key={i}
          gap={8}
          p={0}
          style={{
            width: "calc(50% - 6px)",
            flexGrow: 1,
            maxWidth: 260,
          }}
        >
          <Skeleton height={150} radius={12} />
          <Skeleton height={14} width="85%" radius="sm" />
          <Skeleton height={14} width="55%" radius="sm" />
          <Skeleton height={16} width="40%" radius="sm" />
        </Stack>
      ))}
    </Group>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Stack gap={8}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={76} radius={12} />
      ))}
    </Stack>
  );
}

export function DetailSkeleton() {
  return (
    <Stack gap="lg">
      <Skeleton height={280} radius={12} />
      <Skeleton height={24} width="40%" radius="sm" />
      <Skeleton height={140} radius={12} />
    </Stack>
  );
}
