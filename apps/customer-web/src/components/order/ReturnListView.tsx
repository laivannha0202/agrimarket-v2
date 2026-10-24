"use client";

/**
 * Trả hàng — web twin of the Mobile `returns` + `returns-new` screens.
 *
 * The app splits this into two screens; the web keeps both halves on one page
 * as tabs, with the same content and the same words:
 *
 *  - "Tạo yêu cầu trả hàng": the form. It offers exactly what the backend says
 *    can still be returned (`GET /returns/me/eligible-items`), where each row's
 *    `returnableQuantity` is the purchased quantity minus everything already
 *    tied up in active requests — the create call re-checks the same sum inside
 *    a transaction, so a customer can never promise the same unit twice.
 *
 *  - "Yêu cầu đã gửi": the customer's own requests (`GET /returns/me`,
 *    server-filtered by status), so they stay visible after a re-login.
 *
 * `?orderItemId=` preselects a line, the same deep link the Mobile app uses
 * when the order screen's "Trả hàng" button opens the form.
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
  TextInput,
  Textarea,
} from "@mantine/core";
import { IconAlertCircle, IconClock, IconCube, IconReceipt } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { returnStatusMeta } from "@/lib/status";
import { ProductImage } from "@/components/common/ProductImage";
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
  GhostButton,
  LoadingView,
  PageTitle,
  SelectCard,
} from "@/components/ui/kit";
import { layout } from "@/theme";
import type {
  EligibleReturnItem,
  ReturnRequest,
  ReturnRequestStatus,
} from "@/lib/api/types";

/**
 * Page size for "Xem thêm" lists. The backend's default is 20; the pickers keep
 * the previous 30-row first page so an existing deep link still resolves, then
 * load more on demand instead of truncating silently.
 */
const LIST_PAGE_SIZE = 20;
const ELIGIBLE_PAGE_SIZE = 30;

/** The Mobile status chips: "Tất cả" then every real backend status. */
const STATUS_FILTERS: Array<{ value: "ALL" | ReturnRequestStatus; label: string }> = [
  { value: "ALL", label: "Tất cả" },
  { value: "REQUESTED", label: returnStatusMeta("REQUESTED").label },
  { value: "APPROVED", label: returnStatusMeta("APPROVED").label },
  { value: "RETURNING", label: returnStatusMeta("RETURNING").label },
  { value: "RECEIVED", label: returnStatusMeta("RECEIVED").label },
  { value: "QC_PENDING", label: returnStatusMeta("QC_PENDING").label },
  { value: "REFUNDED", label: returnStatusMeta("REFUNDED").label },
  { value: "REJECTED", label: returnStatusMeta("REJECTED").label },
];

