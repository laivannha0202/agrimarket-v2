"use client";

/**
 * "Tổng quan": who ordered, who receives, where and when.
 *
 * Read-only over the stored order snapshot — the address is what the order was
 * placed with, not today's customer profile.
 */

import { Col, Row } from "antd";
import { DetailCard } from "@/components/common/DetailPage";
import { InfoDescriptions, formatAddress } from "@/components/common/InfoDescriptions";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { Order } from "@/types/api";
import { SectionEmpty } from "./shared";

// ---------------------------------------------------------------------------
// Tổng quan
// ---------------------------------------------------------------------------

export function OrderOverviewTab({ order }: { order: Order }) {
  const address = order.shippingAddressSnapshot;
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={14}>
        <DetailCard title="Khách hàng & giao nhận">
          <InfoDescriptions
            // One field per row at every width. A two-column grid gives each
            // value ~150px inside this card, which is narrower than
            // "lan.nguyen@agrimarket.vn" — the address broke mid-token at 1440
            // and the email broke at every size. One column costs vertical
            // space and never truncates a value.
            column={1}
            items={[
              {
                key: "customer",
                label: "Khách hàng",
                children: order.customer?.fullName ?? "—",
              },
              { key: "email", label: "Email", children: order.customer?.email ?? "—" },
              {
                key: "phone",
                label: "Số điện thoại",
                children: order.customer?.phone ?? "—",
              },
              {
                key: "createdAt",
                label: "Thời gian đặt",
                children: formatDateTime(order.createdAt),
              },
              {
                key: "recipient",
                label: "Người nhận",
                children: address?.recipientName ?? "—",
              },
              {
                key: "recipientPhone",
                label: "SĐT người nhận",
                children: address?.phone ?? "—",
              },
              {
                key: "address",
                label: "Địa chỉ giao",
                span: 2,
                children: address ? formatAddress(address) : "—",
              },
              {
                key: "note",
                label: "Ghi chú giao hàng",
                span: 2,
                children: order.note ?? "—",
              },
            ]}
          />
        </DetailCard>
      </Col>
      <Col xs={24} lg={10}>
        <DetailCard title="Giá trị đơn hàng">
          <InfoDescriptions
            column={1}
            items={[
              { key: "subtotal", label: "Tạm tính", children: formatMoney(order.subtotal) },
              {
                key: "discount",
                label: "Giảm giá",
                children: formatMoney(order.discountTotal),
              },
              {
                key: "shipping",
                label: "Phí giao hàng",
                children: formatMoney(order.shippingFee),
              },
              {
                key: "grandTotal",
                label: "Tổng thanh toán",
                children: <strong>{formatMoney(order.grandTotal)}</strong>,
              },
            ]}
          />
        </DetailCard>
        <div style={{ height: 16 }} />
        <DetailCard title="Voucher đã dùng">
          {order.voucherRedemptions && order.voucherRedemptions.length > 0 ? (
            <Row gutter={[12, 12]}>
              {order.voucherRedemptions.map((v) => (
                <Col key={v.id} xs={24} sm={12}>
                  <div className="agri-muted" style={{ fontSize: 12 }}>
                    Voucher {v.voucher?.code ?? `#${v.voucherId}`}
                  </div>
                  <div style={{ fontWeight: 600 }}>−{formatMoney(v.discountAmount)}</div>
                </Col>
              ))}
            </Row>
          ) : (
            <SectionEmpty text="Đơn hàng không dùng voucher." />
          )}
        </DetailCard>
      </Col>
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Sản phẩm & đối tác
// ---------------------------------------------------------------------------
