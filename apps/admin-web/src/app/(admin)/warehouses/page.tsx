"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Form, Input, Select } from "antd";
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
import { formatDateTime } from "@/lib/format";
import { RECORD_STATUS, recordStatus, statusOptions } from "@/lib/status";
import type { Warehouse } from "@/types/api";

export default function WarehousesPage() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading, isError, refetch } = useListQuery<Warehouse>(
    queryKeys.warehouses(list.params),
    resources.warehouses,
    list.params,
  );

  const save = useAction(
    (values: { name: string; address: string; status: string }) =>
      editing
        ? resources.updateWarehouse(editing.id, values)
        : resources.createWarehouse(values),
    {
      invalidate: [["warehouses"]],
      successMessage: "Đã lưu kho.",
      onSuccess: () => {
        setOpen(false);
        setEditing(null);
        form.resetFields();
      },
    },
  );

  const toggleStatus = useAction(
    (row: Warehouse) =>
      resources.updateWarehouse(row.id, {
        status: row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      }),
    {
      invalidate: [["warehouses"]],
      successMessage: "Đã cập nhật trạng thái kho.",
    },
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: "ACTIVE" });
    setOpen(true);
  };

  const openEdit = (row: Warehouse) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({ name: row.name, address: row.address, status: row.status });
    setOpen(true);
  };

  const columns: ColumnsType<Warehouse> = [
    {
      title: "Kho",
      render: (_, row) => (
        <div>
          <div>{row.name}</div>
          <div className="agri-muted agri-mono" style={{ fontSize: 12 }}>
            {row.code}
          </div>
        </div>
      ),
    },
    { title: "Địa chỉ", dataIndex: "address", ellipsis: true },
    {
      title: "Trạng thái",
      dataIndex: "status",
      width: 160,
      render: (s: string) => <StatusTag status={recordStatus(s)} />,
    },
    {
      title: "Cập nhật",
      dataIndex: "updatedAt",
      width: 170,
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
    {
      title: "Thao tác",
      width: 220,
      fixed: "right",
      render: (_, row) => (
        <span style={{ display: "inline-flex", gap: 4 }}>
          <Button type="link" size="small" onClick={() => openEdit(row)} style={{ paddingInline: 0 }}>
            Sửa
          </Button>
          <Button
            type="link"
            size="small"
            loading={toggleStatus.isPending && toggleStatus.variables?.id === row.id}
            onClick={() => toggleStatus.mutate(row)}
            title={
              row.status === "ACTIVE"
                ? "Ngừng hoạt động: bị từ chối khi còn tồn, giữ chỗ hoặc phiếu nháp"
                : "Kích hoạt lại kho"
            }
          >
            {row.status === "ACTIVE" ? "Ngừng hoạt động" : "Kích hoạt"}
          </Button>
          <Link href={`/inventory?warehouseId=${row.id}`} className="agri-link" style={{ fontSize: 13 }}>
            Xem tồn
          </Link>
        </span>
      ),
    },
  ];

  return (
    <>
      <ListPage<Warehouse>
        title="Kho hàng"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Thêm kho
          </Button>
        }
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách kho.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có kho"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={980}
        itemLabel="kho"
      />

      <FormModal
        open={open}
        title={editing ? "Chỉnh sửa kho" : "Thêm kho"}
        form={form}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        onSubmit={(values) => save.mutate(values as { name: string; address: string; status: string })}
        submitting={save.isPending}
      >
        <Form.Item label="Tên kho" name="name" rules={[{ required: true, message: "Nhập tên kho." }]}>
          <Input placeholder="VD: Kho trung tâm Hưng Yên" />
        </Form.Item>
        <Form.Item
          label="Địa chỉ"
          name="address"
          rules={[{ required: true, message: "Nhập địa chỉ kho." }]}
        >
          <Input placeholder="VD: KCN Phố Nối A, Văn Lâm, Hưng Yên" />
        </Form.Item>
        <Form.Item label="Trạng thái" name="status" initialValue="ACTIVE">
          <Select options={statusOptions(RECORD_STATUS)} />
        </Form.Item>
        <p className="agri-muted" style={{ margin: 0, fontSize: 12 }}>
          Mã kho do hệ thống tự sinh và không thay đổi. Ngừng hoạt động bị từ chối khi kho còn
          tồn, giữ chỗ, hàng cách ly, phiếu nháp hoặc đơn chưa kết thúc.
        </p>
      </FormModal>
    </>
  );
}
