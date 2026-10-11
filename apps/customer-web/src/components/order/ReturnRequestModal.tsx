"use client";

/**
 * Return request modal.
 *
 * Mirrors `CreateReturnRequestDto` exactly: `orderItemId`, `quantity`, `reason`.
 * The backend only accepts returns for DELIVERED orders and rejects a quantity
 * greater than the purchased quantity, so the form is limited to the order
 * item's own quantity and the reason is required (the API rejects an empty one).
 *
 * A customer cannot choose a lot, a warehouse or a refund method — returned
 * goods go back to quarantine and are re-inspected by the operator. The request
 * is stored server-side and listed again by `GET /returns/me`.
 */

import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatMoney, formatQuantity } from "@/lib/format";
import type { OrderItem } from "@/lib/api/types";

export function ReturnRequestModal({
  orderItem,
  opened,
  onClose,
  onCreated,
}: {
  orderItem: OrderItem;
  opened: boolean;
  onClose: () => void;
  onCreated?: (id: number) => void;
}) {
  const maxQuantity = Number(orderItem.quantity);
  const [quantity, setQuantity] = useState<number | string>(maxQuantity);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const createReturn = useMutation({
    mutationFn: () =>
      resources.createReturn({
        orderItemId: orderItem.id,
        quantity: Number(quantity),
        reason: reason.trim(),
      }),
    onSuccess: (record) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.returns.all });
      notifications.show({
        title: "Đã gửi yêu cầu trả hàng",
        message: "AgriMarket sẽ xem xét và phản hồi yêu cầu của bạn.",
        color: "agri",
      });
      onCreated?.(record.id);
      onClose();
      setReason("");
      setError(null);
    },
    onError: (err) => {
      const message =
        err instanceof ApiError ? err.message : "Không gửi được yêu cầu. Vui lòng thử lại.";
      setError(message);
    },
  });

  const submit = () => {
    setError(null);
    const value = Number(quantity);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Vui lòng nhập số lượng muốn trả.");
      return;
    }
    if (value > maxQuantity) {
      setError(`Số lượng trả không được vượt quá ${formatQuantity(maxQuantity)}.`);
      return;
    }
    if (!reason.trim()) {
      setError("Vui lòng nêu lý do trả hàng.");
      return;
    }
    createReturn.mutate();
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Yêu cầu trả hàng" centered size="md">
      <Stack gap="md">
        <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
          <Text size="xs">
            Hệ thống chỉ tiếp nhận trả hàng cho đơn đã giao. Hàng trả về sẽ được kiểm định
            lại trước khi xử lý.
          </Text>
        </Alert>

        <Stack gap={4}>
          <Text size="sm" fw={600}>
            {orderItem.productNameSnapshot}
          </Text>
          <Text size="xs" c="dimmed">
            Mã hàng: {orderItem.skuSnapshot}
          </Text>
          <Text size="xs" c="dimmed">
            Đã mua: {formatQuantity(orderItem.quantity)} · Đơn giá:{" "}
            {formatMoney(orderItem.unitPriceSnapshot)}
          </Text>
        </Stack>

        <NumberInput
          label="Số lượng muốn trả"
          value={quantity}
          onChange={setQuantity}
          min={0.001}
          max={maxQuantity}
          step={1}
          decimalScale={3}
          clampBehavior="none"
          required
          description={`Tối đa ${formatQuantity(maxQuantity)}`}
        />

        <Textarea
          label="Lý do trả hàng"
          placeholder="Ví dụ: Hàng bị dập trong quá trình vận chuyển"
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
          autosize
          minRows={3}
          required
        />

        {error ? (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
            <Text size="sm">{error}</Text>
          </Alert>
        ) : null}

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose} disabled={createReturn.isPending}>
            Hủy
          </Button>
          <Button onClick={submit} loading={createReturn.isPending}>
            Gửi yêu cầu
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
