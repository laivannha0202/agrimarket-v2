"use client";

/**
 * Forgot password.
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
 */

import {
  Alert,
  Button,
  Card,
  Container,
  Divider,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconInfoCircle, IconMailForward } from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";

const forgotSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email chưa hợp lệ"),
});

type ForgotFormValues = z.infer<typeof forgotSchema>;

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
    <Container size={460} px={{ base: "md", sm: "lg" }} py={{ base: 32, sm: 56 }}>
      <Card padding="lg" radius="md" withBorder>
        <Stack gap="md">
          <Stack gap={4} align="center">
            <IconMailForward size={30} color="var(--mantine-color-agri-8)" />
            <Title order={2} fz={24}>
              Quên mật khẩu
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              Nhập email đăng nhập, hệ thống sẽ gửi liên kết đặt lại mật khẩu.
            </Text>
          </Stack>

          <Divider />

          {sentTo ? (
            <Alert
              color={realDelivery ? "agri" : "orange"}
              variant="light"
              icon={<IconInfoCircle size={16} />}
              title={realDelivery ? "Đã gửi liên kết" : "Chưa cấu hình gửi email"}
            >
              <Stack gap={6}>
                <Text size="sm">
                  Nếu email <strong>{sentTo}</strong> có tài khoản AgriMarket, một liên kết đặt
                  lại mật khẩu đã được tạo. Liên kết chỉ dùng được một lần và hết hạn sau 60 phút.
                </Text>
                {realDelivery ? null : (
                  <Text size="sm">
                    Máy chủ hiện chưa cấu hình SMTP nên email <strong>chưa được gửi thật</strong>.
                    Vui lòng liên hệ AgriMarket để được hỗ trợ đặt lại mật khẩu.
                  </Text>
                )}
              </Stack>
            </Alert>
          ) : null}

          {error ? (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
              <Text size="sm">{error}</Text>
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit(submit)}>
            <Stack gap="md">
              <TextInput
                label="Email"
                placeholder="khachhang@agrimarket.vn"
                leftSection={<IconMailForward size={16} />}
                type="email"
                autoComplete="email"
                error={errors.email?.message}
                required
                size="md"
                {...register("email")}
              />
              <Button type="submit" size="md" fullWidth loading={isSubmitting}>
                Gửi liên kết đặt lại
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
