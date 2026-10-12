"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Button, Col, Dropdown, Form, Input, Modal, Row, Table, Tag, Typography, type MenuProps } from "antd";
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

  /**
   * Records that the courier actually handed over the cash. This is the ONLY
   * action that marks a COD payment PAID — moving the order to DELIVERED no
   * longer does, because a delivered parcel does not prove collection. The
   * backend requires a transaction reference (courier receipt / gateway
   * reference), so the operator must type it in the dialog below; without it
   * the API answers 400 and nothing is marked PAID.
   */
  const [collectTarget, setCollectTarget] = useState<Payment | null>(null);
  const [collectForm] = Form.useForm();
  const confirmCollection = useAction(
    (vars: { paymentId: number; transactionReference: string }) =>
      resources.updatePaymentStatus(vars.paymentId, "PAID", vars.transactionReference),
    {
      invalidate: [queryKeys.order(id), ["orders"], ["payments"]],
      successMessage: "Đã ghi nhận thu tiền COD.",
      onSuccess: () => {
        setCollectTarget(null);
        collectForm.resetFields();
      },
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
  const isCodUnpaid = Boolean(
    order?.status === "SHIPPING" &&
      order?.payments?.some((p) => p.method === "COD" && p.status !== "PAID"),
  );
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
              <>
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
                {/**
                 * Marking a COD order delivered does NOT record the cash as
                 * collected — delivery success only proves the parcel arrived.
                 * The operator records the collection explicitly in the
                 * "Thanh toán" card below, after checking the courier's receipt.
                 */}
                {isCodUnpaid ? (
                  <span style={{ fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
                    COD chỉ được ghi nhận thu khi bạn xác nhận ở mục Thanh toán
                    bên dưới.
                  </span>
                ) : null}
              </>
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
            {/**
             * COD settlement note: `payment.status` is the ONLY proof that
             * money was collected. `order.status = DELIVERED` (or a delivery
             * photo / shipment event) proves the parcel arrived — it does NOT
             * prove the courier collected cash. Collection is recorded with the
             * explicit button below (PATCH /payments/:id/status), so a
             * DELIVERED order with a PENDING COD payment is a real
             * inconsistency the operator must resolve, not a state to gloss
             * over.
             */}
            {order.payments?.some(
              (p) => p.method === "COD" && p.status !== "PAID",
            ) && order.status === "DELIVERED" ? (
              <div
                style={{
                  marginBottom: 12,
                  padding: "8px 12px",
                  border: "1px solid #faad14",
                  borderRadius: 6,
                  background: "#fffbe6",
                  fontSize: 13,
                }}
              >
                Đơn đã giao nhưng tiền COD chưa được ghi nhận thu. Kiểm tra lại
                biên lai thu tiền của đơn vị vận chuyển trước khi xử lý tiếp —
                ảnh giao hàng không thay thế bằng chứng đã thu tiền.
              </div>
            ) : null}
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
                {
                  title: "Thao tác",
                  width: 150,
                  render: (_, row) =>
                    row.status === "PENDING" ? (
                      <Button
                        type="link"
                        size="small"
                        style={{ paddingInline: 0 }}
                        loading={confirmCollection.isPending}
                        onClick={() => {
                          setCollectTarget(row);
                          collectForm.setFieldsValue({ transactionReference: "" });
                        }}
                      >
                        Ghi nhận thu tiền
                      </Button>
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

          <Modal
            open={!!collectTarget}
            title="Ghi nhận thu tiền COD"
            onCancel={() => setCollectTarget(null)}
            onOk={() => collectForm.submit()}
            confirmLoading={confirmCollection.isPending}
            okText="Xác nhận đã thu tiền"
            cancelText="Hủy"
            forceRender
          >
            <p className="agri-muted" style={{ marginTop: 0 }}>
              Nhập mã biên lai thu tiền của đơn vị vận chuyển. Không có mã này,
              hệ thống không cho ghi nhận PAID.
            </p>
            <Form
              form={collectForm}
              layout="vertical"
              requiredMark={false}
              onFinish={(values: { transactionReference: string }) => {
                if (!collectTarget) return;
                confirmCollection.mutate({
                  paymentId: collectTarget.id,
                  transactionReference: values.transactionReference?.trim() ?? "",
                });
              }}
            >
              <Form.Item
                label="Mã biên lai / mã giao dịch"
                name="transactionReference"
                rules={[{ required: true, message: "Nhập mã biên lai thu tiền." }]}
              >
                <Input placeholder="VD: COD-BL-20261012-001" />
              </Form.Item>
            </Form>
          </Modal>

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
