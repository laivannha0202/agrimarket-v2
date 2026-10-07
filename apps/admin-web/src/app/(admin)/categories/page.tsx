"use client";

import { useState } from "react";
import { Button, Form, Input, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { useListState } from "@/hooks/useListState";
import { useClientList } from "@/hooks/useClientList";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime } from "@/lib/format";
import { RECORD_STATUS, recordStatus, statusOptions } from "@/lib/status";
import type { Category } from "@/types/api";

// /categories accepts `search` but the backend ignores it, so search and the
// status filter are applied in the browser.
const categorySearchText = (c: Category) => `${c.name} ${c.slug}`;

const categoryFilter = (c: Category, filters: Record<string, string | undefined>) => {
  if (filters.status && c.status !== filters.status) return false;
  return true;
};

export default function CategoriesPage() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form] = Form.useForm();

  const { data, total, isLoading, isError, refetch } = useClientList<Category>({
    queryKey: queryKeys.categories({ scope: "admin-list" }),
    fetcher: resources.categories,
    state: list,
    searchText: categorySearchText,
    filter: categoryFilter,
  });

  const save = useAction(
    (values: { name: string; slug: string; status: string }) =>
      editing ? resources.updateCategory(editing.id, values) : resources.createCategory(values),
    {
      invalidate: [["categories"]],
      successMessage: "Đã lưu danh mục.",
      onSuccess: () => {
        setOpen(false);
        setEditing(null);
        form.resetFields();
      },
    },
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: "ACTIVE" });
    setOpen(true);
  };

  const openEdit = (row: Category) => {
    setEditing(row);
    form.setFieldsValue({ name: row.name, slug: row.slug, status: row.status });
    setOpen(true);
  };

  const columns: ColumnsType<Category> = [
    { title: "Tên danh mục", dataIndex: "name" },
    { title: "Slug", dataIndex: "slug", render: (v: string) => <span className="agri-mono">{v}</span> },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={recordStatus(s)} />,
    },
    {
      title: "Cập nhật",
      dataIndex: "updatedAt",
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
    {
      title: "Thao tác",
      width: 100,
      fixed: "right",
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => openEdit(row)} style={{ paddingInline: 0 }}>
          Sửa
        </Button>
      ),
    },
  ];

  return (
    <>
      <ListPage<Category>
        title="Danh mục"
        subtitle="Nhóm sản phẩm nông sản"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Tìm theo tên, slug..."
        filters={[
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(RECORD_STATUS),
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Thêm danh mục
          </Button>
        }
        columns={columns}
        data={data}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách danh mục.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có danh mục"
        total={total}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        itemLabel="danh mục"
      />

      <FormModal
        open={open}
        title={editing ? "Chỉnh sửa danh mục" : "Thêm danh mục"}
        form={form}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        onSubmit={(values) => save.mutate(values as { name: string; slug: string; status: string })}
        submitting={save.isPending}
      >
        <Form.Item label="Tên danh mục" name="name" rules={[{ required: true, message: "Nhập tên danh mục." }]}>
          <Input placeholder="VD: Rau ăn lá" />
        </Form.Item>
        <Form.Item
          label="Slug"
          name="slug"
          rules={[
            { required: true, message: "Nhập slug." },
            { pattern: /^[a-z0-9-]+$/, message: "Slug chỉ gồm chữ thường, số và dấu gạch ngang." },
          ]}
        >
          <Input placeholder="rau-an-la" />
        </Form.Item>
        <Form.Item label="Trạng thái" name="status" initialValue="ACTIVE">
          <Select options={statusOptions(RECORD_STATUS)} />
        </Form.Item>
      </FormModal>
    </>
  );
}
