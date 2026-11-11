"use client";

import { Alert, Button, Form, Input, Select } from "antd";
import { useFarmPartnerOptions } from "@/hooks/useOptions";
import { RECORD_STATUS, statusOptions } from "@/lib/status";

/** Farm create/edit fields (shared by the list modal and detail page). */
export function FarmFormFields({ partnerLocked = false }: { partnerLocked?: boolean }) {
  const form = Form.useFormInstance();
  const status = (Form.useWatch("status", form) as string | undefined) ?? "ACTIVE";
  const allPartners = useFarmPartnerOptions(!partnerLocked && status === "INACTIVE");
  const activePartners = useFarmPartnerOptions(!partnerLocked && status === "ACTIVE", true);
  const partners = status === "ACTIVE" ? activePartners : allPartners;
  const partnerId = Form.useWatch("partnerId", form) as number | undefined;

  const eligiblePartners = (activePartners.data ?? []).filter(
    (partner) => partner.status === "ACTIVE",
  );
  const selectedPartner =
    allPartners.data?.find((partner) => partner.id === partnerId) ??
    activePartners.data?.find((partner) => partner.id === partnerId);
  const selectedPartnerIsIneligible =
    status === "ACTIVE" &&
    partnerId !== undefined &&
    activePartners.data !== undefined &&
    !activePartners.isFetching &&
    !activePartners.isError &&
    !eligiblePartners.some((partner) => partner.id === partnerId);
  const partnerOptions = (partners.data ?? []).map((partner) => ({
    label: `${partner.code} — ${partner.name}`,
    value: partner.id,
  }));

  return (
    <>
      {partnerLocked ? null : (
        <>
          <Form.Item
            label="Đối tác"
            name="partnerId"
            getValueProps={(value: number | undefined) => ({
              value: selectedPartnerIsIneligible
                ? selectedPartner
                  ? `${selectedPartner.code} — ${selectedPartner.name}`
                  : `Đối tác #${partnerId}`
                : value,
            })}
            rules={[
              { required: true, message: "Chọn đối tác." },
              {
                validator: async (_, value: number | undefined) => {
                  if (!value || status !== "ACTIVE") return;
                  if (partners.isFetching || partners.isLoading) {
                    throw new Error("Đang kiểm tra trạng thái đối tác. Vui lòng thử lại.");
                  }
                  if (partners.isError) {
                    throw new Error("Không thể kiểm tra trạng thái đối tác. Hãy tải lại danh sách.");
                  }
                  const partner = partners.data?.find((item) => item.id === value);
                  if (!partner || partner.status !== "ACTIVE") {
                    throw new Error("Đối tác không còn đủ điều kiện. Hãy chọn đối tác VERIFIED và ACTIVE.");
                  }
                },
              },
            ]}
          >
            {selectedPartnerIsIneligible ? (
              <Input
                readOnly
                value={selectedPartner ? `${selectedPartner.code} — ${selectedPartner.name}` : `Đối tác #${partnerId}`}
              />
            ) : (
              <Select
                showSearch
                optionFilterProp="label"
                loading={partners.isLoading || partners.isFetching}
                disabled={partners.isFetching || partners.isError || partners.data === undefined}
                options={partnerOptions}
                placeholder="Chọn đối tác"
                notFoundContent={status === "ACTIVE" ? "Không có đối tác đủ điều kiện" : "Không có đối tác"}
              />
            )}
          </Form.Item>

          {selectedPartnerIsIneligible ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: -16, marginBottom: 16 }}
              title="Đối tác đang chọn không còn đủ điều kiện hoạt động."
              description="Hãy chọn lại đối tác VERIFIED + ACTIVE, hoặc chuyển trang trại về trạng thái Ngừng hoạt động để lưu hồ sơ nháp."
              action={(
                <Button size="small" onClick={() => form.setFieldValue("partnerId", undefined)}>
                  Chọn lại đối tác
                </Button>
              )}
            />
          ) : null}

          {partners.isError ? (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: -16, marginBottom: 16 }}
              title="Không tải được danh sách đối tác."
              description="Không thể xác minh điều kiện đối tác. Vui lòng tải lại trước khi lưu trang trại ACTIVE."
              action={<Button size="small" onClick={() => void partners.refetch()}>Tải lại</Button>}
            />
          ) : null}

          {partners.isSuccess && status === "ACTIVE" && eligiblePartners.length === 0 ? (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: -16, marginBottom: 16 }}
              title="Chưa có đối tác đủ điều kiện."
              description="Trang trại ACTIVE cần đối tác đã xác minh và đang hoạt động. Chuyển trạng thái trang trại về Ngừng hoạt động để lưu hồ sơ nháp."
            />
          ) : null}

          {partners.isSuccess && status === "INACTIVE" && partners.data.length === 0 ? (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: -16, marginBottom: 16 }}
              title="Chưa có đối tác trong hệ thống."
              description="Cần tạo đối tác trước khi lưu hồ sơ trang trại nháp."
            />
          ) : null}
        </>
      )}
      <Form.Item label="Tên trang trại" name="name" rules={[{ required: true, message: "Nhập tên trang trại." }]}>
        <Input placeholder="VD: Trang trại Minh Châu 1" />
      </Form.Item>
      <Form.Item label="Địa chỉ" name="address" rules={[{ required: true, message: "Nhập địa chỉ." }]}>
        <Input placeholder="VD: Thôn Đa Hòa, xã Minh Châu, Hưng Yên" />
      </Form.Item>
      <Form.Item label="Vĩ độ" name="latitude">
        <Input inputMode="decimal" placeholder="VD: 20.6464" />
      </Form.Item>
      <Form.Item label="Kinh độ" name="longitude">
        <Input inputMode="decimal" placeholder="VD: 106.0512" />
      </Form.Item>
      <Form.Item label="Diện tích (ha)" name="areaHa">
        <Input inputMode="decimal" placeholder="VD: 2.5" />
      </Form.Item>
      <Form.Item label="Mô tả" name="description">
        <Input.TextArea rows={3} />
      </Form.Item>
      <Form.Item label="Trạng thái" name="status" initialValue="ACTIVE">
        <Select options={statusOptions(RECORD_STATUS)} />
      </Form.Item>
    </>
  );
}
