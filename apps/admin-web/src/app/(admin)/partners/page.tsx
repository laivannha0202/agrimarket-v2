"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Form, Space } from "antd";
import { EditOutlined, PlusOutlined, EyeOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { PartnerFormFields } from "@/components/partner/PartnerFormFields";
import { PARTNER_TYPE_OPTIONS, PARTNER_VERIFICATION_OPTIONS, partnerFormPayload, partnerTypeLabel, partnerVerificationStatus, showPartnerFieldError } from "@/components/partner/partner-ui";
import { useListState } from "@/hooks/useListState";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { RECORD_STATUS, recordStatus, statusOptions } from "@/lib/status";
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

  const submitPartner = async (values: Record<string, unknown>) => {
    try {
      await save.mutateAsync(partnerFormPayload(values));
    } catch (error) {
      showPartnerFieldError(form, error);
    }
  };

  const columns: ColumnsType<Partner> = [
    {
      title: "Đối tác",
      // Without a width the auto layout squeezed the name to two lines while
      // the email column took the free space.
      width: 280,
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
    { title: "Loại hình", dataIndex: "type", width: 140, render: (type: Partner["type"]) => partnerTypeLabel(type) },
    { title: "Người đại diện", dataIndex: "representativeName", render: (value: string | null) => value || "—" },
    { title: "Liên hệ", width: 210, render: (_, row) => <div>
      <div>{row.phone}</div><div className="agri-muted" style={{ fontSize: 12 }}>{row.email || "—"}</div>
    </div> },
    {
      title: "Kinh doanh",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={recordStatus(s)} />,
    },
    { title: "Hồ sơ", dataIndex: "verificationStatus", width: 140,
      render: (status: Partner["verificationStatus"]) => <StatusTag status={partnerVerificationStatus(status)} /> },
    {
      title: "Thao tác",
      width: 130,
      fixed: "right",
      render: (_, row) => (
        <Space size={4}>
          <Link href={`/partners/${row.id}`}><Button type="link" size="small" icon={<EyeOutlined />} style={{ paddingInline: 0 }}>Xem</Button></Link>
          <Button type="link" size="small" icon={<EditOutlined />} style={{ paddingInline: 0 }} onClick={() => openEdit(row)}>Sửa</Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <ListPage<Partner>
        title="Đối tác bán hàng"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Tìm tên, mã đối tác, số điện thoại..."
        onReset={list.reset}
        filters={[
          { key: "type", placeholder: "Loại đối tác", value: list.filters.type, options: PARTNER_TYPE_OPTIONS, width: 170 },
          { key: "status", placeholder: "Kinh doanh", value: list.filters.status, options: statusOptions(RECORD_STATUS), width: 145 },
          { key: "verificationStatus", placeholder: "Xác minh", value: list.filters.verificationStatus, options: PARTNER_VERIFICATION_OPTIONS, width: 160 },
        ]}
        onFilterChange={list.setFilter}
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
        scrollX={1200}
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
        onSubmit={(values) => void submitPartner(values as Record<string, unknown>)}
        submitting={save.isPending}
        width={640}
      >
        <PartnerFormFields />
      </FormModal>
    </>
  );
}
