"use client";

/**
 * "Sản phẩm": what was sold, grouped by the partner that fulfils it.
 *
 * Every figure is the price/name snapshot written at checkout, never a
 * recomputation from the current catalogue.
 */

import { Table } from "antd";
import { DetailCard } from "@/components/common/DetailPage";
import { InfoDescriptions } from "@/components/common/InfoDescriptions";
import { StatusTag } from "@/components/common/StatusTag";
import { formatMoney } from "@/lib/format";
import { orderStatus } from "@/lib/status";
import type { Order, OrderItem, PartnerOrder } from "@/types/api";
import { itemColumns, SectionEmpty } from "./shared";

function PartnerItemsCard({ partnerOrder }: { partnerOrder: PartnerOrder }) {
  const items = partnerOrder.items ?? [];
  return (
    <DetailCard
      title={
        <span>
          Đối tác: {partnerOrder.partner?.name ?? partnerOrder.code}{" "}
          <span className="agri-mono agri-muted" style={{ fontSize: 12, fontWeight: 400 }}>
            {partnerOrder.code}
          </span>
        </span>
      }
      extra={<StatusTag status={orderStatus(partnerOrder.status)} />}
    >
      <InfoDescriptions
        column={{ xs: 1, sm: 2, md: 3 }}
        items={[
          { key: "subtotal", label: "Tạm tính", children: formatMoney(partnerOrder.subtotal) },
          {
            key: "discount",
            label: "Giảm giá",
            children: formatMoney(partnerOrder.discountTotal),
          },
          {
            key: "items",
            label: "Số dòng hàng",
            children: `${items.length}`,
          },
        ]}
      />
      <div style={{ height: 12 }} />
      <Table<OrderItem>
        size="small"
        rowKey="id"
        columns={itemColumns}
        dataSource={items}
        pagination={false}
        scroll={{ x: 640 }}
        locale={{ emptyText: <SectionEmpty text="Đối tác chưa có dòng hàng." /> }}
      />
    </DetailCard>
  );
}

export function OrderItemsTab({ order }: { order: Order }) {
  const partnerOrders = order.partnerOrders ?? [];
  if (partnerOrders.length === 0) {
    return <DetailCard title="Sản phẩm & đối tác"><SectionEmpty text="Đơn hàng chưa có sản phẩm." /></DetailCard>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {partnerOrders.map((po) => (
        <PartnerItemsCard key={po.id} partnerOrder={po} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thanh toán
// ---------------------------------------------------------------------------
