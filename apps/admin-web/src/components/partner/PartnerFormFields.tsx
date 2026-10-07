"use client";

import { Form, Input, Select } from "antd";
import { RECORD_STATUS, statusOptions } from "@/lib/status";

/** Partner create/edit fields (shared by the list modal and detail page). */
export function PartnerFormFields() {
  return (
    <>
      <Form.Item label="Tên đối tác" name="name" rules={[{ required: true, message: "Nhập tên đối tác." }]}>
        <Input placeholder="VD: HTX Rau quả Minh Châu" />
      </Form.Item>
      <Form.Item
        label="Người đại diện"
        name="representativeName"
        rules={[{ required: true, message: "Nhập người đại diện." }]}
      >
        <Input placeholder="VD: Nguyễn Văn Minh" />
      </Form.Item>
      <Form.Item label="Số điện thoại" name="phone" rules={[{ required: true, message: "Nhập số điện thoại." }]}>
        <Input placeholder="VD: 0987654321" />
      </Form.Item>
      <Form.Item
        label="Email"
        name="email"
        rules={[
          { required: true, message: "Nhập email." },
          { type: "email", message: "Email không hợp lệ." },
        ]}
      >
        <Input placeholder="VD: minhchau@agrimarket.vn" />
      </Form.Item>
      <Form.Item label="Địa chỉ" name="address" rules={[{ required: true, message: "Nhập địa chỉ." }]}>
        <Input placeholder="VD: Thôn Đa Hòa, xã Minh Châu, Hưng Yên" />
      </Form.Item>
      <Form.Item label="Mã số thuế" name="taxCode">
        <Input placeholder="VD: 0900123456" />
      </Form.Item>
      <Form.Item label="Tên tài khoản ngân hàng" name="bankAccountName">
        <Input />
      </Form.Item>
      <Form.Item label="Số tài khoản" name="bankAccountNumber">
        <Input />
      </Form.Item>
      <Form.Item label="Ngân hàng" name="bankName">
        <Input placeholder="VD: Vietcombank - CN Hưng Yên" />
      </Form.Item>
      <Form.Item label="Trạng thái" name="status" initialValue="ACTIVE">
        <Select options={statusOptions(RECORD_STATUS)} />
      </Form.Item>
    </>
  );
}
