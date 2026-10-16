"use client";

/**
 * Đăng ký tài khoản — web twin of the Mobile register screen.
 *
 * One account system for Web and Mobile: this form posts to the same
 * `POST /auth/register` the app uses, and the resulting account signs in on
 * either client. The backend hardcodes the CUSTOMER role — the request DTO has
 * no role field and the global validation pipe rejects unknown properties, so a
 * forged `role: "ADMIN"` is a 400 rather than a privilege escalation.
 *
 * No session is issued by design: registration returns to the login screen, so
 * both clients have exactly one way to obtain a token.
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
import {
  IconAlertCircle,
  IconCircleCheck,
  IconLock,
  IconMail,
  IconPhone,
  IconUser,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_PATTERN } from "@/lib/auth/password-policy";
import { isValidVietnamesePhone } from "@/lib/phone";
import { AppCard, GhostButton } from "@/components/ui/kit";

const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, "Vui lòng nhập họ và tên"),
    email: z.string().trim().toLowerCase().email("Email chưa hợp lệ"),
    // The API only accepts a Vietnamese mobile number (see `lib/phone.ts`, a
    // port of the backend rule). Checking it here — not just length — means the
    // customer is told the field is wrong instead of the server answering 400.
    phone: z
      .string()
      .trim()
      .refine((value) => isValidVietnamesePhone(value), "Số điện thoại chưa hợp lệ"),
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

type RegisterFormValues = z.infer<typeof registerSchema>;

/**
 * Which register field a backend error belongs to, or `null` when it cannot be
 * determined (a forged `role`, a 500, an unmapped string). Mirrors the mobile
 * `mapRegisterFieldErrors`: recognised business messages and `class-validator`
 * property prefixes map to a field; everything else stays a form-level banner so
 * no internal/technical text is ever pinned to an input.
 */
function webFieldForBackendMessage(message: string | string[] | undefined) {
  const list = Array.isArray(message) ? message : message ? [message] : [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const text = raw.trim();
    if (/^fullName\b|Vui lòng nhập họ và tên/.test(text)) return "fullName" as const;
    if (/^email\b|Email chưa hợp lệ|Email này đã được đăng ký/.test(text)) return "email" as const;
    if (/^phone\b|Số điện thoại chưa hợp lệ/.test(text)) return "phone" as const;
    if (/^password\b|Mật khẩu/.test(text)) return "password" as const;
  }
  return null;
}

/** The safe Vietnamese wording to show under the matched field. */
function webFieldMessage(
  field: "fullName" | "email" | "phone" | "password",
  message: string | string[] | undefined,
): string {
  const list = Array.isArray(message) ? message : message ? [message] : [];
  const text = list.find((m) => typeof m === "string")?.trim() ?? "";
  // The duplicate-e-mail business message is already safe and specific; show it.
  if (text === "Email này đã được đăng ký") return text;
  switch (field) {
    case "fullName":
      return "Vui lòng nhập họ và tên";
    case "email":
      return "Email chưa hợp lệ";
    case "phone":
      return "Số điện thoại chưa hợp lệ";
    case "password":
      return "Mật khẩu phải có ít nhất 1 chữ cái và 1 chữ số";
  }
}

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

