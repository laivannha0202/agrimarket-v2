"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Form, Input, InputNumber, Select, Tabs } from "antd";
import { PlusOutlined, SwapOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { useListState } from "@/hooks/useListState";
import { useClientList } from "@/hooks/useClientList";
import { useAction } from "@/hooks/useAction";
import { useLotOptions, useVariantOptions, useWarehouseOptions } from "@/hooks/useOptions";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { toNumeric } from "@/lib/format/form";
import { lotStatus, inventoryMovementType } from "@/lib/status";
import type { InventoryBalance, InventoryMovement } from "@/types/api";

// /inventory and /inventory/movements only whitelist page/limit/search/status,
// so their filters are applied in the browser.
const balanceFilter = (b: InventoryBalance, filters: Record<string, string | undefined>) => {
  if (filters.warehouseId && String(b.warehouseId) !== filters.warehouseId) return false;
  if (filters.productVariantId && String(b.productVariantId) !== filters.productVariantId) return false;
  return true;
};

const movementFilter = (m: InventoryMovement, filters: Record<string, string | undefined>) => {
  if (filters.productLotId && String(m.productLotId) !== filters.productLotId) return false;
  return true;
};

function BalancesTab() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"inbound" | "adjust">("inbound");
  const [form] = Form.useForm();
  const warehouses = useWarehouseOptions();
  const lots = useLotOptions();
  const variants = useVariantOptions();

  const { data, total, isLoading, isError, refetch } = useClientList<InventoryBalance>({
    queryKey: queryKeys.inventory({ scope: "admin-list" }),
    fetcher: resources.inventory,
    state: list,
    filter: balanceFilter,
  });

  const submit = useAction(
    (vars: { mode: "inbound" | "adjust"; values: Record<string, unknown> }) => {
      const body = toNumeric(vars.values, [
        "warehouseId",
        "productLotId",
        "productVariantId",
        "quantity",
        "quantityDelta",
      ]);
      return vars.mode === "inbound"
        ? resources.inboundInventory(body)
        : resources.adjustInventory(body);
    },
    {
      invalidate: [["inventory"], ["movements"]],
      successMessage: "Đã cập nhật tồn kho.",
      onSuccess: () => {
        setOpen(false);
        form.resetFields();
      },
    },
  );

  const openDialog = (next: "inbound" | "adjust") => {
    setMode(next);
    form.resetFields();
    setOpen(true);
  };

  const columns: ColumnsType<InventoryBalance> = [
    { title: "Kho", render: (_, row) => row.warehouse?.name ?? "—" },
    {
      title: "Lô hàng",
      render: (_, row) => (
        <div>
          <Link href={`/lots/${row.productLotId}`} className="agri-link">
            {row.productLot?.code ?? `#${row.productLotId}`}
          </Link>
          {row.productLot ? (
            <div style={{ marginTop: 2 }}>
              <StatusTag status={lotStatus(row.productLot.status)} />
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: "Biến thể",
      render: (_, row) => (
        <div>
          <div>{row.productVariant?.name ?? "—"}</div>
          <div className="agri-muted agri-mono" style={{ fontSize: 12 }}>
            {row.productVariant?.sku}
          </div>
        </div>
      ),
    },
    {
      title: "Tồn thực tế",
      dataIndex: "onHand",
      align: "right",
      render: (v: string, row) => <span className="agri-nowrap">{formatQuantity(v, row.unit)}</span>,
    },
    {
      title: "Đã giữ",
      dataIndex: "reserved",
      align: "right",
      render: (v: string, row) => <span className="agri-nowrap">{formatQuantity(v, row.unit)}</span>,
    },
    {
      title: "Đã khóa",
      dataIndex: "blocked",
      align: "right",
      render: (v: string, row) => <span className="agri-nowrap">{formatQuantity(v, row.unit)}</span>,
    },
    {
      title: "Khả dụng",
      dataIndex: "available",
      align: "right",
      render: (v: string, row) => (
        <strong className="agri-nowrap">{formatQuantity(v, row.unit)}</strong>
      ),
    },
  ];

  return (
    <>
      <ListPage<InventoryBalance>
        title="Tồn kho"
        subtitle="Số lượng tồn theo kho, lô và biến thể"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        filters={[
          {
            key: "warehouseId",
            placeholder: "Kho",
            value: list.filters.warehouseId,
            options: (warehouses.data ?? []).map((o) => ({ label: o.label, value: String(o.value) })),
            width: 220,
          },
          {
            key: "productVariantId",
            placeholder: "Biến thể",
            value: list.filters.productVariantId,
            options: (variants.data ?? []).map((o) => ({ label: o.label, value: String(o.value) })),
            width: 260,
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        toolbarExtra={
          <>
            <Button icon={<SwapOutlined />} onClick={() => openDialog("adjust")}>
              Điều chỉnh
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openDialog("inbound")}>
              Nhập kho
            </Button>
          </>
        }
        columns={columns}
        data={data}
        loading={isLoading}
        error={isError ? new Error("Không tải được tồn kho.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có dòng tồn kho phù hợp"
        total={total}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1120}
        itemLabel="dòng tồn kho"
      />

      <FormModal
        open={open}
        title={mode === "inbound" ? "Nhập kho" : "Điều chỉnh tồn kho"}
        form={form}
        onCancel={() => setOpen(false)}
        onSubmit={(values) => submit.mutate({ mode, values })}
        submitting={submit.isPending}
        width={560}
        okText={mode === "inbound" ? "Nhập kho" : "Điều chỉnh"}
      >
        <Form.Item label="Kho" name="warehouseId" rules={[{ required: true, message: "Chọn kho." }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={warehouses.isLoading}
            options={warehouses.data}
            placeholder="Chọn kho"
          />
        </Form.Item>
        <Form.Item label="Lô hàng" name="productLotId" rules={[{ required: true, message: "Chọn lô hàng." }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={lots.isLoading}
            options={lots.data}
            placeholder="Chọn lô hàng"
          />
        </Form.Item>
        <Form.Item label="Biến thể" name="productVariantId" rules={[{ required: true, message: "Chọn biến thể." }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={variants.isLoading}
            options={variants.data}
            placeholder="Chọn biến thể"
          />
        </Form.Item>
        {mode === "inbound" ? (
          <Form.Item
            label="Số lượng nhập"
            name="quantity"
            rules={[{ required: true, message: "Nhập số lượng." }]}
          >
            <InputNumber min={0.001} step={0.5} style={{ width: "100%" }} placeholder="VD: 100" />
          </Form.Item>
        ) : (
          <Form.Item
            label="Chênh lệch (âm để giảm)"
            name="quantityDelta"
            rules={[{ required: true, message: "Nhập chênh lệch." }]}
            extra="Không thể giảm xuống dưới 0 hoặc dưới lượng đã giữ/khóa."
          >
            <InputNumber step={0.5} style={{ width: "100%" }} placeholder="VD: -5" />
          </Form.Item>
        )}
        <Form.Item label="Ghi chú" name="note">
          <Input.TextArea rows={2} />
        </Form.Item>
      </FormModal>
    </>
  );
}

function MovementsTab() {
  const list = useListState();
  const lots = useLotOptions();

  const { data, total, isLoading, isError, refetch } = useClientList<InventoryMovement>({
    queryKey: queryKeys.movements({ scope: "admin-list" }),
    fetcher: resources.movements,
    state: list,
    filter: movementFilter,
  });

  const columns: ColumnsType<InventoryMovement> = [
    {
      title: "Lô hàng",
      render: (_, row) => (
        <Link href={`/lots/${row.productLotId}`} className="agri-link agri-mono">
          {row.productLot?.code ?? `#${row.productLotId}`}
        </Link>
      ),
    },
    {
      title: "Loại",
      dataIndex: "type",
      render: (t: string) => <StatusTag status={inventoryMovementType(t)} />,
    },
    {
      title: "Thay đổi",
      dataIndex: "quantityDelta",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatQuantity(v)}</span>,
    },
    {
      title: "Trước",
      dataIndex: "beforeQuantity",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatQuantity(v)}</span>,
    },
    {
      title: "Sau",
      dataIndex: "afterQuantity",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatQuantity(v)}</span>,
    },
    { title: "Ghi chú", dataIndex: "note", render: (v: string | null) => v ?? "—", ellipsis: true },
    {
      title: "Thời điểm",
      dataIndex: "createdAt",
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
  ];

  return (
    <ListPage<InventoryMovement>
      title="Biến động kho"
      subtitle="Lịch sử nhập, xuất và điều chỉnh tồn kho"
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
      columns={columns}
      data={data}
      loading={isLoading}
      error={isError ? new Error("Không tải được biến động kho.") : undefined}
      onRetry={() => void refetch()}
      emptyText="Không có biến động kho"
      total={total}
      page={list.page}
      limit={list.limit}
      onPageChange={list.setPage}
      onLimitChange={list.setLimit}
      scrollX={1080}
      itemLabel="biến động"
    />
  );
}

export default function InventoryPage() {
  return (
    <Tabs
      defaultActiveKey="balances"
      items={[
        { key: "balances", label: "Tồn kho", children: <BalancesTab /> },
        { key: "movements", label: "Biến động kho", children: <MovementsTab /> },
      ]}
    />
  );
}
