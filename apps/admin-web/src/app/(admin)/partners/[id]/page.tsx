"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Alert, Button, Form, Input, Modal, Space, Table, Typography } from "antd";
import { EditOutlined, EyeInvisibleOutlined, EyeOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { DetailPage, DetailCard } from "@/components/common/DetailPage";
import { InfoDescriptions } from "@/components/common/InfoDescriptions";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { PartnerFormFields } from "@/components/partner/PartnerFormFields";
import { partnerFormPayload, partnerTypeLabel, partnerVerificationStatus, showPartnerFieldError } from "@/components/partner/partner-ui";
import { useDetailQuery } from "@/hooks/useDetailQuery";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime, formatNumber } from "@/lib/format";
import { recordStatus } from "@/lib/status";
import type { Farm, Partner, PartnerHistoryEntry, PartnerImpact } from "@/types/api";

type Decision =
  | { kind: "verification"; value: "VERIFIED" | "REJECTED" }
  | { kind: "business"; value: "ACTIVE" | "INACTIVE" };

const display = (value: string | null | undefined) => value || "—";

function historyLabel(action: string) {
  const labels: Record<string, string> = {
    CREATE: "Tạo đối tác",
    UPDATE: "Cập nhật hồ sơ",
    PARTNER_VERIFY_VERIFIED: "Xác minh hồ sơ",
    PARTNER_VERIFY_REJECTED: "Từ chối hồ sơ",
    PARTNER_BUSINESS_ACTIVE: "Cho phép kinh doanh",
    PARTNER_BUSINESS_INACTIVE: "Tạm khóa kinh doanh",
  };
  return labels[action] ?? action;
}

