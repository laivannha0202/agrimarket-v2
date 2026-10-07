"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Button, Col, Dropdown, Row, Table, Tag, Typography, type MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DetailPage, DetailCard } from "@/components/common/DetailPage";
import { InfoDescriptions, formatAddress } from "@/components/common/InfoDescriptions";
import { StatusTag } from "@/components/common/StatusTag";
import { useDetailQuery } from "@/hooks/useDetailQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatMoney, formatDateTime, formatQuantity } from "@/lib/format";
import {
  orderStatus,
  paymentMethod,
  paymentStatus,
  shipmentStatus,
  fulfillmentStatus,
  refundStatus,
} from "@/lib/status";
import type { Order, OrderItem, PartnerOrder, Payment, Shipment } from "@/types/api";

/** Allowed order transitions, mirroring the backend state machine. */
const NEXT_STATUS: Record<string, { value: string; label: string }[]> = {
  PENDING_CONFIRMATION: [
    { value: "CONFIRMED", label: "Xác nhận đơn" },
    { value: "CANCELLED", label: "Hủy đơn" },
  ],
  CONFIRMED: [
    { value: "PREPARING", label: "Bắt đầu chuẩn bị" },
    { value: "CANCELLED", label: "Hủy đơn" },
  ],
  PREPARING: [
    { value: "READY_TO_SHIP", label: "Sẵn sàng giao" },
    { value: "CANCELLED", label: "Hủy đơn" },
  ],
  READY_TO_SHIP: [
    { value: "SHIPPING", label: "Bắt đầu giao" },
    { value: "CANCELLED", label: "Hủy đơn" },
  ],
  SHIPPING: [
    { value: "DELIVERED", label: "Đã giao hàng" },
    { value: "CANCELLED", label: "Hủy đơn" },
  ],
  DELIVERED: [],
  CANCELLED: [],
};

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [pending, setPending] = useState(false);

  const { data: order, isLoading, isError, refetch } = useDetailQuery<Order>(
    queryKeys.order(id),
    () => resources.order(id),
  );

  const updateStatus = useAction(
    (status: string) => resources.updateOrderStatus(id, status),
    {
      invalidate: [queryKeys.order(id), ["orders"]],
      successMessage: "Đã cập nhật trạng thái đơn hàng.",
      onSuccess: () => setPending(false),
    },
  );

  const itemColumns: ColumnsType<OrderItem> = [
    { title: "Sản phẩm", dataIndex: "productNameSnapshot" },
    { title: "SKU", dataIndex: "skuSnapshot", render: (v: string) => <span className="agri-mono">{v}</span> },
    {
      title: "Đơn giá",
      dataIndex: "unitPriceSnapshot",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatMoney(v)}</span>,
    },
    {
      title: "SL",
      dataIndex: "quantity",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatQuantity(v)}</span>,
    },
    {
      title: "Thành tiền",
      dataIndex: "subtotal",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatMoney(v)}</span>,
    },
  ];

  const transitions = order ? NEXT_STATUS[order.status] ?? [] : [];
  const menuItems: MenuProps["items"] = transitions.map((t) => ({
    key: t.value,
    label: t.label,
    danger: t.value === "CANCELLED",
  }));

  return (
    <DetailPage
      title={order ? `Đơn hàng ${order.code}` : "Chi tiết đơn hàng"}
      subtitle={order ? `Tạo lúc ${formatDateTime(order.createdAt)}` : undefined}
      backHref="/orders"
      backLabel="Danh sách đơn hàng"
      loading={isLoading}
      error={isError ? new Error("Không tải được đơn hàng.") : undefined}
      onRetry={() => void refetch()}
      extra={
        order ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <StatusTag status={orderStatus(order.status)} />
            {transitions.length > 0 ? (
              <Dropdown
                menu={{
                  items: menuItems,
                  onClick: ({ key }) => {
                    setPending(true);
                    updateStatus.mutate(key);
                  },
                }}
              >
                <Button type="primary" loading={updateStatus.isPending || pending}>
                  Chuyển trạng thái
                </Button>
              </Dropdown>
            ) : (
              <Tag>Đã kết thúc</Tag>
            )}
          </div>
        ) : undefined
      }
    >
      {order ? (
        <>
          <DetailCard title="Thông tin chung">
            <InfoDescriptions
              items={[
                { key: "code", label: "Mã đơn", children: <span className="agri-mono">{order.code}</span> },
                {
                  key: "customer",
                  label: "Khách hàng",
                  children: order.customer
                    ? `${order.customer.fullName} — ${order.customer.email}`
                    : "—",
                },
                {
                  key: "phone",
                  label: "Số điện thoại",
                  children: order.customer?.phone ?? "—",
                },
                { key: "createdAt", label: "Ngày tạo", children: formatDateTime(order.createdAt) },
                {
                  key: "shipTo",
                  label: "Người nhận",
                  children: order.shippingAddressSnapshot
                    ? `${order.shippingAddressSnapshot.recipientName} — ${order.shippingAddressSnapshot.phone}`
                    : "—",
                },
                {
                  key: "shipAddr",
                  label: "Địa chỉ giao",
                  span: 2,
                  children: order.shippingAddressSnapshot
                    ? formatAddress(order.shippingAddressSnapshot)
                    : "—",
                },
                { key: "note", label: "Ghi chú", span: 2, children: order.note ?? "—" },
              ]}
            />
          </DetailCard>

          <DetailCard title="Giá trị đơn hàng">
            <InfoDescriptions
              items={[
                { key: "subtotal", label: "Tạm tính", children: formatMoney(order.subtotal) },
                { key: "discount", label: "Giảm giá", children: formatMoney(order.discountTotal) },
                { key: "shipping", label: "Phí giao hàng", children: formatMoney(order.shippingFee) },
                {
                  key: "grandTotal",
                  label: "Tổng thanh toán",
                  children: <strong>{formatMoney(order.grandTotal)}</strong>,
                },
              ]}
            />
          </DetailCard>

          {order.partnerOrders?.map((po: PartnerOrder) => (
            <DetailCard
              key={po.id}
              title={`Đối tác: ${po.partner?.name ?? po.code}`}
              extra={<StatusTag status={orderStatus(po.status)} />}
            >
              <InfoDescriptions
                column={3}
                items={[
                  { key: "code", label: "Mã đơn đối tác", children: <span className="agri-mono">{po.code}</span> },
                  { key: "subtotal", label: "Tạm tính", children: formatMoney(po.subtotal) },
                  { key: "commission", label: "Hoa hồng", children: formatMoney(po.commissionAmount) },
                  { key: "payable", label: "Phải trả đối tác", children: formatMoney(po.payableAmount) },
                ]}
              />
              <div style={{ height: 12 }} />
              <Table<OrderItem>
                size="small"
                rowKey="id"
                columns={itemColumns}
                dataSource={po.items ?? []}
                pagination={false}
                locale={{ emptyText: "Không có sản phẩm" }}
              />
              {po.shipments && po.shipments.length > 0 ? (
                <>
                  <div style={{ height: 12 }} />
                  <Typography.Text strong>Vận đơn</Typography.Text>
                  <Table<Shipment>
                    size="small"
                    rowKey="id"
                    style={{ marginTop: 8 }}
                    columns={[
                      { title: "Mã", dataIndex: "code", render: (v: string) => <span className="agri-mono">{v}</span> },
                      { title: "Đơn vị vận chuyển", dataIndex: "carrier", render: (v: string | null) => v ?? "—" },
                      { title: "Mã vận đơn", dataIndex: "trackingCode", render: (v: string | null) => v ?? "—" },
                      {
                        title: "Trạng thái",
                        dataIndex: "status",
                        render: (s: string) => <StatusTag status={shipmentStatus(s)} />,
                      },
                    ]}
                    dataSource={po.shipments}
                    pagination={false}
                  />
                </>
              ) : null}
              {po.fulfillments && po.fulfillments.length > 0 ? (
                <>
                  <div style={{ height: 12 }} />
                  <Typography.Text strong>Đóng gói</Typography.Text>
                  <Table
                    size="small"
                    rowKey="id"
                    style={{ marginTop: 8 }}
                    columns={[
                      {
                        title: "Trạng thái",
                        dataIndex: "status",
                        render: (s: string) => <StatusTag status={fulfillmentStatus(s)} />,
                      },
                      {
                        title: "Đóng gói lúc",
                        dataIndex: "packedAt",
                        render: (v: string | null) => formatDateTime(v),
                      },
                      { title: "Ghi chú", dataIndex: "note", render: (v: string | null) => v ?? "—" },
                    ]}
                    dataSource={po.fulfillments}
                    pagination={false}
                  />
                </>
              ) : null}
            </DetailCard>
          ))}

          <DetailCard title="Thanh toán">
            <Table<Payment>
              size="small"
              rowKey="id"
              columns={[
                {
                  title: "Phương thức",
                  dataIndex: "method",
                  render: (m: string) => <StatusTag status={paymentMethod(m)} />,
                },
                {
                  title: "Số tiền",
                  dataIndex: "amount",
                  align: "right",
                  render: (v: string) => <span className="agri-nowrap">{formatMoney(v)}</span>,
                },
                {
                  title: "Trạng thái",
                  dataIndex: "status",
                  render: (s: string) => <StatusTag status={paymentStatus(s)} />,
                },
                {
                  title: "Mã giao dịch",
                  dataIndex: "transactionReference",
                  render: (v: string | null) => v ?? "—",
                },
                {
                  title: "Hoàn tiền",
                  render: (_, row) =>
                    row.refunds && row.refunds.length > 0 ? (
                      <div>
                        {row.refunds.map((r) => (
                          <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span className="agri-nowrap">{formatMoney(r.amount)}</span>
                            <StatusTag status={refundStatus(r.status)} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      "—"
                    ),
                },
              ]}
              dataSource={order.payments ?? []}
              pagination={false}
              locale={{ emptyText: "Chưa có thanh toán" }}
            />
          </DetailCard>

          {order.voucherRedemptions && order.voucherRedemptions.length > 0 ? (
            <DetailCard title="Voucher đã dùng">
              <Row gutter={[16, 16]}>
                {order.voucherRedemptions.map((v) => (
                  <Col key={v.id} xs={24} sm={12} md={8}>
                    <div className="agri-muted">
                      Voucher #{v.voucherId} — giảm {formatMoney(v.discountAmount)}
                    </div>
                  </Col>
                ))}
              </Row>
            </DetailCard>
          ) : null}
        </>
      ) : null}
    </DetailPage>
  );
}
