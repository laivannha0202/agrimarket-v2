"use client";

import type { ReactNode } from "react";
import { Descriptions } from "antd";
import type { DescriptionsProps } from "antd";

export type DescItem = {
  key: string;
  label: ReactNode;
  children: ReactNode;
  span?: number;
};

/**
 * Consistent two-column key/value block used across detail pages.
 * Values should already be formatted (money/date/status) by the caller.
 */
export function InfoDescriptions({
  items,
  column = 2,
}: {
  items: DescItem[];
  column?: number | Record<string, number>;
}) {
  const props: DescriptionsProps = {
    column,
    size: "middle",
    bordered: true,
    items: items.map((i) => ({
      key: i.key,
      label: i.label,
      children: i.children,
      span: i.span,
    })),
  };
  return <Descriptions {...props} />;
}

export function formatAddress(addr: {
  detail?: string | null;
  village?: string | null;
  ward?: string | null;
  district?: string | null;
  province?: string | null;
}): string {
  return [addr.detail, addr.village, addr.ward, addr.district, addr.province]
    .filter((part) => part && String(part).trim())
    .join(", ");
}
