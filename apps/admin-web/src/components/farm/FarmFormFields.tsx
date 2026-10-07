"use client";

import { Form, Input, Select } from "antd";
import { usePartnerOptions } from "@/hooks/useOptions";
import { RECORD_STATUS, statusOptions } from "@/lib/status";

/** Farm create/edit fields (shared by the list modal and detail page). */
export function FarmFormFields({ partnerLocked = false }: { partnerLocked?: boolean }) {
  const partners = usePartnerOptions();
  return (
    <>
      {partnerLocked ? null : (
        <Form.Item label="Đối tác" name="partnerId" rules={[{ required: true, message: "Chọn đối tác." }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={partners.isLoading}
            options={partners.data}
            placeholder="Chọn đối tác"
          />
        </Form.Item>
      )}
      <Form.Item label="Tên trang trại" name="name" rules={[{ required: true, message: "Nhập tên trang trại." }]}>
        <Input placeholder="VD: Trang trại Minh Châu 1" />
      </Form.Item>
      <Form.Item label="Địa chỉ" name="address" rules={[{ required: true, message: "Nhập địa chỉ." }]}>
        <Input placeholder="VD: Thôn Đa Hòa, xã Minh Châu, Hưng Yên" />
      </Form.Item>
      <Form.Item label="Vĩ độ" name="latitude">
        <Input type="number" placeholder="VD: 20.6464" />
      </Form.Item>
      <Form.Item label="Kinh độ" name="longitude">
        <Input type="number" placeholder="VD: 106.0512" />
      </Form.Item>
      <Form.Item label="Diện tích (ha)" name="areaHa">
        <Input type="number" placeholder="VD: 2.5" />
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