export default function PartnerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [editOpen, setEditOpen] = useState(false);
  const [bankVisible, setBankVisible] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [form] = Form.useForm();
  const [decisionForm] = Form.useForm<{ reason: string }>();

  const { data: partner, isLoading, isError, refetch } = useDetailQuery<Partner>(
    queryKeys.partner(id),
    () => resources.partner(id),
  );
  const farms = useListQuery<Farm>(
    queryKeys.farms({ partnerId: id }),
    resources.farms,
    { partnerId: id, limit: 100 },
    Boolean(partner),
  );
  const impact = useDetailQuery<PartnerImpact>(
    ["partners", id, "impact"],
    () => resources.partnerImpact(id),
    Boolean(partner),
  );
  const history = useDetailQuery<PartnerHistoryEntry[]>(
    ["partners", id, "history"],
    () => resources.partnerHistory(id),
    Boolean(partner),
  );

  const invalidate = [queryKeys.partner(id), ["partners"], ["partners", id, "impact"], ["partners", id, "history"]];
  const update = useAction((values: Record<string, unknown>) => resources.updatePartner(id, values), {
    invalidate,
    successMessage: "Đã cập nhật đối tác.",
    onSuccess: () => setEditOpen(false),
  });
  const review = useAction(
    (values: { decision: Decision; reason: string }) => values.decision.kind === "verification"
      ? resources.verifyPartner(id, { verificationStatus: values.decision.value, reason: values.reason || undefined })
      : resources.changePartnerBusinessStatus(id, { status: values.decision.value, reason: values.reason }),
    {
      invalidate,
      successMessage: "Đã cập nhật trạng thái đối tác.",
      onSuccess: () => {
        setDecision(null);
        decisionForm.resetFields();
      },
    },
  );

  const submitEdit = async (values: Record<string, unknown>) => {
    try {
      await update.mutateAsync(partnerFormPayload(values));
    } catch (error) {
      showPartnerFieldError(form, error);
    }
  };

  const startDecision = (next: Decision) => {
    decisionForm.resetFields();
    setDecision(next);
    if (next.kind === "business" && next.value === "INACTIVE") void impact.refetch();
  };

  const farmColumns: ColumnsType<Farm> = [
    { title: "Trang trại", render: (_, row) => <Link href={"/farms/" + row.id} className="agri-link">{row.name}</Link> },
    { title: "Mã", dataIndex: "code", render: (value: string) => <span className="agri-mono">{value}</span> },
    { title: "Địa chỉ", dataIndex: "address", ellipsis: true },
    { title: "Diện tích (ha)", dataIndex: "areaHa", align: "right",
      render: (value: string | null) => value ? formatNumber(value) : "—" },
    { title: "Trạng thái", dataIndex: "status", render: (value: string) => <StatusTag status={recordStatus(value)} /> },
  ];
  const historyColumns: ColumnsType<PartnerHistoryEntry> = [
    { title: "Thời gian", dataIndex: "createdAt", width: 175, render: (value: string) => formatDateTime(value) },
    { title: "Thao tác", dataIndex: "action", render: (value: string) => historyLabel(value) },
    { title: "Người thực hiện", render: (_, row) => row.actorUser?.fullName ?? "Hệ thống" },
    { title: "Lý do", dataIndex: "reason", render: (value: string | null) => display(value) },
  ];

  const suspensionBlocked = Boolean((impact.data?.activeProducts ?? 0) > 0 || (impact.data?.openOrders ?? 0) > 0);

  return (
    <DetailPage
      title={partner?.name ?? "Chi tiết đối tác"}
      subtitle={partner?.code}
      backHref="/partners"
      backLabel="Danh sách đối tác"
      loading={isLoading}
      error={isError ? new Error("Không tải được đối tác.") : undefined}
      onRetry={() => void refetch()}
      extra={partner ? (
        <Space wrap>
          <StatusTag status={recordStatus(partner.status)} />
          <StatusTag status={partnerVerificationStatus(partner.verificationStatus)} />
          <Button icon={<EditOutlined />} onClick={() => {
            form.resetFields();
            form.setFieldsValue(partner);
            setEditOpen(true);
          }}>Chỉnh sửa</Button>
        </Space>
      ) : undefined}
    >
      {partner ? (
        <>
          <DetailCard title="Tổng quan và trạng thái">
            <InfoDescriptions column={{ xs: 1, sm: 2 }} items={[
              { key: "code", label: "Mã đối tác", children: <span className="agri-mono">{partner.code}</span> },
              { key: "type", label: "Loại hình", children: partnerTypeLabel(partner.type) },
              { key: "verification", label: "Xác minh hồ sơ", children: <StatusTag status={partnerVerificationStatus(partner.verificationStatus)} /> },
              { key: "status", label: "Kinh doanh", children: <StatusTag status={recordStatus(partner.status)} /> },
              { key: "created", label: "Ngày tạo", children: formatDateTime(partner.createdAt) },
              { key: "updated", label: "Cập nhật", children: formatDateTime(partner.updatedAt) },
            ]} />
            <Space wrap style={{ marginTop: 14 }}>
              {partner.verificationStatus !== "VERIFIED" ? (
                <Button onClick={() => startDecision({ kind: "verification", value: "VERIFIED" })}>Duyệt hồ sơ</Button>
              ) : null}
              {partner.verificationStatus !== "REJECTED" ? (
                <Button disabled={partner.status === "ACTIVE"}
                  onClick={() => startDecision({ kind: "verification", value: "REJECTED" })}>Từ chối hồ sơ</Button>
              ) : null}
              {partner.status === "INACTIVE" ? (
                <Button type="primary" disabled={partner.verificationStatus !== "VERIFIED"}
                  onClick={() => startDecision({ kind: "business", value: "ACTIVE" })}>
                  Cho phép kinh doanh
                </Button>
              ) : (
                <Button danger onClick={() => startDecision({ kind: "business", value: "INACTIVE" })}>
                  Tạm khóa kinh doanh
                </Button>
              )}
            </Space>
          </DetailCard>

          <DetailCard title="Thông tin pháp lý và xác minh">
            <InfoDescriptions column={{ xs: 1, sm: 2 }} items={[
              { key: "type", label: "Loại hình", children: partnerTypeLabel(partner.type) },
              { key: "tax", label: "Mã số thuế / đăng ký", children: display(partner.taxCode) },
              { key: "document", label: "Giấy tờ đăng ký", span: 2, children: partner.registrationDocumentUrl ? (
                <a href={partner.registrationDocumentUrl} target="_blank" rel="noopener noreferrer">Mở tài liệu</a>
              ) : "Chưa bổ sung" },
            ]} />
            <Typography.Text type="secondary" style={{ display: "block", marginTop: 10, fontSize: 12 }}>
              {partner.status === "ACTIVE"
                ? "Cần tạm khóa kinh doanh trước khi thay đổi hoặc từ chối hồ sơ pháp lý đã xác minh."
                : "Thay đổi hồ sơ pháp lý sau khi duyệt sẽ yêu cầu xác minh lại."}
            </Typography.Text>
          </DetailCard>

          <DetailCard title="Thông tin liên hệ">
            <InfoDescriptions column={{ xs: 1, sm: 2 }} items={[
              { key: "rep", label: "Người đại diện", children: display(partner.representativeName) },
              { key: "phone", label: "Điện thoại", children: partner.phone },
              { key: "email", label: "Email", children: display(partner.email) },
              { key: "address", label: "Địa chỉ", span: 2, children: display(partner.address) },
            ]} />
          </DetailCard>

          <DetailCard title="Tài khoản ngân hàng" extra={
            <Button size="small" icon={bankVisible ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={() => setBankVisible(!bankVisible)}>
              {bankVisible ? "Ẩn thông tin" : "Hiện thông tin"}
            </Button>
          }>
            <InfoDescriptions column={{ xs: 1, sm: 2 }} items={[
              { key: "bankName", label: "Ngân hàng", children: display(partner.bankName) },
              { key: "acctName", label: "Chủ tài khoản", children: bankVisible ? display(partner.bankAccountName) : "••••••" },
              { key: "acctNo", label: "Số tài khoản", children: bankVisible && partner.bankAccountNumber
                ? <span className="agri-mono">{partner.bankAccountNumber}</span> : "••••••" },
            ]} />
          </DetailCard>

          <DetailCard title="Trang trại liên kết">
            {farms.isError ? <Alert type="error" showIcon message="Không tải được trang trại."
              action={<Button size="small" onClick={() => void farms.refetch()}>Thử lại</Button>} /> : null}
            <Table<Farm> size="small" rowKey="id" columns={farmColumns}
              dataSource={farms.data?.data ?? []} loading={farms.isLoading}
              scroll={{ x: 720 }} pagination={{ pageSize: 10 }}
              locale={{ emptyText: "Chưa có trang trại liên kết" }} />
            {(farms.data?.meta.total ?? 0) > 100 ? (
              <Typography.Text type="secondary">Hiển thị 100 trang trại đầu tiên.</Typography.Text>
            ) : null}
          </DetailCard>

          <DetailCard title="Lịch sử chỉnh sửa và trạng thái">
            {history.isError ? <Alert type="error" showIcon message="Không tải được lịch sử."
              action={<Button size="small" onClick={() => void history.refetch()}>Thử lại</Button>} /> : null}
            <Table<PartnerHistoryEntry> size="small" rowKey="id" columns={historyColumns}
              dataSource={history.data ?? []} loading={history.isLoading}
              scroll={{ x: 690 }} pagination={{ pageSize: 5 }}
              locale={{ emptyText: "Chưa có lịch sử thay đổi" }} />
          </DetailCard>

          <FormModal open={editOpen} title="Chỉnh sửa đối tác" form={form}
            onCancel={() => setEditOpen(false)} onSubmit={(values) => void submitEdit(values)}
            submitting={update.isPending} width={640}>
            {partner.status === "ACTIVE" && partner.verificationStatus === "VERIFIED" ? (
              <Alert type="info" showIcon style={{ marginBottom: 14 }}
                message="Đang kinh doanh: muốn sửa tên, loại hình hoặc giấy tờ pháp lý, hãy tạm khóa kinh doanh trước." />
            ) : null}
            <PartnerFormFields />
          </FormModal>

          <Modal
            open={Boolean(decision)}
            title={decision?.kind === "verification"
              ? (decision.value === "VERIFIED" ? "Xác minh hồ sơ" : "Từ chối hồ sơ")
              : (decision?.value === "ACTIVE" ? "Cho phép kinh doanh" : "Tạm khóa kinh doanh")}
            onCancel={() => setDecision(null)}
            onOk={() => decisionForm.submit()}
            okText="Xác nhận"
            okButtonProps={{ disabled: decision?.kind === "business" && decision.value === "INACTIVE" && (impact.isLoading || impact.isFetching || impact.isError || suspensionBlocked) }}
            confirmLoading={review.isPending}
            forceRender
            mask={{ closable: false }}
          >
            {decision?.kind === "business" && decision.value === "INACTIVE" ? (
              impact.isError ? <Alert type="error" showIcon message="Không kiểm tra được ảnh hưởng. Hãy thử lại." /> :
              <Alert type={suspensionBlocked ? "warning" : "info"} showIcon
                message={impact.isLoading ? "Đang kiểm tra dữ liệu liên quan..." : "Ảnh hưởng đến dữ liệu hiện tại"}
                description={impact.data
                  ? "Trang trại " + impact.data.farms + " (" + impact.data.activeFarms + " đang hoạt động), sản phẩm "
                    + impact.data.products + " (" + impact.data.activeProducts + " đang bán), đơn chưa hoàn tất "
                    + impact.data.openOrders + "."
                    + (suspensionBlocked ? " Cần xử lý sản phẩm và đơn hàng đang mở trước khi khóa." : "")
                  : undefined}
                style={{ marginBottom: 14 }} />
            ) : null}
            <Form form={decisionForm} layout="vertical" onFinish={(values) => {
              if (decision) review.mutate({ decision, reason: values.reason?.trim() ?? "" });
            }} style={{ marginTop: 16 }}>
              <Form.Item name="reason" label="Lý do" rules={
                decision?.kind === "business" || decision?.value === "REJECTED"
                  ? [{ required: true, whitespace: true, message: "Nhập lý do thay đổi." }]
                  : []
              }>
                <Input.TextArea rows={3} maxLength={500} showCount placeholder="Ghi nhận lý do xử lý" />
              </Form.Item>
            </Form>
          </Modal>
        </>
      ) : null}
    </DetailPage>
  );
}
