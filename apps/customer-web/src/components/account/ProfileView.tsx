"use client";

/**
 * Tài khoản — web twin of the Mobile account tab.
 *
 * Layout follows the app: a centered profile header (initials avatar, name,
 * email, phone), a "Thông tin cá nhân" card, the grouped navigation (rendered
 * as the AccountNav sidebar on desktop) and a danger-styled logout row.
 *
 * `PATCH /customers/me` updates the customer's own profile (`fullName`,
 * `phone`); the response is the safe projection the API returns, so the screen
 * only ever shows fields the backend actually owns. Email and account type are
 * read-only here because the backend does not let a customer change them.
 */

import { Box, Button, Container, Group, Stack, Text, TextInput } from "@mantine/core";
import { IconAlertCircle, IconLogout, IconPackage } from "@tabler/icons-react";
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
import { AppCard, GhostButton, PageTitle } from "@/components/ui/kit";
import { layout } from "@/theme";

const profileSchema = z.object({
  fullName: z.string().trim().min(1, "Vui lòng nhập họ và tên"),
  phone: z
    .string()
    .trim()
    .refine((value) => value === "" || value.length >= 8, "Số điện thoại chưa hợp lệ"),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

/** Two-letter initials, exactly like the Mobile account header. */
function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text fz={15} fw={700} c="var(--agri-text-strong)" mb={8}>
      {children}
    </Text>
  );
}

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
    <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
      <PageTitle>Tài khoản</PageTitle>

      <Group align="flex-start" gap={16} wrap="wrap" mt={{ base: 0, md: 12 }}>
        <AccountNav />

        <Stack gap={12} style={{ flex: 1 }} miw={{ base: 0, md: 300 }}>
          {/* Profile header (Mobile styles.profile) */}
          <AppCard padding={16}>
            <Stack align="center" gap={3}>
              <Box
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 999,
                  background: "var(--agri-primary)",
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 6,
                }}
              >
                <Text fz={22} fw={700} c="#ffffff">
                  {user?.fullName ? initials(user.fullName) : "?"}
                </Text>
              </Box>
              <Text fz={18} fw={700} c="var(--agri-text-strong)" lineClamp={1}>
                {user?.fullName ?? "—"}
              </Text>
              <Text fz={13} c="var(--agri-muted)" lineClamp={1}>
                {user?.email ?? "—"}
              </Text>
              {user?.phone ? (
                <Text fz={13} c="var(--agri-muted)" lineClamp={1}>
                  {user.phone}
                </Text>
              ) : null}
            </Stack>
          </AppCard>

          {/* Editable profile */}
          <AppCard padding={16}>
            <SectionTitle>Thông tin cá nhân</SectionTitle>

            {saveError ? (
              <Group gap={6} align="flex-start" wrap="nowrap" mb={8}>
                <IconAlertCircle
                  size={15}
                  color="var(--agri-danger)"
                  style={{ flexShrink: 0, marginTop: 2 }}
                  aria-hidden
                />
                <Text fz={13} lh="18px" c="var(--agri-danger)" style={{ flex: 1 }}>
                  {saveError}
                </Text>
              </Group>
            ) : null}

            <form onSubmit={handleSubmit((values) => saveProfile.mutate(values))}>
              <Stack gap={12}>
                <TextInput
                  label="Họ và tên"
                  required
                  error={errors.fullName?.message}
                  size="md"
                  {...register("fullName")}
                />
                <TextInput
                  label="Số điện thoại"
                  placeholder="Ví dụ: 0912345678"
                  error={errors.phone?.message}
                  size="md"
                  {...register("phone")}
                />
                <TextInput
                  label="Email"
                  value={user?.email ?? ""}
                  readOnly
                  disabled
                  size="md"
                  description="Email dùng để đăng nhập nên chưa thể thay đổi tại đây."
                />

                <Group justify="flex-end" gap={8}>
                  <Button
                    variant="default"
                    type="button"
                    disabled={!isDirty || saveProfile.isPending}
                    radius={8}
                    styles={{ root: { minHeight: 44 }, label: { fontSize: 13.5, fontWeight: 700 } }}
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
                    radius={8}
                    styles={{ root: { minHeight: 44 }, label: { fontSize: 13.5, fontWeight: 700 } }}
                  >
                    Lưu thay đổi
                  </Button>
                </Group>
              </Stack>
            </form>
          </AppCard>

          {/* Shopping shortcuts */}
          <AppCard padding={16}>
            <SectionTitle>Mua sắm &amp; hỗ trợ</SectionTitle>
            <Group gap={8} wrap="wrap">
              <GhostButton
                component={Link}
                href="/don-hang"
                radius={8}
                leftSection={<IconPackage size={15} aria-hidden />}
                styles={{ root: { minHeight: 40 }, label: { fontSize: 13, fontWeight: 600 } }}
              >
                Đơn hàng của tôi
              </GhostButton>
              <GhostButton
                component={Link}
                href="/tai-khoan/dia-chi"
                radius={8}
                styles={{ root: { minHeight: 40 }, label: { fontSize: 13, fontWeight: 600 } }}
              >
                Địa chỉ giao hàng
              </GhostButton>
            </Group>

            {/* Mobile logout row: danger border, danger label, full width. */}
            <Button
              variant="default"
              fullWidth
              mt={16}
              leftSection={<IconLogout size={17} aria-hidden />}
              onClick={logout}
              radius={8}
              styles={{
                root: {
                  minHeight: 48,
                  borderColor: "var(--agri-danger)",
                  background: "var(--agri-surface)",
                },
                label: { color: "var(--agri-danger)", fontWeight: 700, fontSize: 14 },
              }}
            >
              Đăng xuất
            </Button>
          </AppCard>

          <Text fz={12} lh="17px" c="var(--agri-muted)" ta="center">
            Danh sách yêu thích và điểm thưởng chưa được backend V2 hỗ trợ nên không hiển thị
            trên website.
          </Text>
        </Stack>
      </Group>
    </Container>
  );
}
