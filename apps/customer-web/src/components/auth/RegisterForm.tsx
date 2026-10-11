"use client";

/**
 * Customer self-registration.
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
import { IconAlertCircle, IconCheck, IconLock, IconMail, IconPhone, IconUserPlus } from "@tabler/icons-react";
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

export function RegisterForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
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
      <Container size={460} px={{ base: "md", sm: "lg" }} py={{ base: 32, sm: 56 }}>
        <Card padding="lg" radius="md" withBorder>
          <Stack gap="md" align="center">
            <IconCheck size={30} color="var(--mantine-color-agri-8)" />
            <Title order={2} fz={22} ta="center">
              Đã tạo tài khoản
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              Tài khoản <strong>{createdEmail}</strong> đã được tạo. Vui lòng đăng nhập bằng
              mật khẩu bạn vừa đặt.
            </Text>
            <Button
              size="md"
              fullWidth
              onClick={() =>
                router.push(`/dang-nhap?email=${encodeURIComponent(createdEmail)}`)
              }
            >
              Đăng nhập ngay
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
            <IconUserPlus size={30} color="var(--mantine-color-agri-8)" />
            <Title order={2} fz={24}>
              Đăng ký tài khoản
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              Tạo tài khoản khách hàng AgriMarket để mua nông sản và theo dõi đơn hàng.
            </Text>
          </Stack>

          <Divider />

          {formError ? (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
              <Text size="sm">{formError}</Text>
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit(submit)}>
            <Stack gap="md">
              <TextInput
                label="Họ và tên"
                placeholder="Nguyễn Văn A"
                leftSection={<IconUserPlus size={16} />}
                error={errors.fullName?.message}
                autoComplete="name"
                required
                {...register("fullName")}
              />
              <TextInput
                label="Email"
                placeholder="khachhang@agrimarket.vn"
                leftSection={<IconMail size={16} />}
                type="email"
                autoComplete="email"
                error={errors.email?.message}
                required
                {...register("email")}
              />
              <TextInput
                label="Số điện thoại"
                placeholder="0912345678"
                leftSection={<IconPhone size={16} />}
                autoComplete="tel"
                error={errors.phone?.message}
                required
                {...register("phone")}
              />
              <PasswordInput
                label="Mật khẩu"
                placeholder="Nhập mật khẩu"
                leftSection={<IconLock size={16} />}
                autoComplete="new-password"
                description={`Tối thiểu ${PASSWORD_MIN_LENGTH} ký tự, có chữ và số.`}
                error={errors.password?.message}
                required
                {...register("password")}
              />
              <PasswordInput
                label="Nhập lại mật khẩu"
                placeholder="Nhập lại mật khẩu"
                leftSection={<IconLock size={16} />}
                autoComplete="new-password"
                error={errors.confirmPassword?.message}
                required
                {...register("confirmPassword")}
              />
              <Button type="submit" size="md" fullWidth>
                Tạo tài khoản
              </Button>
            </Stack>
          </form>

          <Group justify="center" gap={4}>
            <Text size="xs" c="dimmed">
              Đã có tài khoản?
            </Text>
            <Text component={Link} href="/dang-nhap" size="xs" fw={600} c="agri.8">
              Đăng nhập
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
