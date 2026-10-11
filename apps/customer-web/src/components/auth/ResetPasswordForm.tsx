"use client";

/**
 * Reset password — the page the recovery e-mail links to.
 *
 * The link carries `?token=…`; the raw value is the ONLY thing that proves the
 * request came from the mailbox owner, so it is sent straight to
 * `POST /auth/reset-password` and never stored locally. The backend decides
 * whether it is still valid (unused, unexpired) and answers the same
 * "invalid or expired" error for every failure mode, so this screen has exactly
 * one error branch to render.
 *
 * No session is issued: the customer is sent to the login screen and signs in
 * with the new password — the same single flow used after registration.
 */

import {
  Alert,
  Button,
  Card,
  Container,
  Divider,
  List,
  PasswordInput,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconKey, IconLock } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULES_TEXT,
} from "@/lib/auth/password-policy";

const resetSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Mật khẩu phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`)
      .max(PASSWORD_MAX_LENGTH, `Mật khẩu tối đa ${PASSWORD_MAX_LENGTH} ký tự`)
      .regex(PASSWORD_PATTERN, "Mật khẩu phải có ít nhất 1 chữ cái và 1 chữ số"),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Mật khẩu nhập lại chưa khớp",
  });

type ResetFormValues = z.infer<typeof resetSchema>;

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const submit = async (values: ResetFormValues) => {
    setError(null);
    try {
      await resources.resetPassword(token, values.password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Không đặt lại được mật khẩu. Vui lòng thử lại.",
      );
    }
  };

  // A link without a token cannot be completed; the customer is told to request
  // a new one rather than being shown a form that is guaranteed to fail.
  if (!token) {
    return (
      <Container size={460} px={{ base: "md", sm: "lg" }} py={{ base: 32, sm: 56 }}>
        <Card padding="lg" radius="md" withBorder>
          <Stack gap="md">
            <Stack gap={4} align="center">
              <IconAlertCircle size={30} color="var(--mantine-color-orange-7)" />
              <Title order={2} fz={22} ta="center">
                Liên kết chưa đầy đủ
              </Title>
            </Stack>
            <Divider />
            <Text size="sm" c="dimmed" ta="center">
              Liên kết đặt lại mật khẩu không có mã xác nhận. Vui lòng mở lại liên kết
              trong email hoặc yêu cầu gửi liên kết mới.
            </Text>
            <Button component={Link} href="/quen-mat-khau" size="md" fullWidth>
              Yêu cầu liên kết mới
            </Button>
            <Button component={Link} href="/dang-nhap" variant="subtle" size="sm" fullWidth>
              Quay lại đăng nhập
            </Button>
          </Stack>
        </Card>
      </Container>
    );
  }

  if (done) {
    return (
      <Container size={460} px={{ base: "md", sm: "lg" }} py={{ base: 32, sm: 56 }}>
        <Card padding="lg" radius="md" withBorder>
          <Stack gap="md" align="center">
            <IconCheck size={30} color="var(--mantine-color-agri-8)" />
            <Title order={2} fz={22} ta="center">
              Đã đặt lại mật khẩu
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              Mật khẩu mới đã được lưu. Vui lòng đăng nhập lại bằng mật khẩu vừa đặt.
            </Text>
            <Button size="md" fullWidth onClick={() => router.push("/dang-nhap")}>
              Đăng nhập
            </Button>
            <Button component={Link} href="/" variant="subtle" size="sm" fullWidth>
              Tiếp tục xem sản phẩm
            </Button>
          </Stack>
        </Card>
      </Container>
    );
  }

  return (
    <Container size={460} px={{ base: "md", sm: "lg" }} py={{ base: 32, sm: 56 }}>
      <Card padding="lg" radius="md" withBorder>
        <Stack gap="md">
          <Stack gap={4} align="center">
            <IconKey size={30} color="var(--mantine-color-agri-8)" />
            <Title order={2} fz={24}>
              Đặt lại mật khẩu
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              Nhập mật khẩu mới cho tài khoản AgriMarket của bạn.
            </Text>
          </Stack>

          <Divider />

          {error ? (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
              <Stack gap={6}>
                <Text size="sm">{error}</Text>
                <Text component={Link} href="/quen-mat-khau" size="sm" fw={600}>
                  Yêu cầu liên kết đặt lại mới
                </Text>
              </Stack>
            </Alert>
          ) : null}

          <List size="xs" c="dimmed" spacing={2}>
            <List.Item>{PASSWORD_RULES_TEXT}</List.Item>
          </List>

          <form onSubmit={handleSubmit(submit)}>
            <Stack gap="md">
              <PasswordInput
                label="Mật khẩu mới"
                placeholder="Nhập mật khẩu mới"
                leftSection={<IconLock size={16} />}
                autoComplete="new-password"
                error={errors.password?.message}
                required
                size="md"
                {...register("password")}
              />
              <PasswordInput
                label="Nhập lại mật khẩu mới"
                placeholder="Nhập lại mật khẩu mới"
                leftSection={<IconLock size={16} />}
                autoComplete="new-password"
                error={errors.confirmPassword?.message}
                required
                size="md"
                {...register("confirmPassword")}
              />
              <Button type="submit" size="md" fullWidth loading={isSubmitting}>
                Đặt lại mật khẩu
              </Button>
            </Stack>
          </form>

          <Divider />
          <Button component={Link} href="/dang-nhap" variant="subtle" size="sm" fullWidth>
            Quay lại đăng nhập
          </Button>
        </Stack>
      </Card>
    </Container>
  );
}
