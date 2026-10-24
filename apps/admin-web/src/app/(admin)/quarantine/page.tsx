"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Form, Input, Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { useListState } from "@/hooks/useListState";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime, formatQuantity } from "@/lib/format";
import {
  quarantineSource,
  quarantineStatus,
  statusOptions,
  QUARANTINE_STATUS,
  QC_RESULT,
} from "@/lib/status";
import type { QuarantineCase } from "@/types/api";

type ResolveTarget = { row: QuarantineCase; action: "RELEASE" | "SCRAP" } | null;

export default function QuarantinePage() {
  const list = useListState();
  const [inspectTarget, setInspectTarget] = useState<QuarantineCase | null>(null);
  const [resolveTarget, setResolveTarget] = useState<ResolveTarget>(null);
  const [inspectForm] = Form.useForm();
  const [resolveForm] = Form.useForm();

  const { data, isLoading, isError, refetch } = useListQuery<QuarantineCase>(
    queryKeys.quarantineCases(list.params),
    resources.quarantineCases,
    list.params,
  );

  const inspect = useAction(
    (vars: { id: number; result: string; note?: string }) =>
      resources.inspectQuarantine(vars.id, { result: vars.result, note: vars.note }),
    {
      invalidate: [["quarantine-cases"], ["inventory"], ["movements"]],
      successMessage: "Đã ghi nhận kết quả kiểm định.",
      onSuccess: () => {
        setInspectTarget(null);
        inspectForm.resetFields();
      },
    },
  );

  const resolve = useAction(
    (vars: { id: number; action: "RELEASE" | "SCRAP"; note?: string }) =>
      resources.resolveQuarantine(vars.id, { action: vars.action, note: vars.note }),
    {
      invalidate: [
        ["quarantine-cases"],
        ["inventory"],
        ["movements"],
        ["lots"],
        ["returns"],
      ],
      successMessage: "Đã xử lý hàng cách ly.",
      onSuccess: () => {
        setResolveTarget(null);
        resolveForm.resetFields();
      },
    },
  );

  const inspectResult = Form.useWatch("result", inspectForm);

  const columns: ColumnsType<QuarantineCase> = [
    {
      title: "Mã",
      dataIndex: "code",
      width: 150,
      render: (code: string) => <span className="agri-mono agri-nowrap">{code}</span>,
    },
    {
      title: "Lô / SKU",
      render: (_, row) => (
        <div>
          <Link href={`/lots/${row.productLotId}`} className="agri-link agri-mono">
            {row.productLot?.code ?? `#${row.productLotId}`}
          </Link>
          <div className="agri-muted" style={{ fontSize: 12 }}>
            {row.productVariant?.sku ?? `#${row.productVariantId}`}
          </div>
        </div>
      ),
    },
    {
      title: "Kho",
      render: (_, row) => row.warehouse?.name ?? `#${row.warehouseId}`,
    },
    {
      title: "Số lượng",
      dataIndex: "quantity",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatQuantity(v)}</span>,
    },
    {
      title: "Nguồn",
      render: (_, row) => (
        <div>
          <div>
            {row.order ? (
              <Link href={`/orders/${row.order.id}`} className="agri-link agri-nowrap">
                {row.order.code}
              </Link>
            ) : (
              quarantineSource(row.sourceType).label
            )}
          </div>
          {row.returnRequest ? (
            <div className="agri-muted" style={{ fontSize: 12 }}>
              Trả hàng #{row.returnRequest.id} — {row.returnRequest.status}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={quarantineStatus(s)} />,
    },
    {
      title: "Ghi chú",
      render: (_, row) => (
        <div style={{ maxWidth: 240 }}>
          <div>{row.reason ?? "—"}</div>
          {row.inspectionNote ? (
            <div className="agri-muted" style={{ fontSize: 12 }}>
              KQ: {row.inspectionNote}
            </div>
          ) : null}
          {row.resolutionNote ? (
            <div className="agri-muted" style={{ fontSize: 12 }}>
              Xử lý: {row.resolutionNote}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: "Thời gian",
      render: (_, row) => (
        <div className="agri-nowrap" style={{ fontSize: 12 }}>
          <div>Tạo: {formatDateTime(row.createdAt)}</div>
          {row.inspectedAt ? <div>KT: {formatDateTime(row.inspectedAt)}</div> : null}
          {row.resolvedAt ? <div>Xử lý: {formatDateTime(row.resolvedAt)}</div> : null}
        </div>
      ),
    },
    {
      title: "Thao tác",
      width: 120,
      fixed: "right",
      render: (_, row) => {
        if (row.status === "PENDING") {
          return (
            <Button
              type="link"
              size="small"
              style={{ paddingInline: 0 }}
              onClick={() => {
                setInspectTarget(row);
                inspectForm.resetFields();
              }}
            >
              Kiểm định
            </Button>
          );
        }
        if (row.status === "PASSED") {
          return (
            <Button
              type="link"
              size="small"
              style={{ paddingInline: 0 }}
              onClick={() => {
                setResolveTarget({ row, action: "RELEASE" });
                resolveForm.resetFields();
              }}
            >
              Giải phóng
            </Button>
          );
        }
        if (row.status === "FAILED") {
          return (
            <Button
              type="link"
              size="small"
              danger
              style={{ paddingInline: 0 }}
              onClick={() => {
                setResolveTarget({ row, action: "SCRAP" });
                resolveForm.resetFields();
              }}
            >
              Tiêu hủy
            </Button>
          );
        }
        return <span className="agri-muted">Đã kết thúc</span>;
      },
    },
  ];

  const isScrap = resolveTarget?.action === "SCRAP";

  return (
    <>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="Hàng cách ly không được bán cho đến khi có kết quả kiểm định và quyết định xử lý."
        description="Kiểm định chỉ ghi kết quả Đạt/Không đạt. Sau đó phải chọn Giải phóng (hàng Đạt quay lại bán được) hoặc Tiêu hủy (hàng Không đạt bị trừ tồn và số lượng lô). Không có bước nào tự động giải phóng hàng."
      />

      <ListPage<QuarantineCase>
        title="Hàng cách ly"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        filters={[
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(QUARANTINE_STATUS),
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách hàng cách ly.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có hàng cách ly"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1280}
        itemLabel="trường hợp"
      />

      <FormModal
        open={!!inspectTarget}
        title="Kiểm định hàng cách ly"
        form={inspectForm}
        onCancel={() => {
          setInspectTarget(null);
          inspectForm.resetFields();
        }}
        onSubmit={(values) => {
          if (!inspectTarget) return;
          inspect.mutate({
            id: inspectTarget.id,
            result: String(values.result),
            note: String(values.note ?? "").trim() || undefined,
          });
        }}
        submitting={inspect.isPending}
        okText="Lưu kết quả"
      >
        {inspectTarget ? (
          <p style={{ marginTop: 0 }}>
            <strong>{inspectTarget.code}</strong> — {formatQuantity(inspectTarget.quantity)}{" "}
            {inspectTarget.productVariant?.name ?? ""}
          </p>
        ) : null}
        <Form.Item
          label="Kết quả kiểm định"
          name="result"
          rules={[{ required: true, message: "Chọn kết quả." }]}
        >
          <Select
            placeholder="Chọn kết quả"
            options={[
              { value: "PASS", label: QC_RESULT.PASS.label },
              { value: "FAIL", label: QC_RESULT.FAIL.label },
            ]}
          />
        </Form.Item>
        <Form.Item
          label="Ghi chú / lý do"
          name="note"
          rules={
            inspectResult === "FAIL"
              ? [{ required: true, message: "Hàng không đạt phải ghi rõ lý do." }]
              : []
          }
        >
          <Input.TextArea rows={3} placeholder="VD: Dập nát 30%, không đạt tiêu chuẩn" />
        </Form.Item>
        <p className="agri-muted" style={{ margin: 0 }}>
          Lưu kết quả chưa làm thay đổi tồn kho. Hàng vẫn bị chặn cho đến khi bạn
          chọn Giải phóng hoặc Tiêu hủy.
        </p>
      </FormModal>

      <FormModal
        open={!!resolveTarget}
        title={isScrap ? "Tiêu hủy hàng cách ly" : "Giải phóng hàng cách ly"}
        form={resolveForm}
        onCancel={() => {
          setResolveTarget(null);
          resolveForm.resetFields();
        }}
        onSubmit={(values) => {
          if (!resolveTarget) return;
          resolve.mutate({
            id: resolveTarget.row.id,
            action: resolveTarget.action,
            note: String(values.note ?? "").trim() || undefined,
          });
        }}
        submitting={resolve.isPending}
        okText={isScrap ? "Xác nhận tiêu hủy" : "Xác nhận giải phóng"}
      >
        {resolveTarget ? (
          <Alert
            type={isScrap ? "error" : "success"}
            showIcon
            style={{ marginBottom: 12 }}
            message={
              isScrap
                ? `Tiêu hủy ${formatQuantity(resolveTarget.row.quantity)} — trừ tồn thực tế và số lượng còn lại của lô.`
                : `Giải phóng ${formatQuantity(resolveTarget.row.quantity)} về trạng thái có thể bán.`
            }
          />
        ) : null}
        <Form.Item label="Ghi chú xử lý" name="note">
          <Input.TextArea rows={3} placeholder="VD: Đã tiêu hủy theo biên bản 23/10" />
        </Form.Item>
      </FormModal>
    </>
  );
}
