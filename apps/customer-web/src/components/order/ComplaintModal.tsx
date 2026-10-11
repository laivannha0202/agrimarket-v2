"use client";

/**
 * Complaint modal.
 *
 * Mirrors `CreateComplaintDto`: `orderId`, optional `orderItemId`, `type`
 * (the real `ComplaintType` enum) and `content`. The backend accepts a
 * complaint for any of the customer's own orders, so the modal is reachable
 * from every order status.
 *
 * The complaint is stored server-side: `GET /complaints/me` lists it again
 * after a re-login, so nothing is kept in the browser.
 */

import {
  Alert,
  Button,
  Group,
  Modal,
  Select,
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
import { complaintTypeLabel, COMPLAINT_TYPE } from "@/lib/status";
import type { ComplaintType, OrderItem } from "@/lib/api/types";

const TYPE_OPTIONS = (Object.keys(COMPLAINT_TYPE) as ComplaintType[]).map((value) => ({
  value,
  label: complaintTypeLabel(value),
}));

export function ComplaintModal({
  orderId,
  items,
  opened,
  onClose,
  onCreated,
}: {
  orderId: number;
  items: OrderItem[];
  opened: boolean;
  onClose: () => void;
  onCreated?: (id: number) => void;
}) {
  const [type, setType] = useState<string | null>(null);
  const [orderItemId, setOrderItemId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const createComplaint = useMutation({
    mutationFn: () =>
      resources.createComplaint({
        orderId,
        orderItemId: orderItemId ? Number(orderItemId) : undefined,
        type: type as string,
        content: content.trim(),
      }),
    onSuccess: (complaint) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.complaints.all });
      notifications.show({
        title: "Đã gửi khiếu nại",
        message: "AgriMarket sẽ tiếp nhận và xử lý khiếu nại của bạn.",
        color: "agri",
      });
      onCreated?.(complaint.id);
      onClose();
      setType(null);
      setOrderItemId(null);
      setContent("");
      setError(null);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Không gửi được khiếu nại. Vui lòng thử lại.",
      );
    },
  });

  const submit = () => {
    setError(null);
    if (!type) {
      setError("Vui lòng chọn loại khiếu nại.");
      return;
    }
    if (!content.trim()) {
      setError("Vui lòng mô tả nội dung khiếu nại.");
      return;
    }
    createComplaint.mutate();
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Gửi khiếu nại" centered size="md">
      <Stack gap="md">
        <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
          <Text size="xs">
            Khiếu nại được gửi tới bộ phận chăm sóc khách hàng của AgriMarket. Bạn sẽ nhận
            phản hồi qua email hoặc số điện thoại đã đăng ký.
          </Text>
        </Alert>

        <Select
          label="Loại khiếu nại"
          placeholder="Chọn loại khiếu nại"
          data={TYPE_OPTIONS}
          value={type}
          onChange={setType}
          required
        />

        <Select
          label="Sản phẩm liên quan"
          placeholder="Không chọn nếu khiếu nại cả đơn hàng"
          data={items.map((item) => ({
            value: String(item.id),
            label: item.productNameSnapshot,
          }))}
          value={orderItemId}
          onChange={setOrderItemId}
          clearable
          searchable
          description="Để trống nếu khiếu nại liên quan tới toàn bộ đơn hàng."
        />

        <Textarea
          label="Nội dung khiếu nại"
          placeholder="Mô tả chi tiết vấn đề bạn gặp phải"
          value={content}
          onChange={(event) => setContent(event.currentTarget.value)}
          autosize
          minRows={4}
          required
        />

        {error ? (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
            <Text size="sm">{error}</Text>
          </Alert>
        ) : null}

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose} disabled={createComplaint.isPending}>
            Hủy
          </Button>
          <Button onClick={submit} loading={createComplaint.isPending}>
            Gửi khiếu nại
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