export function RegisterForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: "", email: "", phone: "", password: "", confirmPassword: "" },
  });

  const submit = async (values: RegisterFormValues) => {
    setFormError(null);
    try {
      const created = await resources.register({
        fullName: values.fullName,
        email: values.email,
        phone: values.phone,
        password: values.password,
      });
      setCreatedEmail(created.email);
    } catch (err) {
      if (err instanceof ApiError) {
        // The form already validated, so a 400/409 here is a race (another
        // device just took the e-mail) or a server-only rule. Put the backend
        // message under the field it belongs to instead of one generic banner;
        // only fall back to the banner when the field cannot be determined.
        const field = webFieldForBackendMessage(err.body?.message);
        if (field) {
          setError(field, { message: webFieldMessage(field, err.body?.message) });
          return;
        }
      }
      setFormError(
        err instanceof ApiError
          ? err.message
          : "Không đăng ký được tài khoản. Vui lòng thử lại.",
      );
    }
  };

  if (createdEmail) {
    return (
      <Container size={460} px={{ base: 12, sm: "lg" }} py={{ base: 40, sm: 72 }}>
        <Stack align="center" gap={0}>
          <IconCircleCheck size={54} color="var(--agri-primary)" aria-hidden />
          <Text fz={20} fw={800} c="var(--agri-text-strong)" mt={8}>
            Đã tạo tài khoản
          </Text>
          <Text fz={13.5} lh="19px" c="var(--agri-muted)" ta="center" mt={4}>
            Tài khoản {createdEmail} đã được tạo. Vui lòng đăng nhập bằng mật khẩu bạn vừa đặt.
          </Text>

          <Button
            radius={8}
            mt={20}
            fullWidth
            onClick={() => router.replace(`/dang-nhap?email=${encodeURIComponent(createdEmail)}`)}
            styles={{ root: { minHeight: 48 }, label: { fontSize: 15, fontWeight: 700 } }}
          >
            Đăng nhập ngay
          </Button>
          <GhostButton
            component={Link}
            href="/"
            radius={8}
            mt={8}
            fullWidth
            styles={{ root: { minHeight: 48 }, label: { fontSize: 14, fontWeight: 700 } }}
          >
            Về trang chủ
          </GhostButton>
        </Stack>
      </Container>
    );
  }

  return (
    <Container size={460} px={{ base: 12, sm: "lg" }} py={{ base: 24, sm: 56 }}>
      <Stack gap={16}>
        <Stack gap={2}>
          <Text fz={20} fw={800} c="var(--agri-text-strong)">
            Tạo tài khoản
          </Text>
          <Text fz={13} c="var(--agri-muted)">
            Dùng chung cho ứng dụng và website AgriMarket.
          </Text>
        </Stack>

        <AppCard padding={16}>
          <form onSubmit={handleSubmit(submit)}>
            <Stack gap={0}>
              <TextInput
                label="Họ và tên"
                placeholder="Nguyễn Văn A"
                leftSection={<IconUser size={16} aria-hidden />}
                error={errors.fullName?.message}
                autoComplete="name"
                required
                size="md"
                {...register("fullName")}
              />
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
              <TextInput
                mt={12}
                label="Số điện thoại"
                placeholder="0912345678"
                leftSection={<IconPhone size={16} aria-hidden />}
                autoComplete="tel"
                error={errors.phone?.message}
                required
                size="md"
                {...register("phone")}
              />
              <PasswordInput
                mt={12}
                label="Mật khẩu"
                placeholder={`Tối thiểu ${PASSWORD_MIN_LENGTH} ký tự`}
                leftSection={<IconLock size={16} aria-hidden />}
                autoComplete="new-password"
                error={errors.password?.message}
                required
                size="md"
                {...register("password")}
              />
              <PasswordInput
                mt={12}
                label="Nhập lại mật khẩu"
                placeholder="Nhập lại mật khẩu"
                leftSection={<IconLock size={16} aria-hidden />}
                autoComplete="new-password"
                error={errors.confirmPassword?.message}
                required
                size="md"
                {...register("confirmPassword")}
              />

              {formError ? <ErrorRow message={formError} /> : null}

              <Button
                type="submit"
                radius={8}
                mt={16}
                fullWidth
                loading={isSubmitting}
                styles={{ root: { minHeight: 48 }, label: { fontSize: 15, fontWeight: 700 } }}
              >
                Đăng ký
              </Button>
            </Stack>
          </form>
        </AppCard>

        <Group justify="center" gap={4}>
          <Text fz={13} c="var(--agri-muted)">
            Đã có tài khoản?
          </Text>
          <Text component={Link} href="/dang-nhap" fz={13} fw={700} c="var(--agri-primary)">
            Đăng nhập
          </Text>
        </Group>
      </Stack>
    </Container>
  );
}
