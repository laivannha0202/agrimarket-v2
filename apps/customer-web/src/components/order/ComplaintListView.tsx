"use client";

/**
 * Khiếu nại — web twin of the Mobile `complaints` + `complaints-new` screens.
 *
 * The app splits this into two screens; the web keeps both halves on one page
 * as tabs, with the same content and the same words:
 *
 *  - "Gửi khiếu nại": the form. A complaint is always about an order the
 *    customer already has, so it lists their orders (`GET /orders/me`) and the
 *    optional product line is a picker over that order's own items — a line
 *    from a different order can never be attached.
 *
 *  - "Khiếu nại đã gửi": the customer's own complaints (`GET /complaints/me`,
 *    server-filtered by status), so they stay visible after a re-login.
 *
 * `?orderId=` preselects the order, the same deep link the Mobile app uses
 * when the order screen's "Khiếu nại về đơn này" button opens the form.
 */

import {
  Box,
  Button,
  Container,
  Group,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
} from "@mantine/core";
import { IconAlertCircle, IconClock, IconReceipt, IconTag } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { complaintStatusMeta, complaintTypeLabel, COMPLAINT_TYPE, orderStatusMeta } from "@/lib/status";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState, ErrorState } from "@/components/common/States";
import {
  EvidencePicker,
  uploadEvidence,
  type PickedEvidence,
} from "@/components/common/EvidencePicker";
import {
  AppCard,
  FilterChip,
  LoadingView,
  PageTitle,
  SelectCard,
} from "@/components/ui/kit";
import { layout } from "@/theme";
import type { Complaint, ComplaintStatus, Order } from "@/lib/api/types";

const FETCH_LIMIT = 100;

/**
 * Only the 30 most recent orders are offered: a complaint is about something
 * that just arrived, and paginating the picker would add a control the
 * customer does not need (same cap as the Mobile form).
 */
const ORDER_PICKER_LIMIT = 30;

const TYPE_VALUES: string[] = Object.keys(COMPLAINT_TYPE);

const STATUS_FILTERS: Array<{ value: "ALL" | ComplaintStatus; label: string }> = [
  { value: "ALL", label: "Tất cả" },
  { value: "OPEN", label: complaintStatusMeta("OPEN").label },
  { value: "PROCESSING", label: complaintStatusMeta("PROCESSING").label },
  { value: "RESOLVED", label: complaintStatusMeta("RESOLVED").label },
  { value: "REJECTED", label: complaintStatusMeta("REJECTED").label },
];

/** One selectable order — Mobile `styles.item` row with a status badge. */
function OrderPickerRow({
  order,
  active,
  onClick,
}: {
  order: Order;
  active: boolean;
  onClick: () => void;
}) {
  const meta = orderStatusMeta(order.status);
  return (
    <SelectCard active={active} onClick={onClick} ariaLabel={`Chọn đơn ${order.code}`}>
      <Text fz={13.5} fw={600} lh="18px" c="var(--agri-text)">
        Đơn {order.code}
      </Text>
      <Text fz={12} lh="17px" c="var(--agri-muted)" mt={2}>
        {formatMoney(order.grandTotal)} · {formatDateTime(order.createdAt)}
      </Text>
      <Box mt={4}>
        <StatusBadge label={meta.label} tone={meta.tone} />
      </Box>
    </SelectCard>
  );
}

function ComplaintCreateForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const presetId = Number(searchParams.get("orderId") ?? "");
  const hasPreset = Number.isFinite(presetId);

  const [pickedOrderId, setPickedOrderId] = useState<number | null>(null);
  const [orderItemId, setOrderItemId] = useState<number | null>(null);
  const [type, setType] = useState<string>("PRODUCT_QUALITY");
  const [content, setContent] = useState("");
  const [evidence, setEvidence] = useState<PickedEvidence[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const orders = useQuery({
    queryKey: queryKeys.orders.list({ page: 1, limit: ORDER_PICKER_LIMIT }),
    queryFn: () => resources.listMyOrders({ page: 1, limit: ORDER_PICKER_LIMIT }),
  });

  /** `explicit tap ?? deep link` — always an order the customer actually has. */
  const selected =
    orders.data?.data.find((order) => order.id === pickedOrderId) ??
    (hasPreset
      ? (orders.data?.data.find((order) => order.id === presetId) ?? null)
      : null);

  const create = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Vui lòng chọn đơn hàng cần khiếu nại.");
      // Upload first: a failed photo means no complaint is created and the
      // form survives for a retry.
      const evidenceIds = await uploadEvidence(evidence, setEvidence, resources.uploadEvidence);
      return resources.createComplaint({
        orderId: selected.id,
        orderItemId: orderItemId ?? undefined,
        type,
        content: content.trim(),
        evidenceIds: evidenceIds.length > 0 ? evidenceIds : undefined,
      });
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.complaints.all });
      // Mobile lands on the new complaint's detail; so does the web.
      router.push(`/khieu-nai/${created.id}`);
    },
    onError: (err) => {
      setFormError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Gửi khiếu nại thất bại.",
      );
    },
  });

  const submit = () => {
    setFormError(null);
    if (!selected) {
      setFormError("Vui lòng chọn đơn hàng cần khiếu nại.");
      return;
    }
    if (content.trim().length === 0) {
      setFormError("Vui lòng mô tả vấn đề bạn gặp phải.");
      return;
    }
    create.mutate();
  };

  if (orders.isPending) return <LoadingView label="Đang tải đơn hàng…" />;
  if (orders.isError) {
    return <ErrorState error={orders.error} onRetry={() => orders.refetch()} />;
  }

  const myOrders = orders.data.data;

  if (myOrders.length === 0) {
    return (
      <Text fz={12.5} lh="18px" c="var(--agri-muted)">
        Bạn chưa có đơn hàng nào để khiếu nại. Khiếu nại được gửi cho một đơn đã đặt.
      </Text>
    );
  }

  const items = selected?.partnerOrders.flatMap((partnerOrder) => partnerOrder.items) ?? [];
  const isComplete = selected !== null && content.trim().length > 0;

  return (
    <Stack gap={0}>
      <Text fz={13} fw={600} c="var(--agri-text)" mb={4}>
        Chọn đơn hàng
      </Text>
      {myOrders.map((order) => (
        <OrderPickerRow
          key={order.id}
          order={order}
          active={selected?.id === order.id}
          onClick={() => {
            setPickedOrderId(order.id);
            setOrderItemId(null);
            setFormError(null);
          }}
        />
      ))}

      {selected ? (
        <>
          {items.length > 0 ? (
            <>
              <Text fz={13} fw={600} c="var(--agri-text)" mt={8} mb={4}>
                Sản phẩm liên quan (không bắt buộc)
              </Text>
              <Text fz={12.5} lh="18px" c="var(--agri-muted)" mb={8}>
                Chọn một sản phẩm nếu khiếu nại chỉ về mặt hàng đó, hoặc để trống nếu vấn
                đề thuộc cả đơn.
              </Text>
              <SelectCard
                active={orderItemId === null}
                onClick={() => setOrderItemId(null)}
                ariaLabel="Cả đơn hàng"
              >
                <Text fz={13.5} fw={600} lh="18px" c="var(--agri-text)">
                  Cả đơn hàng
                </Text>
              </SelectCard>
              {items.map((item) => (
                <SelectCard
                  key={item.id}
                  active={orderItemId === item.id}
                  onClick={() => setOrderItemId(item.id)}
                  ariaLabel={`Chọn ${item.productNameSnapshot}`}
                >
                  <Text fz={13.5} fw={600} lh="18px" c="var(--agri-text)" lineClamp={2}>
                    {item.productNameSnapshot}
                  </Text>
                  <Text fz={12} lh="17px" c="var(--agri-muted)" mt={2}>
                    {item.skuSnapshot} · SL {formatQuantity(item.quantity)}
                  </Text>
                </SelectCard>
              ))}
            </>
          ) : null}

          <Text fz={13} fw={600} c="var(--agri-text)" mt={8} mb={4}>
            Loại khiếu nại
          </Text>
          <Group gap={8} wrap="wrap">
            {TYPE_VALUES.map((value) => (
              <FilterChip key={value} active={type === value} onClick={() => setType(value)}>
                {complaintTypeLabel(value)}
              </FilterChip>
            ))}
          </Group>

          <Text fz={13} fw={600} c="var(--agri-text)" mt={12} mb={4}>
            Nội dung
          </Text>
          <Textarea
            value={content}
            onChange={(event) => setContent(event.currentTarget.value)}
            placeholder="Mô tả vấn đề bạn gặp phải"
            autosize
            minRows={4}
            radius={8}
          />

          <Box mt={12}>
            <EvidencePicker
              items={evidence}
              onChange={setEvidence}
              disabled={create.isPending}
            />
          </Box>
        </>
      ) : (
        <Text fz={12.5} lh="18px" c="var(--agri-muted)" mt={4}>
          Chọn một đơn hàng ở trên để gửi khiếu nại.
        </Text>
      )}

      {formError ? (
        <Group gap={6} align="flex-start" wrap="nowrap" mt={8}>
          <IconAlertCircle
            size={15}
            color="var(--agri-danger)"
            style={{ flexShrink: 0, marginTop: 2 }}
            aria-hidden
          />
          <Text fz={13} lh="18px" c="var(--agri-danger)" style={{ flex: 1 }}>
            {formError}
          </Text>
        </Group>
      ) : null}

      <Button
        radius={8}
        mt={12}
        loading={create.isPending}
        onClick={submit}
        styles={{ root: { minHeight: 44 }, label: { fontSize: 14, fontWeight: 700 } }}
      >
        {create.isPending ? "Đang gửi…" : "Gửi khiếu nại"}
      </Button>
      {!isComplete && !create.isPending ? (
        <Text fz={12.5} lh="18px" c="var(--agri-muted)" mt={8} ta="center">
          {selected
            ? "Hãy mô tả vấn đề bạn gặp phải để tiếp tục."
            : "Hãy chọn một đơn hàng ở trên để tiếp tục."}
        </Text>
      ) : null}
    </Stack>
  );
}

