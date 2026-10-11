"use client";

/** Login. Only a CUSTOMER session is allowed into the storefront. */

import {
  Alert,
  Button,
  Card,
  Container,
  Divider,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconLock, IconMail } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/useAuth";
import { clearSession } from "@/lib/auth/session";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();

  // `?email=` is how the register and forgot-password screens hand the address
  // back, so the customer does not retype it.
  const [email, setEmail] = useState(searchParams.get("email")?.trim() ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const next = searchParams.get("tiep-theo") ?? "/";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!email.trim() || !password) {
      setError("Vui lòng nhập email và mật khẩu.");
      return;
    }

    setSubmitting(true);
    try {
      const user = await login(email.trim(), password);

      // The backend accepts any role here, but the customer storefront is only
      // for CUSTOMER accounts. An admin is told so and the session is dropped —
      // never routed into a customer account area.
      if (user.role !== "CUSTOMER") {
        clearSession();
        setNotice(
          "Tài khoản này không phải tài khoản khách hàng. Vui lòng đăng nhập bằng tài khoản khách hàng để mua hàng.",
        );
        setSubmitting(false);
        return;
      }

      router.replace(next.startsWith("/") ? next : "/");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Không đăng nhập được. Vui lòng kiểm tra lại thông tin.",
      );
      setSubmitting(false);
    }
  };

  return (
    <Container size={460} px={{ base: "md", sm: "lg" }} py={{ base: 32, sm: 56 }}>
      <Card padding="lg" radius="md" withBorder>
        <Stack gap="md">
          <Stack gap={4} align="center">
            <IconLock size={30} color="var(--mantine-color-agri-8)" />
            <Title order={2} fz={24}>
              Đăng nhập
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              Đăng nhập để mua nông sản, theo dõi đơn hàng và truy xuất nguồn gốc.
            </Text>
          </Stack>

          <Divider />

          {notice ? (
            <Alert color="orange" variant="light" icon={<IconAlertCircle size={16} />}>
              <Text size="sm">{notice}</Text>
            </Alert>
          ) : null}

          {error ? (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
              <Text size="sm">{error}</Text>
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <TextInput
                label="Email"
                placeholder="khachhang@agrimarket.vn"
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
                leftSection={<IconMail size={16} />}
                type="email"
                autoComplete="email"
                required
                size="md"
              />
              <PasswordInput
                label="Mật khẩu"
                placeholder="Nhập mật khẩu"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                autoComplete="current-password"
                required
                size="md"
              />
              <Group justify="flex-end">
                <Text component={Link} href="/quen-mat-khau" size="xs" fw={600} c="agri.8">
                  Quên mật khẩu?
                </Text>
              </Group>
              <Button type="submit" size="md" loading={submitting} fullWidth>
                Đăng nhập
              </Button>
            </Stack>
          </form>

          <Group justify="center" gap={4}>
            <Text size="xs" c="dimmed">
              Bạn chưa có tài khoản?
            </Text>
            <Text component={Link} href="/dang-ky" size="xs" fw={600} c="agri.8">
              Đăng ký ngay
            </Text>
          </Group>
          <Divider />
          <Button component={Link} href="/" variant="subtle" size="sm" fullWidth>
            Tiếp tục xem sản phẩm
          </Button>
        </Stack>
      </Card>
    </Container>
  );
}
