"use client";

/**
 * Review modal.
 *
 * Mirrors `CreateReviewDto`: `orderItemId`, `rating` (1–5) and optional
 * `content`. The backend only accepts a review from the customer who bought the
 * item, only for a DELIVERED order, and only once per order item — those rules
 * are stated here instead of being re-implemented on the client.
 *
 * A submitted review is published as APPROVED by the backend, so the customer is
 * told it appears on the product page.
 */

import {
  Alert,
  Button,
  Group,
  Modal,
  Rating,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import type { OrderItem } from "@/lib/api/types";

export function ReviewModal({
  orderItem,
  opened,
  onClose,
  onCreated,
}: {
  orderItem: OrderItem;
  opened: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createReview = useMutation({
    mutationFn: () =>
      resources.createReview({
        orderItemId: orderItem.id,
        rating,
        content: content.trim() || undefined,
      }),
    onSuccess: () => {
      notifications.show({
        title: "Cảm ơn bạn đã đánh giá",
        message: "Đánh giá của bạn đã được đăng trên trang sản phẩm.",
        color: "agri",
      });
      onCreated?.();
      onClose();
      setContent("");
      setError(null);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Không gửi được đánh giá. Vui lòng thử lại.",
      );
    },
  });

  const submit = () => {
    setError(null);
    if (!rating || rating < 1 || rating > 5) {
      setError("Vui lòng chọn số sao từ 1 đến 5.");
      return;
    }
    createReview.mutate();
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Đánh giá sản phẩm" centered size="md">
      <Stack gap="md">
        <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
          <Text size="xs">
            Chỉ sản phẩm trong đơn đã giao mới có thể đánh giá, và mỗi sản phẩm chỉ đánh giá
            một lần.
          </Text>
        </Alert>

        <Stack gap={4}>
          <Text size="sm" fw={600}>
            {orderItem.productNameSnapshot}
          </Text>
          <Text size="xs" c="dimmed">
            Mã hàng: {orderItem.skuSnapshot}
          </Text>
        </Stack>

        <Stack gap={4}>
          <Text size="sm" fw={600}>
            Chất lượng sản phẩm
          </Text>
          <Rating value={rating} onChange={setRating} size="lg" />
        </Stack>

        <Textarea
          label="Nhận xét của bạn"
          placeholder="Ví dụ: Cà chua tươi, đóng gói cẩn thận, giao nhanh."
          value={content}
          onChange={(event) => setContent(event.currentTarget.value)}
          autosize
          minRows={3}
          description="Không bắt buộc."
        />

        {error ? (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
            <Text size="sm">{error}</Text>
          </Alert>
        ) : null}

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose} disabled={createReview.isPending}>
            Hủy
          </Button>
          <Button onClick={submit} loading={createReview.isPending}>
            Gửi đánh giá
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
