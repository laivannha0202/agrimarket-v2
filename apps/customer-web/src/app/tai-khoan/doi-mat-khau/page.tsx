import type { Metadata } from "next";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { RequireCustomer } from "@/components/layout/RequireCustomer";

export const metadata: Metadata = {
  title: "Đổi mật khẩu",
  description: "Đổi mật khẩu đăng nhập tài khoản khách hàng AgriMarket.",
};

export default function ChangePasswordPage() {
  return (
    <RequireCustomer>
      <ChangePasswordForm />
    </RequireCustomer>
  );
}
