"use client";

/**
 * Admin order detail.
 *
 * Layout: a header with the identity of the order and the actions that change
 * it, a one-glance money summary, then five tabs — Tổng quan, Sản phẩm,
 * Thanh toán, Vận chuyển, Tài chính nội bộ. The old page stacked every table
 * into one column, which made a multi-partner order unreadable and hid the
 * settlement trail entirely.
 *
 * The page performs no pricing arithmetic of its own: totals come from the
 * order snapshot and the payment/refund rows the backend stored. The only
 * derived values are the explicit "collected / refunded / outstanding" sums in
 * the summary, and they are labelled as such.
 *
 * PDF: "Xem trước" fetches the backend-rendered PDF (never a separate HTML
 * mock), shows it in an iframe, and offers download/print from the same bytes.
 * "Tải" saves the same file. Both requests carry the admin token; the token is
 * never placed in a URL.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  App,
  Button,
  Col,
  Dropdown,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Tabs,
  Tag,
  Typography,
  type MenuProps,
} from "antd";
import { DetailPage } from "@/components/common/DetailPage";
import { StatusTag } from "@/components/common/StatusTag";
import {
  OrderFinanceTab,
  OrderItemsTab,
  OrderOverviewTab,
  OrderPaymentTab,
  OrderShippingTab,
  summarizePayments,
} from "@/components/orders/OrderDetailTabs";
import { useDetailQuery } from "@/hooks/useDetailQuery";
import { useAction } from "@/hooks/useAction";
import { useExportDownload } from "@/hooks/useExportDownload";
import { useAuth } from "@/lib/auth/auth-provider";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime, formatMoney } from "@/lib/format";
import { orderStatus } from "@/lib/status";
import type { Order, Payment } from "@/types/api";

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
  SHIPPING: [{ value: "DELIVERED", label: "Đã giao" }],
  DELIVERED: [],
  CANCELLED: [],
};

interface PreviewState {
  url: string;
  title: string;
  filename: string;
}

/** Tab keys the page can open; anything else falls back to the overview. */
const TAB_KEYS = ["overview", "items", "payment", "shipping", "finance"] as const;

export default function OrderDetailPage() {
  // `useSearchParams` opts this page into a Suspense boundary at build time;
  // the wrapper below is that boundary.
  return (
    <Suspense fallback={null}>
      <OrderDetailView />
    </Suspense>
  );
}

