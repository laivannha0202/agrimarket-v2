"use client";

/**
 * Loading / error / empty states.
 *
 * Every state is in Vietnamese, actionable, and never exposes HTTP codes,
 * stack traces or backend internals.
 */

import {
  Alert,
  Button,
  Center,
  Group,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconInbox,
  IconRefresh,
  IconShoppingCartOff,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api/client";

export function ErrorState({
  error,
  onRetry,
  title = "Không tải được dữ liệu",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const message =
    error instanceof ApiError
      ? error.message
      : "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.";

  return (
    <Alert
      color="red"
      variant="light"
      icon={<IconAlertCircle size={18} />}
      title={title}
      radius="md"
    >
      <Stack gap="sm" align="flex-start">
        <Text size="sm">{message}</Text>
        {onRetry ? (
          <Button
            size="xs"
            variant="light"
            color="red"
            leftSection={<IconRefresh size={14} />}
            onClick={onRetry}
          >
            Thử lại
          </Button>
        ) : null}
      </Stack>
    </Alert>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Center py={{ base: 40, sm: 64 }}>
      <Stack align="center" gap="sm" maw={420}>
        <ThemeIcon size={56} radius="xl" variant="light" color="gray">
          {icon ?? <IconInbox size={28} />}
        </ThemeIcon>
        <Title order={4} ta="center">
          {title}
        </Title>
        {description ? (
          <Text size="sm" c="dimmed" ta="center">
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
      icon={<IconAlertTriangle size={28} />}
      title={title}
      description={description}
      action={action}
    />
  );
}

/** Product card grid skeleton with a stable aspect ratio. */
export function ProductGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <Group gap="md" wrap="wrap">
      {Array.from({ length: count }).map((_, i) => (
        <Stack key={i} gap="xs" w={{ base: "calc(50% - 8px)", sm: 180, md: 208, lg: 224 }}>
          <Skeleton height={150} radius="md" />
          <Skeleton height={14} width="85%" radius="sm" />
          <Skeleton height={14} width="55%" radius="sm" />
        </Stack>
      ))}
    </Group>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Stack gap="sm">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={72} radius="md" />
      ))}
    </Stack>
  );
}

export function DetailSkeleton() {
  return (
    <Stack gap="lg">
      <Skeleton height={280} radius="md" />
      <Skeleton height={24} width="40%" radius="sm" />
      <Skeleton height={140} radius="md" />
    </Stack>
  );
}
