"use client";

/**
 * Pieces shared by more than one order-detail tab: the item column set, the
 * unit lookup and the empty-state row.
 *
 * They live here rather than in a tab file so two tabs cannot drift into two
 * different item tables.
 */

import { Empty } from "antd";
import type { ColumnsType } from "antd/es/table";
import { formatMoney, formatQuantity } from "@/lib/format";
import type { OrderItem } from "@/types/api";

export function itemUnit(item: OrderItem): string | null {
  const variant = item.productVariant;
  return variant?.saleUnit ?? variant?.weightUnit ?? null;
}

export const itemColumns: ColumnsType<OrderItem> = [
  {
    title: "STT",
    key: "index",
    width: 56,
    render: (_v, _r, index) => <span className="agri-muted">{index + 1}</span>,
  },
  {
    title: "Sản phẩm",
    dataIndex: "productNameSnapshot",
    render: (_v, row) => (
      <div>
        <div style={{ fontWeight: 500 }}>{row.productNameSnapshot}</div>
        <div className="agri-mono agri-muted" style={{ fontSize: 12 }}>
          {row.skuSnapshot}
        </div>
      </div>
    ),
  },
  {
    title: "ĐVT",
    key: "unit",
    width: 80,
    render: (_v, row) => itemUnit(row) ?? "—",
  },
  {
    title: "SL",
    dataIndex: "quantity",
    width: 90,
    align: "right",
    render: (v: string) => <span className="agri-nowrap">{formatQuantity(v)}</span>,
  },
  {
    title: "Đơn giá",
    dataIndex: "unitPriceSnapshot",
    width: 130,
    align: "right",
    render: (v: string) => <span className="agri-nowrap">{formatMoney(v)}</span>,
  },
  {
    title: "Thành tiền",
    dataIndex: "subtotal",
    width: 140,
    align: "right",
    render: (v: string) => (
      <strong className="agri-nowrap">{formatMoney(v)}</strong>
    ),
  },
];

export function SectionEmpty({ text }: { text: string }) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={<span className="agri-muted">{text}</span>}
      style={{ margin: "12px 0" }}
    />
  );
}
