"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Form } from "antd";
import { PlusOutlined } from "@ant-design/icons";
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

export default function FarmsPage() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const { data, isLoading, isError, refetch } = useListQuery<Farm>(
    queryKeys.farms(list.params),
    resources.farms,
    list.params,
  );

  const create = useAction(
    (values: Record<string, unknown>) =>
      resources.createFarm(toNumeric(values, ["partnerId", "latitude", "longitude", "areaHa"])),
    {
      invalidate: [["farms"]],
      successMessage: "Đã tạo trang trại.",
      onSuccess: () => {
        setOpen(false);
        form.resetFields();
      },
    },
  );

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
  ];

  return (
    <>
      <ListPage<Farm>
        title="Trang trại"
        subtitle="Cơ sở sản xuất trực thuộc đối tác"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Tìm theo tên, mã trang trại..."
        onReset={list.reset}
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
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
        scrollX={960}
        itemLabel="trang trại"
      />

      <FormModal
        open={open}
        title="Thêm trang trại"
        form={form}
        onCancel={() => setOpen(false)}
        onSubmit={(values) => create.mutate(values)}
        submitting={create.isPending}
        width={600}
      >
        <FarmFormFields />
      </FormModal>
    </>
  );
}