/** One submitted complaint — a Mobile `LinkPress` row. */
function ComplaintRow({ record }: { record: Complaint }) {
  const meta = complaintStatusMeta(record.status);
  return (
    <AppCard component={Link} href={`/khieu-nai/${record.id}`} className="agri-press">
      <Group justify="space-between" align="center" gap={8} wrap="nowrap">
        <Text fz={14} fw={700} c="var(--agri-text-strong)" truncate style={{ flex: 1 }}>
          Khiếu nại #{record.id}
        </Text>
        <StatusBadge label={meta.label} tone={meta.tone} />
      </Group>
      <Group gap={5} align="flex-start" wrap="nowrap" mt={6}>
        <IconReceipt size={14} color="var(--agri-muted-soft)" aria-hidden />
        <Text fz={13} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
          Đơn {record.order?.code ?? `#${record.orderId}`}
        </Text>
      </Group>
      <Group gap={5} align="flex-start" wrap="nowrap" mt={3}>
        <IconTag size={14} color="var(--agri-muted-soft)" aria-hidden />
        <Text fz={13} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
          {complaintTypeLabel(record.type)}
        </Text>
      </Group>
      <Group gap={5} align="flex-start" wrap="nowrap" mt={3}>
        <IconClock size={14} color="var(--agri-muted-soft)" aria-hidden />
        <Text fz={13} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
          {formatDateTime(record.createdAt)}
        </Text>
      </Group>
      <Text fz={12.5} lh="18px" c="var(--agri-text)" mt={8} lineClamp={2} style={{ fontStyle: "italic" }}>
        {record.content}
      </Text>
    </AppCard>
  );
}

function MyComplaints({ onCreateNew }: { onCreateNew: () => void }) {
  const [statusFilter, setStatusFilter] = useState<"ALL" | ComplaintStatus>("ALL");

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.complaints.list({
      page: 1,
      limit: FETCH_LIMIT,
      status: statusFilter === "ALL" ? undefined : statusFilter,
    }),
    queryFn: () =>
      resources.listMyComplaints({
        page: 1,
        limit: FETCH_LIMIT,
        status: statusFilter === "ALL" ? undefined : statusFilter,
      }),
  });

  const records = data?.data ?? [];

  return (
    <Stack gap={8}>
      <Group gap={8} wrap="wrap">
        {STATUS_FILTERS.map((filter) => (
          <FilterChip
            key={filter.value}
            active={statusFilter === filter.value}
            onClick={() => setStatusFilter(filter.value)}
          >
            {filter.label}
          </FilterChip>
        ))}
      </Group>

      {isPending ? (
        <LoadingView label="Đang tải khiếu nại…" />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : records.length === 0 ? (
        <EmptyState
          kind="orders"
          title="Chưa có khiếu nại"
          description="Khiếu nại được xử lý theo quy trình của AgriMarket."
          action={
            <Button radius={8} onClick={onCreateNew}>
              Gửi khiếu nại mới
            </Button>
          }
        />
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={8} verticalSpacing={8}>
          {records.map((record) => (
            <ComplaintRow key={record.id} record={record} />
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}

function ComplaintListViewInner() {
  const [tab, setTab] = useState<string | null>("create");

  return (
    <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
      <PageTitle>Khiếu nại</PageTitle>

      <Tabs
        value={tab}
        onChange={setTab}
        variant="pills"
        radius={8}
        mt={{ base: 0, md: 12 }}
        styles={{ tab: { fontWeight: 600 }, list: { flexWrap: "wrap" } }}
      >
        <Tabs.List>
          <Tabs.Tab value="create">Gửi khiếu nại</Tabs.Tab>
          <Tabs.Tab value="submitted">Khiếu nại đã gửi</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="create" pt={12}>
          <AppCard padding={16}>
            <ComplaintCreateForm />
          </AppCard>
        </Tabs.Panel>

        <Tabs.Panel value="submitted" pt={12}>
          <MyComplaints onCreateNew={() => setTab("create")} />
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}

export function ComplaintListView() {
  return (
    <Suspense
      fallback={
        <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
          <LoadingView />
        </Container>
      }
    >
      <ComplaintListViewInner />
    </Suspense>
  );
}