/** Muted inline error row (Mobile `errorRow`). */
function FormErrorRow({ message }: { message: string }) {
  return (
    <Group gap={6} align="flex-start" wrap="nowrap" mt={8}>
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

/**
 * One returnable line — a Mobile `SelectCard` row: thumbnail, product name,
 * what was bought and how much of it can still be returned.
 */
function EligibleRow({
  item,
  active,
  onClick,
}: {
  item: EligibleReturnItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <SelectCard active={active} onClick={onClick} ariaLabel={`Chọn ${item.productName}`}>
      <Group gap={8} align="center" wrap="nowrap">
        <Box w={48} style={{ flexShrink: 0 }}>
          <ProductImage src={item.imageUrl} alt={item.productName} ratio={1} radius={8} />
        </Box>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text fz={13.5} fw={600} lh="18px" c="var(--agri-text)" lineClamp={2}>
            {item.productName}
          </Text>
          <Text fz={12} lh="17px" c="var(--agri-muted)" mt={2}>
            {item.variantName} · đã mua {formatQuantity(item.purchasedQuantity)}
          </Text>
          <Text fz={12} lh="17px" c="var(--agri-muted)">
            Có thể trả {formatQuantity(item.returnableQuantity)} · Đơn {item.orderCode}
          </Text>
        </Box>
      </Group>
    </SelectCard>
  );
}

function ReturnCreateForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const presetId = Number(searchParams.get("orderItemId") ?? "");
  const hasPreset = Number.isFinite(presetId);

  const [pickedId, setPickedId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState<PickedEvidence[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const eligible = useInfiniteQuery({
    queryKey: queryKeys.returns.eligibleInfinite(ELIGIBLE_PAGE_SIZE),
    queryFn: ({ pageParam }) =>
      resources.listReturnableItems({ page: pageParam, limit: ELIGIBLE_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.totalPages ? lastPage.meta.page + 1 : undefined,
  });

  const returnable = eligible.data?.pages.flatMap((page) => page.data) ?? [];

  /**
   * The selected line is DERIVED, not stored: `explicit tap ?? deep link`.
   * The selection is always one of the rows actually on screen, so the
   * quantity cap always belongs to the row being shown.
   */
  const selected =
    returnable.find((item) => item.orderItemId === pickedId) ??
    (hasPreset ? (returnable.find((item) => item.orderItemId === presetId) ?? null) : null);

  const create = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Vui lòng chọn sản phẩm cần trả.");
      // Upload first: a failed photo means no request is created and the form
      // survives for a retry.
      const evidenceIds = await uploadEvidence(evidence, setEvidence, resources.uploadEvidence);
      return resources.createReturn({
        orderItemId: selected.orderItemId,
        quantity: Number(quantity),
        reason: reason.trim(),
        evidenceIds: evidenceIds.length > 0 ? evidenceIds : undefined,
      });
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.returns.all });
      // Mobile lands on the new request's detail; so does the web.
      router.push(`/tra-hang/${created.id}`);
    },
    onError: (err) => {
      setFormError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Gửi yêu cầu thất bại.",
      );
    },
  });

  /** Loaded before submit so the customer gets a clear message, same as Mobile. */
  const submitDisabledReason = (): string | null => {
    if (!selected) return "Hãy chọn một sản phẩm ở trên để tiếp tục.";
    if (reason.trim().length === 0) return "Hãy nhập lý do trả hàng để tiếp tục.";
    return null;
  };

  const submit = () => {
    setFormError(null);
    if (!selected) {
      setFormError("Vui lòng chọn sản phẩm cần trả.");
      return;
    }
    const requested = Number(quantity);
    const max = Number(selected.returnableQuantity);
    if (!Number.isFinite(requested) || requested <= 0) {
      setFormError("Số lượng trả phải lớn hơn 0.");
      return;
    }
    // Fast local check; the backend enforces the same bound on the live sum.
    if (requested > max) {
      setFormError(`Bạn chỉ có thể trả tối đa ${formatQuantity(selected.returnableQuantity)} cho sản phẩm này.`);
      return;
    }
    if (reason.trim().length === 0) {
      setFormError("Vui lòng nhập lý do trả hàng.");
      return;
    }
    create.mutate();
  };

  if (eligible.isPending) return <LoadingView label="Đang tải sản phẩm có thể trả…" />;
  if (eligible.isError) {
    return <ErrorState error={eligible.error} onRetry={() => eligible.refetch()} />;
  }

  if (returnable.length === 0) {
    return (
      <Text fz={12.5} lh="18px" c="var(--agri-muted)">
        Bạn chưa có sản phẩm nào có thể trả. Chỉ đơn đã giao và còn số lượng chưa yêu
        cầu trả mới hiển thị ở đây.
      </Text>
    );
  }

  const hint = submitDisabledReason();

  return (
    <Stack gap={0}>
      <Text fz={13} fw={600} c="var(--agri-text)" mb={4}>
        Chọn sản phẩm cần trả
      </Text>
      {returnable.map((item) => (
        <EligibleRow
          key={item.orderItemId}
          item={item}
          active={selected?.orderItemId === item.orderItemId}
          onClick={() => {
            setPickedId(item.orderItemId);
            setQuantity("1");
            setFormError(null);
          }}
        />
      ))}

      {hasPreset && !selected && eligible.hasNextPage ? (
        <Text fz={12.5} lh="18px" c="var(--agri-muted)" mt={4}>
          Sản phẩm từ liên kết chưa nằm trong danh sách đã tải. Bấm “Xem thêm” để tìm.
        </Text>
      ) : null}

      {eligible.hasNextPage ? (
        <GhostButton
          radius={8}
          size="md"
          mt={8}
          loading={eligible.isFetchingNextPage}
          onClick={() => eligible.fetchNextPage()}
          mx="auto"
          w="fit-content"
          styles={{ root: { minHeight: 44 }, label: { fontSize: 14, fontWeight: 700 } }}
        >
          Xem thêm
        </GhostButton>
      ) : null}

      {selected ? (
        <>
          <Text fz={13} fw={600} c="var(--agri-text)" mt={8} mb={4}>
            Số lượng trả (tối đa {formatQuantity(selected.returnableQuantity)})
          </Text>
          <TextInput
            value={quantity}
            onChange={(event) => setQuantity(event.currentTarget.value)}
            inputMode="decimal"
            placeholder="1"
            radius={8}
          />

          <Text fz={13} fw={600} c="var(--agri-text)" mt={12} mb={4}>
            Lý do
          </Text>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            placeholder="Mô tả tình trạng sản phẩm nhận được"
            autosize
            minRows={3}
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
          Chọn một sản phẩm ở trên để tạo yêu cầu trả.
        </Text>
      )}

      {formError ? <FormErrorRow message={formError} /> : null}

      <Button
        radius={8}
        mt={12}
        loading={create.isPending}
        onClick={submit}
        styles={{ root: { minHeight: 44 }, label: { fontSize: 14, fontWeight: 700 } }}
      >
        {create.isPending ? "Đang gửi…" : "Gửi yêu cầu"}
      </Button>
      {hint && !create.isPending ? (
        <Text fz={12.5} lh="18px" c="var(--agri-muted)" mt={8} ta="center">
          {hint}
        </Text>
      ) : null}
    </Stack>
  );
}

