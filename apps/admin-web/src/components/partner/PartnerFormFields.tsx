"use client";

import { Divider, Form, Input, Select, Typography } from "antd";
import { PARTNER_TYPE_OPTIONS } from "./partner-ui";

/** Partner create/edit fields (shared by the list modal and detail page). */
export function PartnerFormFields() {
  return (
    <>
      <Typography.Text strong>Thông tin cơ bản</Typography.Text>
      <Form.Item
        label="Loại đối tác"
        name="type"
        rules={[{ required: true, message: "Chọn loại đối tác." }]}
        style={{ marginTop: 12 }}
      >
        <Select placeholder="Chọn loại hình" options={PARTNER_TYPE_OPTIONS} />
      </Form.Item>
      <Form.Item label="Tên đối tác" name="name" rules={[
        { required: true, whitespace: true, message: "Nhập tên đối tác." },
        { max: 191, message: "Tên tối đa 191 ký tự." },
      ]}>
        <Input maxLength={191} placeholder="VD: HTX Rau quả Minh Châu" />
      </Form.Item>
      <Form.Item
        label="Người đại diện"
        name="representativeName"
        rules={[{ max: 150, message: "Tên đại diện tối đa 150 ký tự." }]}
      >
        <Input maxLength={150} placeholder="VD: Nguyễn Văn Minh" />
      </Form.Item>
      <Form.Item label="Số điện thoại" name="phone" rules={[
        { required: true, message: "Nhập số điện thoại." },
        { pattern: /^\+?[0-9][0-9\s.-]{7,19}$/, message: "Số điện thoại không hợp lệ." },
        { max: 20, message: "Số điện thoại tối đa 20 ký tự." },
      ]}>
        <Input placeholder="VD: 0987654321" />
      </Form.Item>
      <Form.Item
        label="Email"
        name="email"
        rules={[
          { type: "email", message: "Email không hợp lệ." },
        ]}
      >
        <Input maxLength={191} placeholder="VD: minhchau@agrimarket.vn" />
      </Form.Item>
      <Form.Item label="Địa chỉ" name="address">
        <Input maxLength={191} placeholder="VD: Thôn Đa Hòa, xã Minh Châu, Hưng Yên" />
      </Form.Item>
      <Divider style={{ marginBlock: 16 }} />
      <Typography.Text strong>Thông tin pháp lý</Typography.Text>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBlock: 8 }}>
        Có thể bổ sung hồ sơ sau khi tạo. Việc xác minh được duyệt riêng.
      </Typography.Paragraph>
      <Form.Item noStyle shouldUpdate={(previous, current) => previous.type !== current.type}>
        {({ getFieldValue }) => (
          <Form.Item label={getFieldValue("type") === "INDIVIDUAL" ? "Mã số thuế (nếu có)" : "Mã số thuế / mã đăng ký"} name="taxCode" rules={[
            { max: 191, message: "Mã số thuế / đăng ký tối đa 191 ký tự." },
          ]}>
            <Input maxLength={191} placeholder="Mã đăng ký hợp lệ" />
          </Form.Item>
        )}
      </Form.Item>
      <Form.Item label="Đường dẫn giấy tờ đăng ký (HTTPS)" name="registrationDocumentUrl" rules={[
        { type: "url", message: "Đường dẫn không hợp lệ." },
        { pattern: /^https:\/\//, message: "Chỉ chấp nhận liên kết HTTPS." },
        { max: 1000, message: "Liên kết quá dài." },
      ]}>
        <Input maxLength={1000} placeholder="https://..." />
      </Form.Item>
      <Divider style={{ marginBlock: 16 }} />
      <Typography.Text strong>Thông tin thanh toán</Typography.Text>
      <Form.Item label="Ngân hàng" name="bankName">
        <Input maxLength={191} placeholder="VD: Vietcombank - CN Hưng Yên" />
      </Form.Item>
      <Form.Item label="Chủ tài khoản" name="bankAccountName">
        <Input maxLength={191} autoComplete="off" />
      </Form.Item>
      <Form.Item label="Số tài khoản" name="bankAccountNumber">
        <Input maxLength={191} autoComplete="off" />
      </Form.Item>
    </>
  );
}
