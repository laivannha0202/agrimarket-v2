"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Form } from "antd";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { FarmFormFields } from "@/components/farm/FarmFormFields";
import { useListState } from "@/hooks/useListState";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatNumber } from "@/lib/format";
import { toNumeric } from "@/lib/format/form";
import { recordStatus } from "@/lib/status";
import type { Farm } from "@/types/api";

const NUMERIC_KEYS = ["partnerId", "latitude", "longitude", "areaHa"] as const;

export default function FarmsPage() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Farm | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading, isError, refetch } = useListQuery<Farm>(
    queryKeys.farms(list.params),
    resources.farms,
    list.params,
  );

  const save = useAction(
    (values: Record<string, unknown>) =>
      editing
        ? resources.updateFarm(editing.id, toNumeric(values, [...NUMERIC_KEYS]))
        : resources.createFarm(toNumeric(values, [...NUMERIC_KEYS])),
    {
      invalidate: [["farms"]],
      successMessage: "Đã lưu trang trại.",
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

  const openEdit = (row: Farm) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue(row);
    setOpen(true);
  };

  const columns: ColumnsType<Farm> = [
    {
      title: "Trang trại",
      render: (_, row) => (
        <div>
          <Link href={`/farms/${row.id}`} className="agri-link">
            {row.name}
          </Link>
          <div className="agri-muted agri-mono" style={{ fontSize: 12 }}>
            {row.code}
          </div>
        </div>
      ),
    },
    { title: "Đối tác", render: (_, row) => row.partner?.name ?? "—" },
    { title: "Địa chỉ", dataIndex: "address", ellipsis: true },
    {
      title: "Diện tích (ha)",
      dataIndex: "areaHa",
      align: "right",
      render: (v: string | null) => (v ? formatNumber(v) : "—"),
    },
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
      <ListPage<Farm>
        title="Trang trại"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Tìm theo tên, mã trang trại..."
        onReset={list.reset}
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Thêm trang trại
          </Button>
        }
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách trang trại.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có trang trại phù hợp"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1040}
        itemLabel="trang trại"
      />

      <FormModal
        open={open}
        title={editing ? "Chỉnh sửa trang trại" : "Thêm trang trại"}
        form={form}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        onSubmit={(values) => save.mutate(values as Record<string, unknown>)}
        submitting={save.isPending}
        width={600}
      >
        <FarmFormFields partnerLocked={editing !== null} />
      </FormModal>
    </>
  );
}