/** One submitted request — a Mobile `LinkPress` row. */
function ReturnRow({ record }: { record: ReturnRequest }) {
  const meta = returnStatusMeta(record.status);
  return (
    <AppCard component={Link} href={`/tra-hang/${record.id}`} className="agri-press">
      <Group justify="space-between" align="center" gap={8} wrap="nowrap">
        <Text fz={14} fw={700} c="var(--agri-text-strong)" truncate style={{ flex: 1 }}>
          Yêu cầu #{record.id}
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
        <IconCube size={14} color="var(--agri-muted-soft)" aria-hidden />
        <Text fz={13} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
          Số lượng {formatQuantity(record.quantity)}
        </Text>
      </Group>
      <Group gap={5} align="flex-start" wrap="nowrap" mt={3}>
        <IconClock size={14} color="var(--agri-muted-soft)" aria-hidden />
        <Text fz={13} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
          {formatDateTime(record.createdAt)}
        </Text>
      </Group>
      <Text fz={12.5} lh="18px" c="var(--agri-text)" mt={8} lineClamp={2} style={{ fontStyle: "italic" }}>
        {record.reason}
      </Text>
    </AppCard>
  );
}

function MyReturns({ onCreateNew }: { onCreateNew: () => void }) {
  const [statusFilter, setStatusFilter] = useState<"ALL" | ReturnRequestStatus>("ALL");

  const list = useInfiniteQuery({
    queryKey: queryKeys.returns.infinite(
      statusFilter === "ALL" ? undefined : statusFilter,
      LIST_PAGE_SIZE,
    ),
    queryFn: ({ pageParam }) =>
      resources.listMyReturns({
        page: pageParam,
        limit: LIST_PAGE_SIZE,
        status: statusFilter === "ALL" ? undefined : statusFilter,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.totalPages ? lastPage.meta.page + 1 : undefined,
  });

  const records = list.data?.pages.flatMap((page) => page.data) ?? [];
  const total = list.data?.pages[0]?.meta.total ?? 0;

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

      {list.isPending ? (
        <LoadingView label="Đang tải trả hàng…" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : records.length === 0 ? (
        <EmptyState
          kind="orders"
          title="Chưa có yêu cầu trả hàng"
          description="Yêu cầu trả hàng chỉ áp dụng cho đơn đã giao."
          action={
            <Button radius={8} onClick={onCreateNew}>
              Tạo yêu cầu mới
            </Button>
          }
        />
      ) : (
        <Stack gap={8}>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing={8} verticalSpacing={8}>
            {records.map((record) => (
              <ReturnRow key={record.id} record={record} />
            ))}
          </SimpleGrid>

          {list.hasNextPage ? (
            <GhostButton
              radius={8}
              size="md"
              loading={list.isFetchingNextPage}
              onClick={() => list.fetchNextPage()}
              mx="auto"
              w="fit-content"
              styles={{ root: { minHeight: 44 }, label: { fontSize: 14, fontWeight: 700 } }}
            >
              Xem thêm
            </GhostButton>
          ) : null}

          {total > records.length ? (
            <Text fz={12} c="var(--agri-muted)" ta="center">
              Hiển thị {records.length}/{total} yêu cầu trả hàng.
            </Text>
          ) : null}
        </Stack>
      )}
    </Stack>
  );
}

function ReturnListViewInner() {
  const [tab, setTab] = useState<string | null>("create");

  return (
    <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
      <PageTitle>Trả hàng</PageTitle>

      <Tabs
        value={tab}
        onChange={setTab}
        variant="pills"
        radius={8}
        mt={{ base: 0, md: 12 }}
        styles={{ tab: { fontWeight: 600 }, list: { flexWrap: "wrap" } }}
      >
        <Tabs.List>
          <Tabs.Tab value="create">Tạo yêu cầu trả hàng</Tabs.Tab>
          <Tabs.Tab value="submitted">Yêu cầu đã gửi</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="create" pt={12}>
          <AppCard padding={16}>
            <ReturnCreateForm />
          </AppCard>
        </Tabs.Panel>

        <Tabs.Panel value="submitted" pt={12}>
          <MyReturns onCreateNew={() => setTab("create")} />
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}

export function ReturnListView() {
  return (
    <Suspense
      fallback={
        <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
          <LoadingView />
        </Container>
      }
    >
      <ReturnListViewInner />
    </Suspense>
  );
}
