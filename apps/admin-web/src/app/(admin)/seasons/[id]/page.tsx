"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button, Form, Input, Select, Switch, Table, Tag } from "antd";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { DetailPage, DetailCard } from "@/components/common/DetailPage";
import { InfoDescriptions } from "@/components/common/InfoDescriptions";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { useDetailQuery } from "@/hooks/useDetailQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { toNumeric } from "@/lib/format/form";
import {
  seasonStatus,
  farmingEventType,
  FARMING_EVENT_TYPE,
  SEASON_STATUS,
  statusOptions,
} from "@/lib/status";
import type { FarmingEvent, Harvest, Season } from "@/types/api";

export default function SeasonDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [editOpen, setEditOpen] = useState(false);
  const [harvestOpen, setHarvestOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [harvestForm] = Form.useForm();
  const [eventForm] = Form.useForm();

  const { data: season, isLoading, isError, refetch } = useDetailQuery<Season>(
    queryKeys.season(id),
    () => resources.season(id),
  );

  const updateSeason = useAction(
    (values: Record<string, unknown>) =>
      resources.updateSeason(id, toNumeric(values, ["expectedYield"])),
    {
      invalidate: [queryKeys.season(id), ["seasons"]],
      successMessage: "Đã cập nhật vụ mùa.",
      onSuccess: () => {
        setEditOpen(false);
        editForm.resetFields();
      },
    },
  );

  const createHarvest = useAction(
    (values: Record<string, unknown>) =>
      resources.createHarvest({
        seasonId: Number(id),
        harvestDate: values.harvestDate,
        quantity: Number(values.quantity),
        unit: String(values.unit ?? "").trim(),
        grade: String(values.grade ?? "").trim(),
        note: String(values.note ?? "").trim() || undefined,
      }),
    {
      invalidate: [queryKeys.season(id), ["seasons"], ["harvests"]],
      successMessage: "Đã ghi nhận vụ thu hoạch.",
      onSuccess: () => {
        setHarvestOpen(false);
        harvestForm.resetFields();
      },
    },
  );

  const createEvent = useAction(
    (values: Record<string, unknown>) =>
      resources.createFarmingEvent({
        seasonId: Number(id),
        type: values.type,
        occurredAt: new Date(String(values.occurredAt)).toISOString(),
        content: String(values.content ?? "").trim(),
        isPublic: Boolean(values.isPublic),
      }),
    {
      invalidate: [queryKeys.season(id), ["seasons"]],
      successMessage: "Đã ghi nhận hoạt động canh tác.",
      onSuccess: () => {
        setEventOpen(false);
        eventForm.resetFields();
      },
    },
  );

  const harvestColumns: ColumnsType<Harvest> = [
    {
      title: "Ngày thu hoạch",
      dataIndex: "harvestDate",
      render: (v: string) => <span className="agri-nowrap">{formatDate(v)}</span>,
    },
    {
      title: "Số lượng",
      render: (_, row) => <span className="agri-nowrap">{formatNumber(row.quantity)} {row.unit}</span>,
    },
    { title: "Phân loại", dataIndex: "grade" },
    { title: "Ghi chú", dataIndex: "note", render: (v: string | null) => v ?? "—" },
    {
      title: "Ngày tạo",
      dataIndex: "createdAt",
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
  ];

  const eventColumns: ColumnsType<FarmingEvent> = [
    {
      title: "Thời điểm",
      dataIndex: "occurredAt",
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
    {
      title: "Hoạt động",
      dataIndex: "type",
      render: (v: string) => <StatusTag status={farmingEventType(v)} />,
    },
    { title: "Nội dung", dataIndex: "content" },
    {
      title: "Công khai",
      dataIndex: "isPublic",
      render: (v: boolean) => (v ? <Tag color="green">Có</Tag> : <Tag>Không</Tag>),
    },
  ];

  return (
    <DetailPage
      title={season ? `Vụ mùa: ${season.cropName}` : "Chi tiết vụ mùa"}
      subtitle={season?.farm ? `${season.farm.name} — ${season.farm.code}` : undefined}
      backHref={season?.farm ? `/farms/${season.farm.id}` : "/farms"}
      backLabel="Trang trại"
      loading={isLoading}
      error={isError ? new Error("Không tải được vụ mùa.") : undefined}
      onRetry={() => void refetch()}
      extra={
        season ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <StatusTag status={seasonStatus(season.status)} />
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                editForm.setFieldsValue({
                  cropName: season.cropName,
                  variety: season.variety,
                  plantingDate: season.plantingDate?.slice(0, 10),
                  expectedHarvestDate: season.expectedHarvestDate?.slice(0, 10),
                  expectedYield: season.expectedYield,
                  yieldUnit: season.yieldUnit,
                  status: season.status,
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
      {season ? (
        <>
          <DetailCard title="Thông tin vụ mùa">
            <InfoDescriptions
              items={[
                { key: "crop", label: "Cây trồng", children: season.cropName },
                { key: "variety", label: "Giống", children: season.variety ?? "—" },
                {
                  key: "farm",
                  label: "Trang trại",
                  children: season.farm ? (
                    <Link href={`/farms/${season.farm.id}`} className="agri-link">
                      {season.farm.name}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                {
                  key: "partner",
                  label: "Đối tác",
                  children: season.farm?.partner?.name ?? "—",
                },
                { key: "planting", label: "Ngày trồng", children: formatDate(season.plantingDate) },
                {
                  key: "expected",
                  label: "Thu hoạch dự kiến",
                  children: formatDate(season.expectedHarvestDate),
                },
                {
                  key: "yield",
                  label: "Sản lượng dự kiến",
                  children: season.expectedYield
                    ? `${formatNumber(season.expectedYield)} ${season.yieldUnit ?? ""}`.trim()
                    : "—",
                },
              ]}
            />
          </DetailCard>

          <DetailCard
            title="Thu hoạch"
            extra={
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => {
                  harvestForm.setFieldsValue({
                    harvestDate: new Date().toISOString().slice(0, 10),
                    unit: season.yieldUnit ?? "kg",
                    grade: "Loại 1",
                  });
                  setHarvestOpen(true);
                }}
              >
                Thêm thu hoạch
              </Button>
            }
          >
            <Table<Harvest>
              size="small"
              rowKey="id"
              columns={harvestColumns}
              dataSource={season.harvests ?? []}
              pagination={false}
              locale={{ emptyText: "Chưa có vụ thu hoạch" }}
            />
          </DetailCard>

          <DetailCard
            title="Hoạt động canh tác"
            extra={
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => {
                  eventForm.setFieldsValue({
                    type: "CARE",
                    occurredAt: new Date().toISOString().slice(0, 16),
                    isPublic: true,
                  });
                  setEventOpen(true);
                }}
              >
                Ghi nhận hoạt động
              </Button>
            }
          >
            <Table<FarmingEvent>
              size="small"
              rowKey="id"
              columns={eventColumns}
              dataSource={season.farmingEvents ?? []}
              pagination={false}
              locale={{ emptyText: "Chưa có hoạt động canh tác" }}
            />
          </DetailCard>

          <FormModal
            open={editOpen}
            title="Chỉnh sửa vụ mùa"
            form={editForm}
            onCancel={() => setEditOpen(false)}
            onSubmit={(values) => updateSeason.mutate(values)}
            submitting={updateSeason.isPending}
          >
            <Form.Item label="Cây trồng" name="cropName" rules={[{ required: true, message: "Nhập cây trồng." }]}>
              <Input />
            </Form.Item>
            <Form.Item label="Giống" name="variety">
              <Input />
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
            <Form.Item label="Trạng thái" name="status">
              <Select options={statusOptions(SEASON_STATUS)} />
            </Form.Item>
          </FormModal>

          <FormModal
            open={harvestOpen}
            title="Ghi nhận thu hoạch"
            form={harvestForm}
            onCancel={() => setHarvestOpen(false)}
            onSubmit={(values) => createHarvest.mutate(values)}
            submitting={createHarvest.isPending}
          >
            <Form.Item
              label="Ngày thu hoạch"
              name="harvestDate"
              rules={[{ required: true, message: "Chọn ngày thu hoạch." }]}
            >
              <Input type="date" />
            </Form.Item>
            <Form.Item
              label="Số lượng"
              name="quantity"
              rules={[{ required: true, message: "Nhập số lượng." }]}
            >
              <Input type="number" min={0} />
            </Form.Item>
            <Form.Item label="Đơn vị" name="unit" rules={[{ required: true, message: "Nhập đơn vị." }]}>
              <Input placeholder="VD: kg, tấn" />
            </Form.Item>
            <Form.Item label="Phân loại" name="grade" rules={[{ required: true, message: "Nhập phân loại." }]}>
              <Input placeholder="VD: Loại 1" />
            </Form.Item>
            <Form.Item label="Ghi chú" name="note">
              <Input.TextArea rows={2} />
            </Form.Item>
          </FormModal>

          <FormModal
            open={eventOpen}
            title="Ghi nhận hoạt động canh tác"
            form={eventForm}
            onCancel={() => setEventOpen(false)}
            onSubmit={(values) => createEvent.mutate(values)}
            submitting={createEvent.isPending}
          >
            <Form.Item label="Loại hoạt động" name="type" rules={[{ required: true }]}>
              <Select options={statusOptions(FARMING_EVENT_TYPE)} />
            </Form.Item>
            <Form.Item
              label="Thời điểm"
              name="occurredAt"
              rules={[{ required: true, message: "Chọn thời điểm." }]}
            >
              <Input type="datetime-local" />
            </Form.Item>
            <Form.Item
              label="Nội dung"
              name="content"
              rules={[{ required: true, message: "Nhập nội dung." }]}
            >
              <Input.TextArea rows={3} placeholder="VD: Tưới nhỏ giọt 30 phút buổi sáng" />
            </Form.Item>
            <Form.Item label="Hiển thị công khai" name="isPublic" valuePropName="checked">
              <Switch />
            </Form.Item>
          </FormModal>
        </>
      ) : null}
    </DetailPage>
  );
}
