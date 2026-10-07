"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Form, Input, Select, Space } from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
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
import { formatDateTime } from "@/lib/format";
import { num } from "@/lib/format/form";
import {
  WAREHOUSE_DOC_STATUS,
  WAREHOUSE_DOC_TYPE,
  statusOptions,
  warehouseDocStatus,
  warehouseDocType,
} from "@/lib/status";
import type { WarehouseDocument } from "@/types/api";

interface DocLine {
  productLotId?: number;
  productVariantId?: number;
  quantity?: number;
  unit?: string;
}

// /warehouse-documents only whitelists page/limit/search/status, so the type
// filter is applied in the browser (status is also handled here for a single
// consistent filter pass).
const docFilter = (d: WarehouseDocument, filters: Record<string, string | undefined>) => {
  if (filters.type && d.type !== filters.type) return false;
  if (filters.status && d.status !== filters.status) return false;
  return true;
};

export default function WarehouseDocumentsPage() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const warehouses = useWarehouseOptions();
  const lots = useLotOptions();
  const variants = useVariantOptions();

  const { data, total, isLoading, isError, refetch } = useClientList<WarehouseDocument>({
    queryKey: queryKeys.warehouseDocuments({ scope: "admin-list" }),
    fetcher: resources.warehouseDocuments,
    state: list,
    filter: docFilter,
  });

  const create = useAction(
    (values: { warehouseId: number; type: string; note?: string; lines: DocLine[] }) => {
      const body = {
        warehouseId: Number(values.warehouseId),
        type: values.type,
        note: values.note,
        lines: values.lines.map((l) => ({
          productLotId: num(l.productLotId),
          productVariantId: num(l.productVariantId),
          quantity: num(l.quantity),
          unit: l.unit,
        })),
      };
      return resources.createWarehouseDocument(body);
    },
    {
      invalidate: [["warehouse-documents"]],
      successMessage: "Đã tạo phiếu kho (nháp).",
      onSuccess: () => {
        setOpen(false);
        form.resetFields();
      },
    },
  );

  const columns: ColumnsType<WarehouseDocument> = [
    {
      title: "Phiếu kho",
      render: (_, row) => (
        <Link href={`/warehouse-documents/${row.id}`} className="agri-link agri-mono">
          {row.code}
        </Link>
      ),
    },
    {
      title: "Loại",
      dataIndex: "type",
      render: (t: string) => <StatusTag status={warehouseDocType(t)} />,
    },
    { title: "Kho", render: (_, row) => row.warehouse?.name ?? "—" },
    {
      title: "Số dòng",
      align: "right",
      width: 90,
      render: (_, row) => row.lines?.length ?? 0,
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={warehouseDocStatus(s)} />,
    },
    {
      title: "Ngày tạo",
      dataIndex: "createdAt",
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
  ];

  return (
    <>
      <ListPage<WarehouseDocument>
        title="Phiếu kho"
        subtitle="Phiếu nhập, xuất và hoàn hàng"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        filters={[
          {
            key: "type",
            placeholder: "Loại phiếu",
            value: list.filters.type,
            options: statusOptions(WAREHOUSE_DOC_TYPE),
            width: 180,
          },
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(WAREHOUSE_DOC_STATUS),
            width: 180,
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Tạo phiếu
          </Button>
        }
        columns={columns}
        data={data}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách phiếu kho.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có phiếu kho phù hợp"
        total={total}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1000}
        itemLabel="phiếu"
      />

      <FormModal
        open={open}
        title="Tạo phiếu kho"
        form={form}
        onCancel={() => setOpen(false)}
        onSubmit={(values) => create.mutate(values as Parameters<typeof create.mutate>[0])}
        submitting={create.isPending}
        width={720}
        okText="Tạo phiếu"
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
        <Form.Item label="Loại phiếu" name="type" rules={[{ required: true, message: "Chọn loại phiếu." }]}>
          <Select options={statusOptions(WAREHOUSE_DOC_TYPE)} placeholder="Chọn loại phiếu" />
        </Form.Item>
        <Form.Item label="Ghi chú" name="note">
          <Input.TextArea rows={2} />
        </Form.Item>

        <Form.List
          name="lines"
          initialValue={[{ quantity: undefined, unit: "" }]}
          rules={[
            {
              validator: async (_, value: DocLine[]) => {
                if (!value || value.length < 1) {
                  throw new Error("Cần ít nhất một dòng hàng.");
                }
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>Dòng hàng</div>
              {fields.map(({ key, name, ...rest }) => (
                <Space key={key} align="baseline" style={{ display: "flex", marginBottom: 8 }} wrap>
                  <Form.Item {...rest} name={[name, "productLotId"]} rules={[{ required: true, message: "Lô" }]}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      loading={lots.isLoading}
                      options={lots.data}
                      placeholder="Lô hàng"
                      style={{ width: 200 }}
                    />
                  </Form.Item>
                  <Form.Item
                    {...rest}
                    name={[name, "productVariantId"]}
                    rules={[{ required: true, message: "Biến thể" }]}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      loading={variants.isLoading}
                      options={variants.data}
                      placeholder="Biến thể"
                      style={{ width: 220 }}
                    />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "quantity"]} rules={[{ required: true, message: "SL" }]}>
                    <Input type="number" placeholder="Số lượng" style={{ width: 110 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "unit"]} rules={[{ required: true, message: "ĐV" }]}>
                    <Input placeholder="Đơn vị" style={{ width: 90 }} />
                  </Form.Item>
                  {fields.length > 1 ? (
                    <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(name)} />
                  ) : null}
                </Space>
              ))}
              <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} block>
                Thêm dòng
              </Button>
              <Form.ErrorList errors={errors} />
            </div>
          )}
        </Form.List>
        <p className="agri-muted" style={{ margin: 0, fontSize: 12 }}>
          Phiếu được tạo ở trạng thái Nháp; tồn kho chỉ thay đổi khi bạn hoàn thành phiếu.
        </p>
      </FormModal>
    </>
  );
}
