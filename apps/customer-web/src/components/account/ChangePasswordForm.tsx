"use client";

/**
 * Change password (signed-in customer).
 *
 * Calls `PATCH /auth/change-password`, which re-verifies the current password
 * server-side — a stolen token alone is not enough to lock the owner out — and
 * stamps `passwordChangedAt`, invalidating every token issued earlier. The API
 * answers with a fresh token so THIS device stays signed in while any other
 * device is signed out; `adoptToken` stores it.
 *
 * The other-devices-signed-out consequence is stated on screen: it is the
 * visible effect of the invalidation, not an incidental detail.
 */

import {
  Alert,
  Button,
  Card,
  Container,
  Divider,
  Group,
  List,
  PasswordInput,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconKey, IconLock } from "@tabler/icons-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { notifications } from "@mantine/notifications";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { useAuth } from "@/lib/auth/useAuth";
import { AccountNav } from "@/components/account/AccountNav";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULES_TEXT,
} from "@/lib/auth/password-policy";
import { layout } from "@/theme";

const changeSchema = z
  .object({
    currentPassword: z.string().min(1, "Vui lòng nhập mật khẩu hiện tại"),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Mật khẩu phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`)
      .max(PASSWORD_MAX_LENGTH, `Mật khẩu tối đa ${PASSWORD_MAX_LENGTH} ký tự`)
      .regex(PASSWORD_PATTERN, "Mật khẩu phải có ít nhất 1 chữ cái và 1 chữ số"),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Mật khẩu nhập lại chưa khớp",
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    path: ["newPassword"],
    message: "Mật khẩu mới phải khác mật khẩu hiện tại",
  });

type ChangeFormValues = z.infer<typeof changeSchema>;

export function ChangePasswordForm() {
  const { adoptToken } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangeFormValues>({
    resolver: zodResolver(changeSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const submit = async (values: ChangeFormValues) => {
    setError(null);
    try {
      const result = await resources.changePassword(values.currentPassword, values.newPassword);
      // The old token is dead server-side; keep this device signed in.
      adoptToken(result.accessToken);
      reset({ currentPassword: "", newPassword: "", confirmPassword: "" });
      notifications.show({
        title: "Đã đổi mật khẩu",
        message: "Mật khẩu mới đã được lưu. Các thiết bị khác cần đăng nhập lại.",
        color: "agri",
      });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Không đổi được mật khẩu. Vui lòng thử lại.",
      );
    }
  };

  return (
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Stack gap={4}>
          <Title order={2}>Đổi mật khẩu</Title>
          <Text size="sm" c="dimmed">
            Cập nhật mật khẩu đăng nhập tài khoản khách hàng AgriMarket.
          </Text>
        </Stack>

        <Group align="flex-start" gap="lg">
          <AccountNav />

          <Stack gap="md" style={{ flex: 1, minWidth: 300 }}>
            <Card padding="lg" radius="md" withBorder>
              <Stack gap="md">
                <Group gap="sm">
                  <IconKey size={18} color="var(--mantine-color-agri-8)" />
                  <Title order={4}>Mật khẩu đăng nhập</Title>
                </Group>
                <Divider />

                <List size="xs" c="dimmed" spacing={2}>
                  <List.Item>{PASSWORD_RULES_TEXT}</List.Item>
                  <List.Item>Mật khẩu mới không được trùng mật khẩu hiện tại.</List.Item>
                  <List.Item>
                    Sau khi đổi, các thiết bị khác đang đăng nhập sẽ phải đăng nhập lại.
                  </List.Item>
                </List>

                {error ? (
                  <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                    <Text size="sm">{error}</Text>
                  </Alert>
                ) : null}

                <form onSubmit={handleSubmit(submit)}>
                  <Stack gap="md">
                    <PasswordInput
                      label="Mật khẩu hiện tại"
                      placeholder="Nhập mật khẩu đang dùng"
                      leftSection={<IconLock size={16} />}
                      autoComplete="current-password"
                      error={errors.currentPassword?.message}
                      required
                      {...register("currentPassword")}
                    />
                    <PasswordInput
                      label="Mật khẩu mới"
                      placeholder="Nhập mật khẩu mới"
                      leftSection={<IconLock size={16} />}
                      autoComplete="new-password"
                      error={errors.newPassword?.message}
                      required
                      {...register("newPassword")}
                    />
                    <PasswordInput
                      label="Nhập lại mật khẩu mới"
                      placeholder="Nhập lại mật khẩu mới"
                      leftSection={<IconLock size={16} />}
                      autoComplete="new-password"
                      error={errors.confirmPassword?.message}
                      required
                      {...register("confirmPassword")}
                    />
                    <Group justify="flex-end">
                      <Button type="submit" loading={isSubmitting}>
                        Đổi mật khẩu
                      </Button>
                    </Group>
                  </Stack>
                </form>
              </Stack>
            </Card>
          </Stack>
        </Group>
      </Stack>
    </Container>
  );
}
