import type { Metadata } from "next";
import { Suspense } from "react";
import { Container, Skeleton } from "@mantine/core";
import { RegisterForm } from "@/components/auth/RegisterForm";

export const metadata: Metadata = {
  title: "Đăng ký tài khoản",
  description: "Tạo tài khoản khách hàng AgriMarket để mua nông sản và theo dõi đơn hàng.",
};

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <Container size={460} py="xl">
          <Skeleton height={520} radius="md" />
        </Container>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
