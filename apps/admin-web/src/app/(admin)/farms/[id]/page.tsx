"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button, Form, Input, Select, Table, Typography } from "antd";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { DetailPage, DetailCard } from "@/components/common/DetailPage";
import { InfoDescriptions } from "@/components/common/InfoDescriptions";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { FarmFormFields } from "@/components/farm/FarmFormFields";
import { useDetailQuery } from "@/hooks/useDetailQuery";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { toNumeric } from "@/lib/format/form";
import {
  recordStatus,
  seasonStatus,
  certificateStatus,
  SEASON_STATUS,
  statusOptions,
} from "@/lib/status";
import type { Certificate, Farm, Season } from "@/types/api";

export default function FarmDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [editOpen, setEditOpen] = useState(false);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [form] = Form.useForm();
  const [seasonForm] = Form.useForm();

  const { data: farm, isLoading, isError, refetch } = useDetailQuery<Farm>(
    queryKeys.farm(id),
    () => resources.farm(id),
  );

  const seasons = useListQuery<Season>(
    queryKeys.seasons({ farmId: id, scope: "farm-detail" }),
    resources.seasons,
    { limit: 100 },
  );
  const farmSeasons = (seasons.data?.data ?? []).filter((s) => String(s.farmId) === id);

  const certificates = useListQuery<Certificate>(
    queryKeys.certificates({ farmId: id, scope: "farm-detail" }),
    resources.certificates,
    { limit: 100 },
  );
  const farmCerts = (certificates.data?.data ?? []).filter((c) => String(c.farmId) === id);

  const update = useAction(
    (values: Record<string, unknown>) =>
      resources.updateFarm(id, toNumeric(values, ["latitude", "longitude", "areaHa"])),
    {
      invalidate: [queryKeys.farm(id), ["farms"]],
      successMessage: "Đã cập nhật trang trại.",
      onSuccess: () => setEditOpen(false),
    },
  );

  const createSeason = useAction(
    (values: Record<string, unknown>) =>
      resources.createSeason(
        toNumeric(values, ["expectedYield"]),
      ),
    {
      invalidate: [["seasons"]],
      successMessage: "Đã tạo vụ mùa.",
      onSuccess: () => {
        setSeasonOpen(false);
        seasonForm.resetFields();
      },
    },
  );

  const seasonColumns: ColumnsType<Season> = [
    { title: "Cây trồng", dataIndex: "cropName" },
    { title: "Giống", dataIndex: "variety", render: (v: string | null) => v ?? "—" },
    {
      title: "Trồng",
      dataIndex: "plantingDate",
      render: (v: string | null) => formatDate(v),
    },
    {
      title: "Dự kiến thu",
      dataIndex: "expectedHarvestDate",
      render: (v: string | null) => formatDate(v),
    },
    {
      title: "Sản lượng dự kiến",
      render: (_, row) =>
        row.expectedYield ? `${formatNumber(row.expectedYield)} ${row.yieldUnit ?? ""}`.trim() : "—",
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={seasonStatus(s)} />,
    },
  ];

  const certColumns: ColumnsType<Certificate> = [
    { title: "Loại", dataIndex: "type" },
    { title: "Số chứng nhận", dataIndex: "certificateCode", render: (v: string) => <span className="agri-mono">{v}</span> },
    { title: "Đơn vị cấp", dataIndex: "issuer" },
    { title: "Hiệu lực đến", dataIndex: "expiresAt", render: (v: string) => formatDate(v) },
    {
      title: "Xác minh",
      dataIndex: "verificationStatus",
      render: (s: string) => <StatusTag status={certificateStatus(s)} />,
    },
  ];

  return (
    <DetailPage
      title={farm ? farm.name : "Chi tiết trang trại"}
      subtitle={farm ? farm.code : undefined}
      backHref="/farms"
      backLabel="Danh sách trang trại"
      loading={isLoading}
      error={isError ? new Error("Không tải được trang trại.") : undefined}
      onRetry={() => void refetch()}
      extra={
        farm ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <StatusTag status={recordStatus(farm.status)} />
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                form.setFieldsValue({
                  name: farm.name,
                  address: farm.address,
                  latitude: farm.latitude,
                  longitude: farm.longitude,
                  areaHa: farm.areaHa,
                  description: farm.description,
                  status: farm.status,
                });
                setEditOpen(true);
              }}
            >
              Chỉnh sửa
            </Button>
          </div>
        ) : undefined
      }
    >
      {farm ? (
        <>
          <DetailCard title="Thông tin chung">
            <InfoDescriptions
              items={[
                { key: "code", label: "Mã trang trại", children: <span className="agri-mono">{farm.code}</span> },
                {
                  key: "partner",
                  label: "Đối tác",
                  children: farm.partner ? (
                    <Link href={`/partners/${farm.partner.id}`} className="agri-link">
                      {farm.partner.name}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                { key: "area", label: "Diện tích (ha)", children: farm.areaHa ? formatNumber(farm.areaHa) : "—" },
                {
                  key: "coords",
                  label: "Tọa độ",
                  children:
                    farm.latitude && farm.longitude ? `${farm.latitude}, ${farm.longitude}` : "—",
                },
                { key: "address", label: "Địa chỉ", span: 2, children: farm.address },
                { key: "desc", label: "Mô tả", span: 2, children: farm.description ?? "—" },
                { key: "created", label: "Ngày tạo", children: formatDateTime(farm.createdAt) },
              ]}
            />
          </DetailCard>

          <DetailCard
            title="Vụ mùa"
            extra={
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => {
                  seasonForm.setFieldsValue({ farmId: Number(id), status: "PLANNED" });
                  setSeasonOpen(true);
                }}
              >
                Thêm vụ mùa
              </Button>
            }
          >
            <Table<Season>
              size="small"
              rowKey="id"
              columns={seasonColumns}
              dataSource={farmSeasons}
              loading={seasons.isLoading}
              pagination={false}
              locale={{ emptyText: "Chưa có vụ mùa" }}
            />
          </DetailCard>

          <DetailCard title="Chứng nhận">
            <Table<Certificate>
              size="small"
              rowKey="id"
              columns={certColumns}
              dataSource={farmCerts}
              loading={certificates.isLoading}
              pagination={false}
              locale={{ emptyText: "Chưa có chứng nhận" }}
            />
          </DetailCard>

          <FormModal
            open={editOpen}
            title="Chỉnh sửa trang trại"
            form={form}
            onCancel={() => setEditOpen(false)}
            onSubmit={(values) => update.mutate(values)}
            submitting={update.isPending}
            width={600}
          >
            <FarmFormFields partnerLocked />
          </FormModal>

          <FormModal
            open={seasonOpen}
            title="Thêm vụ mùa"
            form={seasonForm}
            onCancel={() => setSeasonOpen(false)}
            onSubmit={(values) => createSeason.mutate(values)}
            submitting={createSeason.isPending}
            width={560}
          >
            <Form.Item name="farmId" hidden>
              <Input />
            </Form.Item>
            <Form.Item label="Cây trồng" name="cropName" rules={[{ required: true, message: "Nhập cây trồng." }]}>
              <Input placeholder="VD: Cà chua bi" />
            </Form.Item>
            <Form.Item label="Giống" name="variety">
              <Input placeholder="VD: Cà chua bi đỏ F1" />
            </Form.Item>
            <Form.Item label="Ngày trồng" name="plantingDate">
              <Input type="date" />
            </Form.Item>
            <Form.Item label="Ngày thu hoạch dự kiến" name="expectedHarvestDate">
              <Input type="date" />
            </Form.Item>
            <Form.Item label="Sản lượng dự kiến" name="expectedYield">
              <Input type="number" />
            </Form.Item>
            <Form.Item label="Đơn vị sản lượng" name="yieldUnit">
              <Input placeholder="VD: tấn" />
            </Form.Item>
            <Form.Item label="Trạng thái" name="status" initialValue="PLANNED">
              <Select options={statusOptions(SEASON_STATUS)} />
            </Form.Item>
          </FormModal>

          <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
            Chứng nhận chỉ hiển thị các bản ghi thuộc trang trại này.
          </Typography.Paragraph>
        </>
      ) : null}
    </DetailPage>
  );
}
