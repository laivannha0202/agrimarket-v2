"use client";

/**
 * Traceability lookup.
 *
 * Public endpoint: `GET /trace/:traceCode`. An unknown code returns 404 and is
 * rendered as "Không tìm thấy thông tin truy xuất" — never a crash and never a
 * raw HTTP code.
 */

import {
  Button,
  Card,
  Container,
  Stack,
  Text,
  TextInput,
  Title,
  Group,
  Alert,
} from "@mantine/core";
import { IconQrcode, IconSearch, IconInfoCircle } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function TraceLookup({ initialCode = "" }: { initialCode?: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    router.push(`/truy-xuat/${encodeURIComponent(trimmed)}`);
  };

  return (
    <Container size="sm" px={{ base: "md", sm: "lg" }} py={{ base: 32, sm: 48 }}>
      <Stack gap="lg">
        <Stack gap="xs" align="center">
          <IconQrcode size={40} color="var(--mantine-color-agri-8)" />
          <Title order={1} fz={{ base: 24, sm: 30 }} ta="center">
            Truy xuất nguồn gốc
          </Title>
          <Text size="sm" c="dimmed" ta="center">
            Nhập mã truy xuất in trên tem sản phẩm hoặc mã hiển thị trong chi tiết đơn
            hàng của bạn.
          </Text>
        </Stack>

        <Card padding="lg" radius="md" withBorder>
          <form onSubmit={submit}>
            <Stack gap="md">
              <TextInput
                label="Mã truy xuất"
                placeholder="Ví dụ: TRC-000001-CACHU"
                value={code}
                onChange={(event) => setCode(event.currentTarget.value)}
                size="md"
                autoFocus
                description="Mã không phân biệt khoảng trắng thừa ở đầu và cuối."
              />
              <Button
                type="submit"
                size="md"
                leftSection={<IconSearch size={18} />}
                disabled={code.trim().length === 0}
              >
                Tra cứu
              </Button>
            </Stack>
          </form>
        </Card>

        <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
          <Stack gap={4}>
            <Text size="sm" fw={600}>
              Mã truy xuất là gì?
            </Text>
            <Text size="xs">
              Mỗi lô hàng nông sản được gắn một mã truy xuất riêng. Mã này cho biết lô hàng
              thuộc vụ mùa nào, được trồng tại trang trại nào, kết quả kiểm định chất lượng
              và chứng nhận còn hiệu lực của trang trại.
            </Text>
          </Stack>
        </Alert>

        <Group justify="center">
          <Button variant="subtle" size="sm" onClick={() => router.push("/san-pham")}>
            Tiếp tục mua sắm
          </Button>
        </Group>
      </Stack>
    </Container>
  );
}
