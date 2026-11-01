"use client";

/**
 * Payment tag used in the order detail header.
 */

import { Tag } from "antd";
import { StatusTag } from "@/components/common/StatusTag";
import { paymentStatus } from "@/lib/status";
import type { Payment } from "@/types/api";

/** Small tag used in the header summary. */
export function PaymentBadge({ payment }: { payment?: Payment }) {
  if (!payment) return <Tag>Chưa thanh toán</Tag>;
  return <StatusTag status={paymentStatus(payment.status)} />;
}
