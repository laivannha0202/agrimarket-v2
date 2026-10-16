"use client";

/**
 * Truy xuất nguồn gốc — web twin of the Mobile trace tab.
 *
 * Layout follows the app: illustration card, a single code field with a clear
 * button, the primary "Tra cứu" CTA and the numbered quick guide.
 *
 * Two deliberate web differences, both about capability rather than style:
 * - There is no "Quét mã QR" button: a browser has no camera scanner in this
 *   build, so the code is typed or pasted (stated on screen so the omission is
 *   explicit, not an oversight).
 * - The input is validated with the shared `parseTraceCode` before navigating,
 *   so a malformed code never reaches the API and the 404 screen is reserved
 *   for codes the backend really does not know.
 */

import { ActionIcon, Button, Container, Group, Image, Stack, Text, TextInput } from "@mantine/core";
import { IconAlertCircle, IconCircleXFilled, IconInfoCircle, IconSearch } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseTraceCode } from "@/lib/trace-code";
import { AppCard } from "@/components/ui/kit";

const STEPS: { title: string; text: string }[] = [
  {
    title: "Nhập mã trên tem hoặc bao bì",
    text: "Mã in trên tem lô hàng, dạng TRC-000001-XXXX.",
  },
  {
    title: "Xem thông tin chi tiết",
    text: "Trang trại, mùa vụ, thu hoạch và kết quả kiểm định.",
  },
];

export function TraceLookup({ initialCode = "" }: { initialCode?: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    const parsed = parseTraceCode(code);
    if (!parsed) {
      setError("Mã truy xuất không hợp lệ. Mã có dạng TRC-000001-XXXX.");
      return;
    }
    setError(null);
    router.push(`/truy-xuat/${encodeURIComponent(parsed)}`);
  };

  return (
    <Container size={520} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 32 }}>
      <Stack gap={12}>
        {/* Illustration card — decorative art only, never evidence of a lookup. */}
        <AppCard
          padding={16}
          style={{ background: "var(--agri-primary-soft)", borderColor: "var(--agri-primary-border)" }}
        >
          <Stack align="center" gap={4}>
            <Image
              src="/design/trace/trace_scan_illustration_640x440.png"
              alt="Minh hoạ truy xuất nguồn gốc"
              w={168}
              h={116}
              fit="contain"
            />
            <Text fz={18} fw={700} c="var(--agri-text-strong)" ta="center">
              Truy xuất nguồn gốc
            </Text>
            <Text fz={13} lh="19px" c="var(--agri-muted)" ta="center">
              Kiểm tra xuất xứ, mùa vụ và kết quả kiểm định của sản phẩm trước khi sử dụng.
            </Text>
          </Stack>
        </AppCard>

        {/* Code entry */}
        <form onSubmit={submit}>
          <TextInput
            radius={999}
            size="md"
            value={code}
            onChange={(event) => {
              setCode(event.currentTarget.value);
              setError(null);
            }}
            leftSection={<IconSearch size={16} aria-hidden />}
            rightSection={
              code.length > 0 ? (
                <ActionIcon
                  variant="transparent"
                  color="gray"
                  onClick={() => {
                    setCode("");
                    setError(null);
                  }}
                  aria-label="Xoá mã"
                >
                  <IconCircleXFilled size={16} />
                </ActionIcon>
              ) : undefined
            }
            placeholder="TRC-000001-CACHU"
            aria-label="Mã truy xuất"
            autoCapitalize="characters"
            autoCorrect="off"
          />

          {error ? (
            <Group gap={6} align="flex-start" wrap="nowrap" mt={10}>
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
            mt={12}
            fullWidth
            styles={{ root: { minHeight: 48 }, label: { fontSize: 15, fontWeight: 700 } }}
          >
            Tra cứu
          </Button>
        </form>

        {/* Capability note: QR scanning exists in the app, not here. */}
        <Text fz={12} c="var(--agri-muted)" ta="center">
          Website tra cứu bằng cách nhập mã. Quét mã QR bằng camera có trên ứng dụng AgriMarket.
        </Text>

        {/* Guide */}
        <AppCard padding={16}>
          <Text fz={15} fw={700} c="var(--agri-text-strong)" mb={8}>
            Hướng dẫn nhanh
          </Text>
          <Stack gap={10}>
            {STEPS.map((step, index) => (
              <Group key={step.title} gap={8} align="flex-start" wrap="nowrap">
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    background: "var(--agri-primary-soft)",
                    color: "var(--agri-primary)",
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {index + 1}
                </div>
                <Stack gap={1} style={{ flex: 1 }}>
                  <Text fz={14} fw={600} lh="19px" c="var(--agri-text)">
                    {step.title}
                  </Text>
                  <Text fz={12.5} lh="18px" c="var(--agri-muted)">
                    {step.text}
                  </Text>
                </Stack>
              </Group>
            ))}
          </Stack>
        </AppCard>

        <Group gap={6} align="flex-start" wrap="nowrap" px={4}>
          <IconInfoCircle
            size={16}
            color="var(--agri-info)"
            style={{ flexShrink: 0, marginTop: 1 }}
            aria-hidden
          />
          <Text fz={12} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
            Hồ sơ truy xuất do AgriMarket cung cấp theo dữ liệu ghi nhận của đơn vị sản xuất.
            AgriMarket không tự xác minh ngoài thực địa.
          </Text>
        </Group>
      </Stack>
    </Container>
  );
}
