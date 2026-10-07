"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Checkbox, Form, Input, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { useListState } from "@/hooks/useListState";
import { useClientList } from "@/hooks/useClientList";
import { useAction } from "@/hooks/useAction";
import { useLotOptions } from "@/hooks/useOptions";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime } from "@/lib/format";
import { QC_RESULT, qcResult, lotStatus, statusOptions } from "@/lib/status";
import type { QcInspection } from "@/types/api";

// /qc only whitelists page/limit/search/status, so the lot filter is applied
// in the browser.
const qcFilter = (row: QcInspection, filters: Record<string, string | undefined>) => {
  if (filters.productLotId && String(row.productLotId) !== filters.productLotId) return false;
  return true;
};

export default function QualityControlPage() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const lots = useLotOptions();

  const { data, total, isLoading, isError, refetch } = useClientList<QcInspection>({
    queryKey: queryKeys.qc({ scope: "admin-list" }),
    fetcher: resources.qc,
    state: list,
    filter: qcFilter,
  });

  const inspect = useAction(
    (values: {
      productLotId: number;
      result: string;
      appearancePassed: boolean;
      freshnessPassed: boolean;
      damagePassed: boolean;
      packagingPassed?: boolean;
      note?: string;
    }) => resources.createQc(values),
    {
      invalidate: [["qc"], ["lots"]],
      successMessage: "Đã ghi nhận kết quả kiểm định.",
      onSuccess: () => {
        setOpen(false);
        form.resetFields();
      },
    },
  );

  const columns: ColumnsType<QcInspection> = [
    {
      title: "Lô hàng",
      render: (_, row) => (
        <Link href={`/lots/${row.productLotId}`} className="agri-link">
          {row.productLot?.code ?? `#${row.productLotId}`}
        </Link>
      ),
    },
    {
      title: "Kết quả",
      dataIndex: "result",
      render: (r: string) => <StatusTag status={qcResult(r)} />,
    },
    {
      title: "Trạng thái lô",
      render: (_, row) =>
        row.productLot ? <StatusTag status={lotStatus(row.productLot.status)} /> : "—",
    },
    {
      title: "Tiêu chí",
      render: (_, row) => {
        const items = [
          ["Ngoại hình", row.appearancePassed],
          ["Độ tươi", row.freshnessPassed],
          ["Hư hỏng", row.damagePassed],
        ] as const;
        return (
          <span style={{ fontSize: 12 }} className="agri-muted">
            {items.map(([label, ok]) => `${label}: ${ok ? "Đạt" : "Không"}`).join(" · ")}
            {row.packagingPassed !== null ? ` · Đóng gói: ${row.packagingPassed ? "Đạt" : "Không"}` : ""}
          </span>
        );
      },
    },
    {
      title: "Người kiểm định",
      render: (_, row) => row.inspectorUser?.fullName ?? "—",
    },
    {
      title: "Thời điểm",
      dataIndex: "inspectedAt",
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
  ];

  return (
    <>
      <ListPage<QcInspection>
        title="Kiểm định chất lượng"
        subtitle="Ghi nhận kết quả kiểm định lô hàng"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        filters={[
          {
            key: "productLotId",
            placeholder: "Lô hàng",
            value: list.filters.productLotId,
            options: (lots.data ?? []).map((o) => ({ label: o.label, value: String(o.value) })),
            width: 240,
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Kiểm định lô
          </Button>
        }
        columns={columns}
        data={data}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách kiểm định.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Chưa có phiếu kiểm định"
        total={total}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1040}
        itemLabel="phiếu"
      />

      <FormModal
        open={open}
        title="Kiểm định lô hàng"
        form={form}
        onCancel={() => setOpen(false)}
        onSubmit={(values) => inspect.mutate(values as Parameters<typeof inspect.mutate>[0])}
        submitting={inspect.isPending}
        width={560}
        okText="Ghi nhận"
      >
        <Form.Item label="Lô hàng" name="productLotId" rules={[{ required: true, message: "Chọn lô hàng." }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={lots.isLoading}
            options={lots.data}
            placeholder="Chọn lô cần kiểm định"
          />
        </Form.Item>
        <Form.Item label="Kết quả" name="result" rules={[{ required: true, message: "Chọn kết quả." }]}>
          <Select options={statusOptions(QC_RESULT)} placeholder="Chọn kết quả" />
        </Form.Item>
        <Form.Item name="appearancePassed" valuePropName="checked" initialValue={false}>
          <Checkbox>Ngoại hình đạt</Checkbox>
        </Form.Item>
        <Form.Item name="freshnessPassed" valuePropName="checked" initialValue={false}>
          <Checkbox>Độ tươi đạt</Checkbox>
        </Form.Item>
        <Form.Item name="damagePassed" valuePropName="checked" initialValue={false}>
          <Checkbox>Không hư hỏng</Checkbox>
        </Form.Item>
        <Form.Item name="packagingPassed" valuePropName="checked" initialValue={false}>
          <Checkbox>Đóng gói đạt</Checkbox>
        </Form.Item>
        <Form.Item label="Ghi chú" name="note">
          <Input.TextArea rows={3} />
        </Form.Item>
      </FormModal>
    </>
  );
}
