"use client";

/**
 * Đăng nhập — web twin of the Mobile login screen.
 *
 * Only a CUSTOMER session is allowed into the storefront. The backend accepts
 * any role here, so an admin is told so and the session is dropped — never
 * routed into a customer account area.
 *
 * The layout follows the Mobile screen: brand block (leaf mark, name, tagline),
 * one card with the two fields, the submit button and the "Quên mật khẩu?" link,
 * a full-width "Đăng ký ngay" row and the capability note about Google/Facebook.
 */

import {
  Box,
  Button,
  Container,
  Group,
  Image,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconChevronRight,
  IconInfoCircle,
  IconLock,
  IconMail,
  IconUserPlus,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/useAuth";
import { clearSession } from "@/lib/auth/session";
import { AppCard } from "@/components/ui/kit";

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

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();

  // `?email=` is how the register and forgot-password screens hand the address
  // back, so the customer does not retype it.
  const [email, setEmail] = useState(searchParams.get("email")?.trim() ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const next = searchParams.get("tiep-theo") ?? "/";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!email.trim() || !password) {
      setError("Vui lòng nhập email và mật khẩu.");
      return;
    }

    setSubmitting(true);
    try {
      const user = await login(email.trim(), password);

      // The backend accepts any role here, but the customer storefront is only
      // for CUSTOMER accounts. An admin is told so and the session is dropped —
      // never routed into a customer account area.
      if (user.role !== "CUSTOMER") {
        clearSession();
        setNotice(
          "Tài khoản này không phải tài khoản khách hàng. Vui lòng đăng nhập bằng tài khoản khách hàng để mua hàng.",
        );
        setSubmitting(false);
        return;
      }

      router.replace(next.startsWith("/") ? next : "/");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Không đăng nhập được. Vui lòng kiểm tra lại thông tin.",
      );
      setSubmitting(false);
    }
  };

  return (
    <Container size={460} px={{ base: 12, sm: "lg" }} py={{ base: 24, sm: 56 }}>
      <Stack gap={16}>
        {/* Brand block */}
        <Stack align="center" gap={2} mb={4}>
          <Image
            src="/design/brand/leaf_mark_512.png"
            alt="AgriMarket"
            w={64}
            h={64}
            fit="contain"
          />
          <Text fz={20} fw={800} c="var(--agri-text-strong)">
            AgriMarket
          </Text>
          <Text fz={13} c="var(--agri-muted)">
            Nông sản sạch, rõ nguồn gốc
          </Text>
        </Stack>

        <AppCard padding={16}>
          <form onSubmit={handleSubmit}>
            <Stack gap={0}>
              <TextInput
                label="Email"
                placeholder="khachhang@agrimarket.vn"
                value={email}
                onChange={(event) => {
                  setEmail(event.currentTarget.value);
                  setError(null);
                }}
                leftSection={<IconMail size={16} aria-hidden />}
                type="email"
                autoComplete="email"
                required
                size="md"
              />
              <PasswordInput
                mt={12}
                label="Mật khẩu"
                placeholder="••••••"
                value={password}
                onChange={(event) => {
                  setPassword(event.currentTarget.value);
                  setError(null);
                }}
                leftSection={<IconLock size={16} aria-hidden />}
                autoComplete="current-password"
                required
                size="md"
              />

              {notice ? (
                <Group
                  gap={6}
                  align="flex-start"
                  wrap="nowrap"
                  mt={10}
                  style={{
                    background: "var(--agri-warning-soft)",
                    border: "1px solid var(--agri-warning)",
                    borderRadius: 8,
                    padding: 8,
                  }}
                >
                  <IconAlertCircle
                    size={16}
                    color="var(--agri-warning)"
                    style={{ flexShrink: 0, marginTop: 1 }}
                    aria-hidden
                  />
                  <Text fz={12.5} lh="18px" style={{ flex: 1, color: "var(--agri-warning)" }}>
                    {notice}
                  </Text>
                </Group>
              ) : null}

              {error ? <ErrorRow message={error} /> : null}

              <Button
                type="submit"
                radius={8}
                mt={16}
                fullWidth
                loading={submitting}
                styles={{ root: { minHeight: 48 }, label: { fontSize: 15, fontWeight: 700 } }}
              >
                {submitting ? "Đang đăng nhập…" : "Đăng nhập"}
              </Button>

              <Group justify="center" mt={12}>
                <Text
                  component={Link}
                  href="/quen-mat-khau"
                  fz={13}
                  fw={700}
                  c="var(--agri-primary)"
                >
                  Quên mật khẩu?
                </Text>
              </Group>
            </Stack>
          </form>
        </AppCard>

        {/* Register entry — a full-width row, same as the Mobile registerBox. */}
        <AppCard component={Link} href="/dang-ky" padding={12} className="agri-press">
          <Group gap={8} align="center" wrap="nowrap">
            <IconUserPlus size={16} color="var(--agri-primary)" aria-hidden />
            <Text fz={13.5} fw={600} c="var(--agri-primary)" ta="center" style={{ flex: 1 }}>
              Chưa có tài khoản? Đăng ký ngay
            </Text>
            <IconChevronRight size={15} color="var(--agri-primary)" aria-hidden />
          </Group>
        </AppCard>

        {/* Capability disclosure — neither client has a Google/Facebook button
            because no OAuth endpoint exists behind it. */}
        <Group gap={6} align="flex-start" wrap="nowrap" px={4}>
          <Box component="span" style={{ flexShrink: 0, marginTop: 1 }}>
            <IconInfoCircle size={16} color="var(--agri-muted)" aria-hidden />
          </Box>
          <Text fz={12.5} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
            Website chưa hỗ trợ đăng nhập Google/Facebook. Tài khoản AgriMarket dùng chung cho
            ứng dụng và website.
          </Text>
        </Group>
      </Stack>
    </Container>
  );
}