function OrderDetailView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { message } = App.useApp();
  const { user } = useAuth();
  const canAct = user?.role === "ADMIN";
  const [pending, setPending] = useState(false);

  /**
   * The tab lives in the URL, so another screen can deep-link straight to the
   * payment trail (`/orders/123?tab=payment`) and a copied link reopens the
   * same view. An unknown key falls back to the overview instead of opening an
   * empty tab.
   */
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab =
    requestedTab && (TAB_KEYS as readonly string[]).includes(requestedTab)
      ? requestedTab
      : "overview";
  const setTab = (key: string) => {
    router.replace(`/orders/${id}?tab=${key}`, { scroll: false });
  };

  const { data: order, isLoading, isError, refetch } = useDetailQuery<Order>(
    queryKeys.order(id),
    () => resources.order(id),
  );

  // Two independent instances so each button owns its own loading state.
  const orderPdf = useExportDownload();
  const packingSlip = useExportDownload();

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewing, setPreviewing] = useState<null | "order" | "packing">(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // Revoke the previous blob URL when it is replaced or the page unmounts.
  useEffect(() => {
    const url = preview?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview]);

  const openPreview = async (kind: "order" | "packing") => {
    setPreviewing(kind);
    try {
      const { blob, filename } =
        kind === "order"
          ? await resources.orderPdf(id)
          : await resources.packingSlip(id);
      setPreview({
        url: URL.createObjectURL(blob),
        title:
          kind === "order" ? "Phiếu xác nhận đơn hàng" : "Phiếu soạn hàng (nội bộ)",
        filename,
      });
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Không tạo được bản xem trước PDF.",
      );
    } finally {
      setPreviewing(null);
    }
  };

  const closePreview = () => {
    setPreview(null);
  };

  const printPreview = () => {
    const frame = frameRef.current;
    try {
      frame?.contentWindow?.focus();
      frame?.contentWindow?.print();
    } catch {
      // A browser that refuses to script its PDF plugin still lets the user
      // print from the viewer's own toolbar; opening a tab is the fallback.
      if (preview) window.open(preview.url, "_blank", "noopener,noreferrer");
    }
  };

  const downloadOrderPdf = () => orderPdf.download("pdf", () => resources.orderPdf(id));
  const downloadPackingSlip = () =>
    packingSlip.download("pdf", () => resources.packingSlip(id));

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
   * action that marks a COD payment PAID — moving the order to DELIVERED does
   * not, because a delivered parcel does not prove collection. The backend
   * requires a transaction reference (courier receipt / gateway reference), so
   * the operator must type it in the dialog; without it the API answers 400 and
   * nothing is marked PAID.
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

  const transitions = order ? NEXT_STATUS[order.status] ?? [] : [];
  const menuItems: MenuProps["items"] = transitions.map((t) => ({
    key: t.value,
    label: t.label,
    danger: t.value === "CANCELLED",
  }));
  const summary = order ? summarizePayments(order) : null;

  return (
    <DetailPage
      title={order ? `Đơn hàng ${order.code}` : "Chi tiết đơn hàng"}
      subtitle={
        order ? (
          // The status belongs to the order's identity, not to the action row:
          // sitting between "Xem trước" and "Tải PDF" it read like a button.
          <span className="agri-detail-subtitle">
            <StatusTag status={orderStatus(order.status)} />
            <span>Tạo lúc {formatDateTime(order.createdAt)}</span>
          </span>
        ) : undefined
      }
      backHref="/orders"
      backLabel="Danh sách đơn hàng"
      loading={isLoading}
      error={isError ? new Error("Không tải được đơn hàng.") : undefined}
      onRetry={() => void refetch()}
      extra={
        order ? (
          <Space size={8} wrap>
            <Button
              onClick={() => void openPreview("order")}
              loading={previewing === "order"}
            >
              Xem trước phiếu
            </Button>
            <Button
              onClick={() => void openPreview("packing")}
              loading={previewing === "packing"}
            >
              Xem trước soạn hàng
            </Button>
            <Button onClick={downloadOrderPdf} loading={orderPdf.downloading === "pdf"}>
              Tải phiếu PDF
            </Button>
            <Button onClick={downloadPackingSlip} loading={packingSlip.downloading === "pdf"}>
              Tải phiếu soạn hàng
            </Button>
            {transitions.length > 0 ? (
              <Dropdown
                menu={{
                  items: menuItems,
                  onClick: ({ key }) => {
                    setPending(true);
                    updateStatus.mutate(key);
                  },
                  disabled: !canAct,
                }}
                disabled={!canAct}
              >
                <Button type="primary" loading={updateStatus.isPending || pending}>
                  Chuyển trạng thái
                </Button>
              </Dropdown>
            ) : (
              <Tag>Đã kết thúc</Tag>
            )}
          </Space>
        ) : undefined
      }
    >
      {order ? (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            {[
              { label: "Tổng thanh toán", value: formatMoney(order.grandTotal) },
              { label: "Đã thu", value: formatMoney(summary?.collected ?? 0) },
              { label: "Còn phải thu", value: formatMoney(summary?.outstanding ?? 0) },
              { label: "Đã hoàn tiền", value: formatMoney(summary?.refunded ?? 0) },
            ].map((item) => (
              <Col key={item.label} xs={12} lg={6}>
                <div className="agri-card" style={{ padding: "12px 16px" }}>
                  <div className="agri-muted" style={{ fontSize: 12 }}>
                    {item.label}
                  </div>
                  <div className="agri-stat-value">{item.value}</div>
                </div>
              </Col>
            ))}
          </Row>

          <Tabs
            activeKey={tab}
            onChange={setTab}
            destroyOnHidden={false}
            items={[
              {
                key: "overview",
                label: "Tổng quan",
                children: <OrderOverviewTab order={order} />,
              },
              {
                key: "items",
                label: `Sản phẩm (${order.partnerOrders?.length ?? 0} đối tác)`,
                children: <OrderItemsTab order={order} />,
              },
              {
                key: "payment",
                label: "Thanh toán",
                children: (
                  <OrderPaymentTab
                    order={order}
                    collecting={confirmCollection.isPending}
                    onCollect={(payment) => {
                      setCollectTarget(payment);
                      collectForm.setFieldsValue({ transactionReference: "" });
                    }}
                  />
                ),
              },
              {
                key: "shipping",
                label: "Vận chuyển",
                children: <OrderShippingTab order={order} />,
              },
              {
                key: "finance",
                label: "Tài chính nội bộ",
                children: <OrderFinanceTab order={order} />,
              },
            ]}
          />

          <Modal
            open={!!preview}
            title={preview?.title}
            onCancel={closePreview}
            width={880}
            style={{ top: 24 }}
            // A closed antd Modal keeps its children mounted. The PDF iframe
            // stayed in the layer and intercepted pointer events during the
            // close animation, so "Tải phiếu PDF" was unclickable right after
            // closing the preview. Unmounting also releases the blob URL.
            destroyOnHidden
            footer={
              <Space>
                <Button onClick={closePreview}>Đóng</Button>
                <Button onClick={printPreview}>In phiếu</Button>
                <Button
                  type="primary"
                  onClick={() => {
                    if (!preview) return;
                    const a = document.createElement("a");
                    a.href = preview.url;
                    a.download = preview.filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  }}
                >
                  Tải xuống
                </Button>
              </Space>
            }
          >
            {preview ? (
              <iframe
                ref={frameRef}
                src={preview.url}
                title={preview.title}
                style={{ width: "100%", height: "70vh", border: "1px solid #eee", borderRadius: 6 }}
              />
            ) : null}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Bản xem trước là chính tệp PDF do máy chủ tạo, không phải bản HTML khác.
            </Typography.Text>
          </Modal>

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
        </>
      ) : null}
    </DetailPage>
  );
}
