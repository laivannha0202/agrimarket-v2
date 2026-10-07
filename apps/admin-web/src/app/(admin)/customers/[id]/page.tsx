"use client";

import { useParams } from "next/navigation";
import { Button, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DetailPage, DetailCard } from "@/components/common/DetailPage";
import { InfoDescriptions, formatAddress } from "@/components/common/InfoDescriptions";
import { StatusTag } from "@/components/common/StatusTag";
import { useDetailQuery } from "@/hooks/useDetailQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { userStatus } from "@/lib/status";
import type { Address, Customer } from "@/types/api";

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: customer, isLoading, isError, refetch } = useDetailQuery<Customer>(
    queryKeys.customer(id),
    () => resources.customer(id),
  );

  const toggle = useAction(
    (activate: boolean) =>
      activate ? resources.activateCustomer(id) : resources.deactivateCustomer(id),
    {
      invalidate: [queryKeys.customer(id), ["customers"]],
      successMessage: "Đã cập nhật trạng thái người dùng.",
    },
  );

  const profile = customer?.customerProfile;
  const addresses = profile?.addresses ?? [];

  const addressColumns: ColumnsType<Address> = [
    {
      title: "Người nhận",
      render: (_, row) => (
        <div>
          <div>
            {row.recipientName}{" "}
            {row.isDefault ? <span className="agri-muted">(mặc định)</span> : null}
          </div>
          <div className="agri-muted" style={{ fontSize: 12 }}>
            {row.phone}
          </div>
        </div>
      ),
    },
    { title: "Địa chỉ", render: (_, row) => formatAddress(row), ellipsis: true },
    {
      title: "Ngày tạo",
      dataIndex: "createdAt",
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
  ];

  return (
    <DetailPage
      title={customer ? customer.fullName : "Chi tiết khách hàng"}
      subtitle={customer ? customer.email : undefined}
      backHref="/customers"
      backLabel="Danh sách khách hàng"
      loading={isLoading}
      error={isError ? new Error("Không tải được khách hàng.") : undefined}
      onRetry={() => void refetch()}
      extra={
        customer ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <StatusTag status={userStatus(customer.status)} />
            <Button
              danger={customer.status === "ACTIVE"}
              loading={toggle.isPending}
              onClick={() => toggle.mutate(customer.status !== "ACTIVE")}
            >
              {customer.status === "ACTIVE" ? "Khóa tài khoản" : "Mở khóa tài khoản"}
            </Button>
          </div>
        ) : undefined
      }
    >
      {customer ? (
        <>
          <DetailCard title="Thông tin tài khoản">
            <InfoDescriptions
              items={[
                { key: "email", label: "Email", children: customer.email },
                { key: "phone", label: "Điện thoại", children: customer.phone ?? "—" },
                {
                  key: "role",
                  label: "Vai trò",
                  children: customer.role === "ADMIN" ? "Quản trị viên" : "Khách hàng",
                },
                {
                  key: "created",
                  label: "Ngày tạo",
                  children: formatDateTime(customer.createdAt),
                },
                {
                  key: "loyalty",
                  label: "Điểm tích lũy",
                  children: profile ? formatNumber(profile.loyaltyPoints) : "—",
                },
                {
                  key: "dob",
                  label: "Ngày sinh",
                  children: profile?.dateOfBirth ? formatDate(profile.dateOfBirth) : "—",
                },
              ]}
            />
          </DetailCard>

          <DetailCard title="Địa chỉ giao hàng">
            <Table<Address>
              size="small"
              rowKey="id"
              columns={addressColumns}
              dataSource={addresses}
              pagination={false}
              locale={{ emptyText: "Chưa có địa chỉ" }}
            />
          </DetailCard>

          <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
            Không thể khóa tài khoản quản trị viên cuối cùng của hệ thống.
          </Typography.Paragraph>
        </>
      ) : null}
    </DetailPage>
  );
}
