import type { Metadata } from "next";
import { Suspense } from "react";
import { Container, Skeleton } from "@mantine/core";
import { ResetPasswordTokenGate } from "@/components/auth/ResetPasswordTokenGate";

export const metadata: Metadata = {
  title: "Đặt lại mật khẩu",
  description: "Đặt mật khẩu mới cho tài khoản khách hàng AgriMarket.",
  // The page is reached from a one-time e-mail link; it must never be indexed
  // (the URL carries a single-use token).
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <Container size={460} py="xl">
          <Skeleton height={460} radius="md" />
        </Container>
      }
    >
      <ResetPasswordTokenGate />
    </Suspense>
  );
}
