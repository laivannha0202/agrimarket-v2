"use client";

/**
 * Quên mật khẩu — web twin of the Mobile forgot-password screen.
 *
 * The response never reveals whether the address is registered — that is the
 * backend's anti-enumeration design (`AuthService.forgotPassword` returns the
 * same object on every path), and this screen must not undo it by, say,
 * reporting "email not found".
 *
 * `delivery.mode` is surfaced honestly: when the API runs on the `test`
 * transport (no SMTP configured) no e-mail actually leaves the server, so the
 * screen says so instead of claiming a message was sent. That distinction is
 * the whole reason the field exists.
 *
 * The second card is the Mobile "Đã có liên kết trong email?" block: the link
 * may not open the browser by itself, so the code can be pasted on the reset
 * screen instead.
 */

import {
  Button,
  Container,
  Group,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCircleCheck,
  IconInfoCircle,
  IconKey,
  IconMail,
} from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { AppCard, GhostButton } from "@/components/ui/kit";

const forgotSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email chưa hợp lệ"),
});

type ForgotFormValues = z.infer<typeof forgotSchema>;

/** Muted inline error row (Mobile `errorRow`). */
function ErrorRow({ message }: { message: string }) {
  return (
    <Group gap={6} align="flex-start" wrap="nowrap" mt={10}>
      <IconAlertCircle
        size={15}
        color="var(--agri-danger)"
        style={{ flexShrink: 0, marginTop: 2 }}
        aria-hidden
      />
      <Text fz={13} lh="18px" c="var(--agri-danger)" style={{ flex: 1 }}>
        {message}
      </Text>
    </Group>
  );
}

export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [realDelivery, setRealDelivery] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotFormValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  const submit = async (values: ForgotFormValues) => {
    setError(null);
    try {
      const result = await resources.forgotPassword(values.email);
      setSentTo(values.email);
      setRealDelivery(result.delivery.delivered);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Không gửi được yêu cầu. Vui lòng thử lại sau.",
      );
    }
  };

  return (
    <Container size={460} px={{ base: 12, sm: "lg" }} py={{ base: 24, sm: 56 }}>
      <Stack gap={16}>
        <AppCard padding={16}>
          <Group gap={8} align="center" wrap="nowrap">
            <IconMail size={20} color="var(--agri-primary)" aria-hidden />
            <Text fz={16} fw={700} c="var(--agri-text-strong)">
              Quên mật khẩu
            </Text>
          </Group>
          <Text fz={12.5} lh="18px" c="var(--agri-muted)" mt={6}>
            Nhập email đăng nhập, hệ thống sẽ gửi liên kết đặt lại mật khẩu. Liên kết chỉ dùng
            được một lần và hết hạn sau 60 phút.
          </Text>

          {sentTo ? (
            <Group
              gap={6}
              align="flex-start"
              wrap="nowrap"
              mt={10}
              style={{
                background: realDelivery ? "var(--agri-primary-soft)" : "var(--agri-warning-soft)",
                border: `1px solid ${realDelivery ? "var(--agri-primary-border)" : "var(--agri-warning)"}`,
                borderRadius: 8,
                padding: 8,
              }}
            >
              {realDelivery ? (
                <IconCircleCheck
                  size={17}
                  color="var(--agri-primary)"
                  style={{ flexShrink: 0, marginTop: 1 }}
                  aria-hidden
                />
              ) : (
                <IconInfoCircle
                  size={17}
                  color="var(--agri-warning)"
                  style={{ flexShrink: 0, marginTop: 1 }}
                  aria-hidden
                />
              )}
              <Stack gap={2} style={{ flex: 1 }}>
                <Text
                  fz={13.5}
                  fw={700}
                  c={realDelivery ? "var(--agri-primary)" : "var(--agri-warning)"}
                >
                  {realDelivery ? "Đã gửi liên kết" : "Chưa cấu hình gửi email"}
                </Text>
                <Text fz={12.5} lh="18px" c="var(--agri-muted)">
                  Nếu email {sentTo} có tài khoản AgriMarket, một liên kết đặt lại mật khẩu đã
                  được tạo.
                </Text>
                {realDelivery ? null : (
                  <Text fz={12.5} lh="18px" c="var(--agri-muted)">
                    Máy chủ hiện chưa cấu hình SMTP nên email chưa được gửi thật. Vui lòng liên
                    hệ AgriMarket để được hỗ trợ đặt lại mật khẩu.
                  </Text>
                )}
              </Stack>
            </Group>
          ) : null}

          <form onSubmit={handleSubmit(submit)}>
            <TextInput
              mt={12}
              label="Email"
              placeholder="khachhang@agrimarket.vn"
              leftSection={<IconMail size={16} aria-hidden />}
              type="email"
              autoComplete="email"
              error={errors.email?.message}
              required
              size="md"
              {...register("email")}
            />

            {error ? <ErrorRow message={error} /> : null}

            <Button
              type="submit"
              radius={8}
              mt={16}
              fullWidth
              loading={isSubmitting}
              styles={{ root: { minHeight: 48 }, label: { fontSize: 15, fontWeight: 700 } }}
            >
              {isSubmitting ? "Đang gửi…" : "Gửi liên kết đặt lại"}
            </Button>
          </form>
        </AppCard>

        <AppCard padding={16}>
          <Text fz={16} fw={700} c="var(--agri-text-strong)">
            Đã có liên kết trong email?
          </Text>
          <Text fz={12.5} lh="18px" c="var(--agri-muted)" mt={6}>
            Mở liên kết trong email để đặt mật khẩu mới. Nếu liên kết không tự mở, hãy dán mã
            trong email vào trang đặt lại mật khẩu.
          </Text>
          <GhostButton
            component={Link}
            href="/dat-lai-mat-khau"
            radius={8}
            mt={12}
            fullWidth
            leftSection={<IconKey size={15} aria-hidden />}
            styles={{ root: { minHeight: 44 }, label: { fontSize: 13.5, fontWeight: 700 } }}
          >
            Nhập mã đặt lại
          </GhostButton>
        </AppCard>

        <Group justify="center">
          <Text component={Link} href="/dang-nhap" fz={13} fw={600} c="var(--agri-muted)">
            Quay lại đăng nhập
          </Text>
        </Group>
      </Stack>
    </Container>
  );
}
