import type { Metadata } from "next";
import { Suspense } from "react";
import { Container, Skeleton } from "@mantine/core";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Đăng nhập",
  description: "Đăng nhập tài khoản khách hàng AgriMarket.",
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <Container size={460} py="xl">
          <Skeleton height={420} radius="md" />
        </Container>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
