"use client";

/**
 * Đổi mật khẩu — web twin of the Mobile change-password screen.
 *
 * Calls `PATCH /auth/change-password`, which re-verifies the current password
 * server-side — a stolen token alone is not enough to lock the owner out — and
 * stamps `passwordChangedAt`, invalidating every token issued earlier. The API
 * answers with a fresh token so THIS device stays signed in while any other
 * device is signed out; `adoptToken` stores it.
 *
 * The other-devices-signed-out consequence is stated up front, exactly as the
 * app's intro text does, because it is the visible effect of the invalidation.
 * Success is announced with the web's notification toast (same message as the
 * app's done screen) and the form is cleared, ready for another change.
 */

import {
  Button,
  Container,
  Group,
  PasswordInput,
  Stack,
  Text,
} from "@mantine/core";
import { IconAlertCircle, IconKey, IconLock, IconLockOpen } from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { notifications } from "@mantine/notifications";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { useAuth } from "@/lib/auth/useAuth";
import { AccountNav } from "@/components/account/AccountNav";
import { AppCard, PageTitle } from "@/components/ui/kit";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
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
        message: "Mật khẩu mới đã được lưu. Các thiết bị khác đang đăng nhập sẽ phải đăng nhập lại.",
        color: "agri",
      });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Không đổi được mật khẩu. Vui lòng thử lại.",
      );
    }
  };

  return (
    <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
      <PageTitle>Đổi mật khẩu</PageTitle>

      <Group align="flex-start" gap={16} wrap="wrap" mt={{ base: 0, md: 12 }}>
        <AccountNav />

        <Stack gap={12} style={{ flex: 1 }} miw={{ base: 0, md: 300 }}>
          <AppCard padding={16}>
            <Group gap={8} align="center" wrap="nowrap">
              <IconKey size={20} color="var(--agri-primary)" aria-hidden />
              <Text fz={16} fw={700} c="var(--agri-text-strong)">
                Đổi mật khẩu
              </Text>
            </Group>
            <Text fz={13} lh="19px" c="var(--agri-muted)" mt={6} mb={4}>
              Mật khẩu mới tối thiểu {PASSWORD_MIN_LENGTH} ký tự, có ít nhất 1 chữ cái và 1 chữ
              số và phải khác mật khẩu hiện tại. Sau khi đổi, các thiết bị khác sẽ phải đăng nhập
              lại.
            </Text>

            <form onSubmit={handleSubmit(submit)}>
              <Stack gap={12} mt={8}>
                <PasswordInput
                  label="Mật khẩu hiện tại"
                  placeholder="Nhập mật khẩu đang dùng"
                  leftSection={<IconLock size={16} aria-hidden />}
                  autoComplete="current-password"
                  error={errors.currentPassword?.message}
                  required
                  size="md"
                  {...register("currentPassword")}
                />
                <PasswordInput
                  label="Mật khẩu mới"
                  placeholder="••••••••••"
                  leftSection={<IconLockOpen size={16} aria-hidden />}
                  autoComplete="new-password"
                  error={errors.newPassword?.message}
                  required
                  size="md"
                  {...register("newPassword")}
                />
                <PasswordInput
                  label="Nhập lại mật khẩu mới"
                  placeholder="••••••••••"
                  leftSection={<IconLockOpen size={16} aria-hidden />}
                  autoComplete="new-password"
                  error={errors.confirmPassword?.message}
                  required
                  size="md"
                  {...register("confirmPassword")}
                />

                {error ? (
                  <Group gap={6} align="flex-start" wrap="nowrap">
                    <IconAlertCircle
                      size={15}
                      color="var(--agri-danger)"
                      style={{ flexShrink: 0, marginTop: 2 }}
                      aria-hidden
                    />
                    <Text fz={13} lh="18px" c="var(--agri-danger)" style={{ flex: 1 }}>
                      {error}
                    </Text>
                  </Group>
                ) : null}

                <Button
                  type="submit"
                  radius={8}
                  fullWidth
                  loading={isSubmitting}
                  styles={{ root: { minHeight: 48 }, label: { fontSize: 15, fontWeight: 700 } }}
                >
                  {isSubmitting ? "Đang lưu…" : "Đổi mật khẩu"}
                </Button>
              </Stack>
            </form>
          </AppCard>

          <Group justify="center">
            <Text component={Link} href="/quen-mat-khau" fz={13} fw={600} c="var(--agri-muted)">
              Quên mật khẩu hiện tại?
            </Text>
          </Group>
        </Stack>
      </Group>
    </Container>
  );
}
