"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button, Form, Table, Typography } from "antd";
import { EditOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { DetailPage, DetailCard } from "@/components/common/DetailPage";
import { InfoDescriptions } from "@/components/common/InfoDescriptions";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { PartnerFormFields } from "@/components/partner/PartnerFormFields";
import { useDetailQuery } from "@/hooks/useDetailQuery";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime, formatNumber } from "@/lib/format";
import { recordStatus } from "@/lib/status";
import type { Farm, Partner } from "@/types/api";

export default function PartnerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [editOpen, setEditOpen] = useState(false);
  const [form] = Form.useForm();

  const { data: partner, isLoading, isError, refetch } = useDetailQuery<Partner>(
    queryKeys.partner(id),
    () => resources.partner(id),
  );

  const farms = useListQuery<Farm>(
    queryKeys.farms({ scope: "partner-detail" }),
    resources.farms,
    { limit: 100 },
  );
  // /farms does not support a partnerId filter (rejected by the API), so the
  // partner's farms are selected from the fetched page in the browser.
  const partnerFarms = (farms.data?.data ?? []).filter((f) => String(f.partnerId) === String(id));

  const update = useAction((values: Record<string, unknown>) => resources.updatePartner(id, values), {
    invalidate: [queryKeys.partner(id), ["partners"]],
    successMessage: "Đã cập nhật đối tác.",
    onSuccess: () => setEditOpen(false),
  });

  const farmColumns: ColumnsType<Farm> = [
    {
      title: "Trang trại",
      render: (_, row) => (
        <Link href={`/farms/${row.id}`} className="agri-link">
          {row.name}
        </Link>
      ),
    },
    { title: "Mã", dataIndex: "code", render: (v: string) => <span className="agri-mono">{v}</span> },
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
    <DetailPage
      title={partner ? partner.name : "Chi tiết đối tác"}
      subtitle={partner ? partner.code : undefined}
      backHref="/partners"
      backLabel="Danh sách đối tác"
      loading={isLoading}
      error={isError ? new Error("Không tải được đối tác.") : undefined}
      onRetry={() => void refetch()}
      extra={
        partner ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <StatusTag status={recordStatus(partner.status)} />
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                form.setFieldsValue(partner);
                setEditOpen(true);
              }}
            >
              Chỉnh sửa
            </Button>
          </div>
        ) : undefined
      }
    >
      {partner ? (
        <>
          <DetailCard title="Thông tin chung">
            <InfoDescriptions
              items={[
                { key: "code", label: "Mã đối tác", children: <span className="agri-mono">{partner.code}</span> },
                { key: "rep", label: "Người đại diện", children: partner.representativeName },
                { key: "phone", label: "Điện thoại", children: partner.phone },
                { key: "email", label: "Email", children: partner.email },
                { key: "address", label: "Địa chỉ", span: 2, children: partner.address },
                { key: "tax", label: "Mã số thuế", children: partner.taxCode ?? "—" },
                {
                  key: "created",
                  label: "Ngày tạo",
                  children: formatDateTime(partner.createdAt),
                },
              ]}
            />
          </DetailCard>

          <DetailCard title="Thông tin ngân hàng">
            <InfoDescriptions
              items={[
                { key: "bankName", label: "Ngân hàng", children: partner.bankName ?? "—" },
                { key: "acctName", label: "Tên tài khoản", children: partner.bankAccountName ?? "—" },
                {
                  key: "acctNo",
                  label: "Số tài khoản",
                  children: partner.bankAccountNumber ? (
                    <span className="agri-mono">{partner.bankAccountNumber}</span>
                  ) : (
                    "—"
                  ),
                },
              ]}
            />
          </DetailCard>

          <DetailCard title="Trang trại trực thuộc">
            <Table<Farm>
              size="small"
              rowKey="id"
              columns={farmColumns}
              dataSource={partnerFarms}
              loading={farms.isLoading}
              pagination={false}
              locale={{ emptyText: "Chưa có trang trại" }}
            />
          </DetailCard>

          <FormModal
            open={editOpen}
            title="Chỉnh sửa đối tác"
            form={form}
            onCancel={() => setEditOpen(false)}
            onSubmit={(values) => update.mutate(values)}
            submitting={update.isPending}
            width={640}
          >
            <PartnerFormFields />
          </FormModal>

          <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
            Mã đối tác do hệ thống sinh tự động, không thể chỉnh sửa.
          </Typography.Paragraph>
        </>
      ) : null}
    </DetailPage>
  );
}
