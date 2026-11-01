"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Alert, Button, Form, Input, Popconfirm } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { useListState } from "@/hooks/useListState";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime, formatMoney } from "@/lib/format";
import { idempotencyKeyFor, type IdempotencyStore } from "@/lib/api/idempotency";
import { REFUND_STATUS, refundStatus, statusOptions } from "@/lib/status";
import type { Refund } from "@/types/api";

/** Refunds that still need a decision or a proof of payment. */
type PendingAction = { type: "complete" | "fail"; refund: Refund } | null;

export default function RefundsPage() {
  return (
    <Suspense fallback={null}>
      <RefundsPageContent />
    </Suspense>
  );
}

function RefundsPageContent() {
  const list = useListState();
  const searchParams = useSearchParams();
  const linkedPaymentId = searchParams.get("paymentId");
  const [createOpen, setCreateOpen] = useState(false);
  const [dismissedPaymentId, setDismissedPaymentId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [createForm] = Form.useForm();
  const [actionForm] = Form.useForm();
  const idempotency = useRef<IdempotencyStore>({ current: null });
  const createModalOpen = createOpen || (linkedPaymentId !== null && linkedPaymentId !== dismissedPaymentId);

  // A link from the order detail page preselects the payment. Opening is
  // derived from the query string; the effect only writes the external antd
  // form store (no React state update), so it cannot cascade renders.
  useEffect(() => {
    if (linkedPaymentId) {
      createForm.setFieldsValue({ paymentId: linkedPaymentId });
    }
  }, [linkedPaymentId, createForm]);

  const { data, isLoading, isError, refetch } = useListQuery<Refund>(
    queryKeys.refunds(list.params),
    resources.refunds,
    list.params,
  );

  const create = useAction(
    (vars: { body: Record<string, unknown>; key: string }) =>
      resources.createRefund(vars.body, vars.key),
    {
      invalidate: [["refunds"], ["orders"], ["payments"]],
      successMessage: "Đã tạo yêu cầu hoàn tiền (chờ duyệt).",
      onSuccess: () => {
        idempotency.current.current = null;
        setCreateOpen(false);
        setDismissedPaymentId(linkedPaymentId);
        createForm.resetFields();
      },
    },
  );

  const approve = useAction(
    (id: number) => resources.approveRefund(id),
    {
      invalidate: [["refunds"], ["orders"]],
      successMessage: "Đã duyệt hoàn tiền. Tiền chưa rời quỹ cho đến khi hoàn tất.",
    },
  );

  const finish = useAction(
    (vars: { id: number; type: "complete" | "fail"; value: string }) =>
      vars.type === "complete"
        ? resources.completeRefund(vars.id, vars.value)
        : resources.failRefund(vars.id, vars.value),
    {
      invalidate: [
        ["refunds"],
        ["orders"],
        ["payments"],
        ["settlements"],
        ["payouts"],
        ["reports-summary"],
        ["reports-daily"],
      ],
      successMessage: "Đã cập nhật hoàn tiền.",
      onSuccess: () => {
        setPendingAction(null);
        actionForm.resetFields();
      },
    },
  );

  const columns: ColumnsType<Refund> = [
    {
      title: "Mã",
      dataIndex: "id",
      width: 70,
      render: (id: number) => <span className="agri-mono">#{id}</span>,
    },
    {
      title: "Đơn hàng",
      render: (_, row) =>
        row.payment?.order ? (
          <Link href={`/orders/${row.payment.order.id}`} className="agri-link agri-nowrap">
            {row.payment.order.code}
          </Link>
        ) : (
          "—"
        ),
    },
    {
      title: "Thanh toán",
      render: (_, row) =>
        row.payment ? (
          <div>
            <div>#{row.payment.id} — {row.payment.method}</div>
            <div className="agri-muted" style={{ fontSize: 12 }}>
              {row.payment.status}
            </div>
          </div>
        ) : (
          `#${row.paymentId}`
        ),
    },
    {
      title: "Số tiền",
      dataIndex: "amount",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatMoney(v)}</span>,
    },
    { title: "Lý do", dataIndex: "reason", ellipsis: true },
    {
      title: "Yêu cầu trả hàng",
      render: (_, row) =>
        row.returnRequest ? (
          <Link href="/returns-complaints" className="agri-link agri-nowrap">
            #{row.returnRequest.id} — {row.returnRequest.status}
          </Link>
        ) : (
          "—"
        ),
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={refundStatus(s)} />,
    },
    {
      title: "Chứng từ / lỗi",
      render: (_, row) => (
        <div style={{ maxWidth: 220 }}>
          {row.reference ? <div className="agri-mono">{row.reference}</div> : null}
          {row.failureReason ? (
            <div className="agri-muted" style={{ fontSize: 12 }}>
              {row.failureReason}
            </div>
          ) : null}
          {!row.reference && !row.failureReason ? "—" : null}
        </div>
      ),
    },
    {
      title: "Ngày tạo",
      dataIndex: "createdAt",
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
    {
      title: "Thao tác",
      width: 200,
      fixed: "right",
      render: (_, row) => {
        if (row.status === "PENDING") {
          return (
            <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
              <Popconfirm
                title="Duyệt hoàn tiền?"
                description="Duyệt chỉ là quyết định; tiền chỉ rời quỹ khi Hoàn tất kèm chứng từ."
                okText="Duyệt"
                cancelText="Hủy"
                onConfirm={() => approve.mutate(row.id)}
              >
                <Button type="link" size="small" style={{ paddingInline: 0 }} loading={approve.isPending}>
                  Duyệt
                </Button>
              </Popconfirm>
              <Button
                type="link"
                size="small"
                danger
                style={{ paddingInline: 0 }}
                onClick={() => {
                  setPendingAction({ type: "fail", refund: row });
                  actionForm.resetFields();
                }}
              >
                Từ chối
              </Button>
            </span>
          );
        }
        if (row.status === "APPROVED") {
          return (
            <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
              <Button
                type="link"
                size="small"
                style={{ paddingInline: 0 }}
                onClick={() => {
                  setPendingAction({ type: "complete", refund: row });
                  actionForm.resetFields();
                }}
              >
                Hoàn tất
              </Button>
              <Button
                type="link"
                size="small"
                danger
                style={{ paddingInline: 0 }}
                onClick={() => {
                  setPendingAction({ type: "fail", refund: row });
                  actionForm.resetFields();
                }}
              >
                Từ chối
              </Button>
            </span>
          );
        }
        return <span className="agri-muted">Đã kết thúc</span>;
      },
    },
  ];

  const isComplete = pendingAction?.type === "complete";

  return (
    <>
      <ListPage<Refund>
        title="Hoàn tiền"
        notice={
          <Alert
            type="info"
            showIcon
            title="Hoàn tiền là quy trình 2 bước"
            description="Tạo yêu cầu ở trạng thái Chờ duyệt → Duyệt → Hoàn tất kèm mã chứng từ chuyển tiền. Chỉ bước Hoàn tất mới cập nhật thanh toán và đối soát. Hoàn tiền sau khi đã đối soát sẽ tạo dòng điều chỉnh OPEN và chặn chi trả cho đến khi xử lý."
          />
        }
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        filters={[
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(REFUND_STATUS),
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Tạo hoàn tiền
          </Button>
        }
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách hoàn tiền.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có yêu cầu hoàn tiền"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1280}
        itemLabel="khoản hoàn tiền"
      />

      <FormModal
        open={createModalOpen}
        title="Tạo yêu cầu hoàn tiền"
        form={createForm}
        onCancel={() => {
          setCreateOpen(false);
          setDismissedPaymentId(linkedPaymentId);
          createForm.resetFields();
        }}
        onSubmit={(values) => {
          const body: Record<string, unknown> = {
            paymentId: Number(values.paymentId),
            amount: Number(values.amount),
            reason: String(values.reason ?? "").trim(),
          };
          const returnRequestId = Number(values.returnRequestId);
          if (returnRequestId > 0) body.returnRequestId = returnRequestId;
          const key = idempotencyKeyFor(idempotency.current, body);
          create.mutate({ body, key });
        }}
        submitting={create.isPending}
        width={600}
      >
        <Form.Item
          label="ID thanh toán"
          name="paymentId"
          rules={[{ required: true, message: "Nhập ID thanh toán." }]}
          extra="Mở chi tiết đơn hàng để lấy ID thanh toán (cột Mã thanh toán)."
        >
          <Input type="number" placeholder="VD: 34" />
        </Form.Item>
        <Form.Item
          label="Số tiền hoàn (VND)"
          name="amount"
          rules={[{ required: true, message: "Nhập số tiền." }]}
        >
          <Input type="number" min={1} placeholder="VD: 50000" />
        </Form.Item>
        <Form.Item
          label="Lý do"
          name="reason"
          rules={[{ required: true, message: "Nhập lý do hoàn tiền." }]}
        >
          <Input.TextArea rows={3} placeholder="VD: Hàng dập nát, khách đã gửi ảnh" />
        </Form.Item>
        <Form.Item
          label="ID yêu cầu trả hàng (nếu có)"
          name="returnRequestId"
          extra="Liên kết khoản hoàn với yêu cầu trả hàng để trừ đúng đơn đối tác khi đối soát."
        >
          <Input type="number" placeholder="Tùy chọn" />
        </Form.Item>
      </FormModal>

      <FormModal
        open={!!pendingAction}
        title={isComplete ? "Hoàn tất hoàn tiền" : "Từ chối hoàn tiền"}
        form={actionForm}
        onCancel={() => {
          setPendingAction(null);
          actionForm.resetFields();
        }}
        onSubmit={(values) => {
          if (!pendingAction) return;
          finish.mutate({
            id: pendingAction.refund.id,
            type: pendingAction.type,
            value: String(isComplete ? values.reference : values.failureReason ?? "").trim(),
          });
        }}
        submitting={finish.isPending}
        okText={isComplete ? "Xác nhận đã chuyển tiền" : "Xác nhận từ chối"}
      >
        {pendingAction ? (
          <p style={{ marginTop: 0 }}>
            Hoàn <strong>{formatMoney(pendingAction.refund.amount)}</strong> cho đơn{" "}
            <strong>{pendingAction.refund.payment?.order?.code ?? `#${pendingAction.refund.paymentId}`}</strong>.
          </p>
        ) : null}
        {isComplete ? (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              title="Chỉ nhập mã khi tiền đã thực sự rời quỹ."
            />
            <Form.Item
              label="Mã chứng từ chuyển tiền"
              name="reference"
              rules={[{ required: true, message: "Nhập mã giao dịch ngân hàng." }]}
            >
              <Input placeholder="VD: BANK-TXN-20261023-001" />
            </Form.Item>
          </>
        ) : (
          <Form.Item
            label="Lý do từ chối"
            name="failureReason"
            rules={[{ required: true, message: "Nhập lý do từ chối." }]}
          >
            <Input.TextArea rows={3} placeholder="VD: Sai số tài khoản ngân hàng" />
          </Form.Item>
        )}
      </FormModal>
    </>
  );
}
