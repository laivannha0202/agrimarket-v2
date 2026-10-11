"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Form } from "antd";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { PartnerFormFields } from "@/components/partner/PartnerFormFields";
import { useListState } from "@/hooks/useListState";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { recordStatus } from "@/lib/status";
import type { Partner } from "@/types/api";

export default function PartnersPage() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading, isError, refetch } = useListQuery<Partner>(
    queryKeys.partners(list.params),
    resources.partners,
    list.params,
  );

  const save = useAction(
    (values: Record<string, unknown>) =>
      editing ? resources.updatePartner(editing.id, values) : resources.createPartner(values),
    {
      invalidate: [["partners"]],
      successMessage: "Đã lưu đối tác.",
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
    setOpen(true);
  };

  const openEdit = (row: Partner) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue(row);
    setOpen(true);
  };

  const columns: ColumnsType<Partner> = [
    {
      title: "Đối tác",
      render: (_, row) => (
        <div>
          <Link href={`/partners/${row.id}`} className="agri-link">
            {row.name}
          </Link>
          <div className="agri-muted agri-mono" style={{ fontSize: 12 }}>
            {row.code}
          </div>
        </div>
      ),
    },
    { title: "Người đại diện", dataIndex: "representativeName" },
    { title: "Điện thoại", dataIndex: "phone" },
    { title: "Email", dataIndex: "email" },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={recordStatus(s)} />,
    },
    {
      title: "Thao tác",
      width: 90,
      fixed: "right",
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          icon={<EditOutlined />}
          style={{ paddingInline: 0 }}
          onClick={() => openEdit(row)}
        >
          Sửa
        </Button>
      ),
    },
  ];

  return (
    <>
      <ListPage<Partner>
        title="Đối tác bán hàng"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Tìm theo tên, mã, người đại diện..."
        onReset={list.reset}
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Thêm đối tác
          </Button>
        }
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách đối tác.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có đối tác phù hợp"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1040}
        itemLabel="đối tác"
      />

      <FormModal
        open={open}
        title={editing ? "Chỉnh sửa đối tác" : "Thêm đối tác"}
        form={form}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        onSubmit={(values) => save.mutate(values as Record<string, unknown>)}
        submitting={save.isPending}
        width={640}
      >
        <PartnerFormFields />
      </FormModal>
    </>
  );
}
