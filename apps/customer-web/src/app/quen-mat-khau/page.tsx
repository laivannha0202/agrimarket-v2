import type { Metadata } from "next";
import { Suspense } from "react";
import { Container, Skeleton } from "@mantine/core";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Quên mật khẩu",
  description: "Yêu cầu liên kết đặt lại mật khẩu tài khoản khách hàng AgriMarket.",
};

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <Container size={460} py="xl">
          <Skeleton height={420} radius="md" />
        </Container>
      }
    >
      <ForgotPasswordForm />
    </Suspense>
  );
}
