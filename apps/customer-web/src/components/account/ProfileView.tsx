"use client";

/**
 * Personal information.
 *
 * `PATCH /customers/me` updates the customer's own profile (`fullName`,
 * `phone`); the response is the safe projection the API returns, so the screen
 * only ever shows fields the backend actually owns. Email and account type are
 * read-only here because the backend does not let a customer change them.
 */

import {
  Alert,
  Avatar,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconLogout, IconPackage, IconUser } from "@tabler/icons-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { useAuth } from "@/lib/auth/useAuth";
import { AccountNav } from "@/components/account/AccountNav";
import { layout } from "@/theme";

const profileSchema = z.object({
  fullName: z.string().trim().min(1, "Vui lòng nhập họ và tên"),
  phone: z
    .string()
    .trim()
    .refine((value) => value === "" || value.length >= 8, "Số điện thoại chưa hợp lệ"),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export function ProfileView() {
  const { user, logout, refetch } = useAuth();
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: "", phone: "" },
  });

  // The profile is fetched by the auth provider; mirror it into the form.
  useEffect(() => {
    reset({ fullName: user?.fullName ?? "", phone: user?.phone ?? "" });
  }, [user?.fullName, user?.phone, reset]);

  const saveProfile = useMutation({
    mutationFn: (values: ProfileFormValues) =>
      resources.updateMyProfile({
        fullName: values.fullName,
        phone: values.phone || undefined,
      }),
    onSuccess: () => {
      setSaveError(null);
      queryClient.invalidateQueries({ queryKey: ["auth"] });
      refetch();
      notifications.show({
        title: "Đã lưu thông tin",
        message: "Thông tin cá nhân của bạn đã được cập nhật.",
        color: "agri",
      });
    },
    onError: (err) => {
      setSaveError(
        err instanceof ApiError ? err.message : "Không lưu được thông tin. Vui lòng thử lại.",
      );
    },
  });

  return (
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Stack gap={4}>
          <Title order={2}>Tài khoản của tôi</Title>
          <Text size="sm" c="dimmed">
            Thông tin tài khoản dùng để đăng nhập và nhận hàng trên AgriMarket.
          </Text>
        </Stack>

        <Group align="flex-start" gap="lg" wrap="wrap">
          <AccountNav />

          <Stack gap="md" style={{ flex: 1, minWidth: 300 }}>
            <Card padding="lg" radius="md" withBorder>
              <Stack gap="md">
                <Group gap="sm">
                  <IconUser size={18} color="var(--mantine-color-agri-8)" />
                  <Title order={4}>Thông tin cá nhân</Title>
                </Group>
                <Divider />

                <Group gap="md" wrap="nowrap">
                  <Avatar size={56} radius="xl" color="agri">
                    {user?.fullName?.trim().charAt(0).toUpperCase() ?? "?"}
                  </Avatar>
                  <Stack gap={2}>
                    <Text size="md" fw={600}>
                      {user?.fullName ?? "—"}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {user?.email ?? "—"}
                    </Text>
                  </Stack>
                </Group>

                <Divider />

                <form onSubmit={handleSubmit((values) => saveProfile.mutate(values))}>
                  <Stack gap="md">
                    {saveError ? (
                      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                        <Text size="sm">{saveError}</Text>
                      </Alert>
                    ) : null}

                    <TextInput
                      label="Họ và tên"
                      required
                      error={errors.fullName?.message}
                      {...register("fullName")}
                    />
                    <TextInput
                      label="Số điện thoại"
                      placeholder="Ví dụ: 0912345678"
                      error={errors.phone?.message}
                      {...register("phone")}
                    />
                    <TextInput
                      label="Email"
                      value={user?.email ?? ""}
                      readOnly
                      disabled
                      description="Email dùng để đăng nhập nên chưa thể thay đổi tại đây."
                    />

                    <Group justify="flex-end" gap="sm">
                      <Button
                        variant="default"
                        type="button"
                        disabled={!isDirty || saveProfile.isPending}
                        onClick={() => {
                          setSaveError(null);
                          reset({ fullName: user?.fullName ?? "", phone: user?.phone ?? "" });
                        }}
                      >
                        Hoàn tác
                      </Button>
                      <Button
                        type="submit"
                        loading={saveProfile.isPending}
                        disabled={!isDirty}
                      >
                        Lưu thay đổi
                      </Button>
                    </Group>
                  </Stack>
                </form>
              </Stack>
            </Card>

            <Card padding="lg" radius="md" withBorder>
              <Stack gap="md">
                <Title order={4}>Mua sắm & hỗ trợ</Title>
                <Divider />
                <Group gap="sm" wrap="wrap">
                  <Button
                    component={Link}
                    href="/don-hang"
                    variant="light"
                    size="sm"
                    leftSection={<IconPackage size={16} />}
                  >
                    Đơn hàng của tôi
                  </Button>
                  <Button
                    component={Link}
                    href="/tai-khoan/dia-chi"
                    variant="light"
                    size="sm"
                  >
                    Sổ địa chỉ
                  </Button>
                  <Button
                    variant="default"
                    color="red"
                    size="sm"
                    leftSection={<IconLogout size={16} />}
                    onClick={logout}
                  >
                    Đăng xuất
                  </Button>
                </Group>
              </Stack>
            </Card>
          </Stack>
        </Group>
      </Stack>
    </Container>
  );
}
