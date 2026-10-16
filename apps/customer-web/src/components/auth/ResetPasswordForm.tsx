"use client";

/**
 * Đặt lại mật khẩu — web twin of the Mobile reset-password screen.
 *
 * The page the recovery e-mail links to carries `?token=…`; the raw value is the
 * ONLY thing that proves the request came from the mailbox owner, so it is sent
 * straight to `POST /auth/reset-password` and never stored locally. The backend
 * decides whether it is still valid (unused, unexpired) and answers the same
 * "invalid or expired" error for every failure mode, so this screen has exactly
 * one error branch to render.
 *
 * Like the app, the code is also an editable field: if the link does not open
 * by itself, the customer can paste the code from the e-mail — the URL value is
 * only the initial value.
 *
 * No session is issued: the customer is sent to the login screen and signs in
 * with the new password — the same single flow used after registration.
 */

import {
  Button,
  Container,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconAlertCircle, IconCircleCheck, IconKey, IconLink, IconLock } from "@tabler/icons-react";
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
import { AppCard, GhostButton } from "@/components/ui/kit";

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

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [code, setCode] = useState(token);
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
    if (!code.trim()) {
      setError("Vui lòng dán mã đặt lại trong email.");
      return;
    }
    try {
      await resources.resetPassword(code.trim(), values.password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Không đặt lại được mật khẩu. Vui lòng thử lại.",
      );
    }
  };

  if (done) {
    return (
      <Container size={460} px={{ base: 12, sm: "lg" }} py={{ base: 40, sm: 72 }}>
        <Stack align="center" gap={0}>
          <IconCircleCheck size={54} color="var(--agri-primary)" aria-hidden />
          <Text fz={20} fw={800} c="var(--agri-text-strong)" mt={8}>
            Đã đặt lại mật khẩu
          </Text>
          <Text fz={13.5} lh="19px" c="var(--agri-muted)" ta="center" mt={4}>
            Mật khẩu mới đã được lưu. Vui lòng đăng nhập lại.
          </Text>
          <Button
            radius={8}
            mt={20}
            fullWidth
            onClick={() => router.replace("/dang-nhap")}
            styles={{ root: { minHeight: 48 }, label: { fontSize: 15, fontWeight: 700 } }}
          >
            Đăng nhập
          </Button>
        </Stack>
      </Container>
    );
  }

  return (
    <Container size={460} px={{ base: 12, sm: "lg" }} py={{ base: 24, sm: 56 }}>
      <Stack gap={16}>
        <AppCard padding={16}>
          <Group gap={8} align="center" wrap="nowrap">
            <IconKey size={20} color="var(--agri-primary)" aria-hidden />
            <Text fz={16} fw={700} c="var(--agri-text-strong)">
              Đặt lại mật khẩu
            </Text>
          </Group>
          <Text fz={12.5} lh="18px" c="var(--agri-muted)" mt={6}>
            Dán mã trong liên kết đặt lại (hoặc mở liên kết từ email) rồi đặt mật khẩu mới.
          </Text>

          <form onSubmit={handleSubmit(submit)}>
            <TextInput
              mt={12}
              label="Mã đặt lại"
              placeholder="Dán mã trong email"
              value={code}
              onChange={(event) => {
                setCode(event.currentTarget.value);
                setError(null);
              }}
              leftSection={<IconLink size={16} aria-hidden />}
              autoCapitalize="none"
              autoCorrect="off"
              size="md"
            />
            <PasswordInput
              mt={12}
              label="Mật khẩu mới"
              placeholder="••••••••••"
              leftSection={<IconLock size={16} aria-hidden />}
              autoComplete="new-password"
              error={errors.password?.message}
              required
              size="md"
              {...register("password")}
            />
            <Text fz={12} c="var(--agri-muted)" mt={4}>
              {PASSWORD_RULES_TEXT}
            </Text>
            <PasswordInput
              mt={12}
              label="Nhập lại mật khẩu mới"
              placeholder="••••••••••"
              leftSection={<IconLock size={16} aria-hidden />}
              autoComplete="new-password"
              error={errors.confirmPassword?.message}
              required
              size="md"
              {...register("confirmPassword")}
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
              {isSubmitting ? "Đang lưu…" : "Đặt lại mật khẩu"}
            </Button>

            <GhostButton
              component={Link}
              href="/quen-mat-khau"
              radius={8}
              mt={8}
              fullWidth
              styles={{ root: { minHeight: 44 }, label: { fontSize: 13.5, fontWeight: 700 } }}
            >
              Yêu cầu liên kết mới
            </GhostButton>
          </form>
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
