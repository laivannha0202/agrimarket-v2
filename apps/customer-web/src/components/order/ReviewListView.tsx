"use client";

/**
 * Đánh giá của tôi — web twin of the Mobile `my-reviews` + `my-reviews-new`
 * screens.
 *
 * The app splits this into two screens; the web keeps both halves on one page
 * as tabs, with the same content and the same words:
 *
 *  - "Viết đánh giá": a form over `GET /reviews/me/eligible-items`. The backend
 *    decides eligibility (own DELIVERED item, not yet reviewed) and the create
 *    call re-checks all three conditions, so a stale list can only produce a
 *    clean business error — never a duplicate review.
 *
 *  - "Đánh giá của tôi": `GET /reviews/me` — the customer's own reviews with
 *    their real status (PENDING / APPROVED / HIDDEN), so the history survives
 *    a logout and a fresh login on another device.
 *
 * `?orderItemId=` preselects a line, the same deep link the Mobile app uses
 * when the order screen's "Đánh giá" button opens the form.
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
  UnstyledButton,
} from "@mantine/core";
import { IconAlertCircle, IconStar } from "@tabler/icons-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { ProductImage } from "@/components/common/ProductImage";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState, ErrorState } from "@/components/common/States";
import { EvidenceGallery } from "@/components/common/EvidenceGallery";
import {
  EvidencePicker,
  uploadEvidence,
  type PickedEvidence,
} from "@/components/common/EvidencePicker";
import { AppCard, LoadingView, PageTitle, SelectCard } from "@/components/ui/kit";
import { layout } from "@/theme";
import type { EligibleReviewItem, MyReview } from "@/lib/api/types";
import type { Tone } from "@/lib/status";

const FETCH_LIMIT = 100;

/** The backend offers at most 30 reviewable lines per page; one page is plenty. */
const ELIGIBLE_LIMIT = 30;

const REVIEW_STATUS_LABEL: Record<MyReview["status"], string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  HIDDEN: "Đã ẩn",
};

/** Mobile tone palette: approved = green, pending = yellow, hidden = gray. */
const REVIEW_STATUS_TONE: Record<MyReview["status"], Tone> = {
  APPROVED: "green",
  PENDING: "yellow",
  HIDDEN: "gray",
};

/** Read-only star row (Mobile review card). */
function StarsRow({ rating }: { rating: number }) {
  return (
    <Group gap={2} align="center" mt={4} wrap="nowrap">
      {[1, 2, 3, 4, 5].map((n) => (
        <IconStar
          key={n}
          size={13}
          aria-hidden
          color={n <= rating ? "var(--agri-warning)" : "var(--agri-muted-soft)"}
          fill={n <= rating ? "var(--agri-warning)" : "none"}
        />
      ))}
      <Text fz={12.5} fw={700} c="var(--agri-text)" ml={4}>
        {rating}/5
      </Text>
    </Group>
  );
}

/** One reviewable line — thumbnail, product, what was bought and when. */
function ReviewableRow({
  item,
  active,
  onClick,
}: {
  item: EligibleReviewItem;
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
            {item.variantName} · {formatQuantity(item.quantity)}
          </Text>
          <Text fz={12} lh="17px" c="var(--agri-muted)">
            Đơn {item.orderCode} · {formatDateTime(item.deliveredAt)}
          </Text>
        </Box>
      </Group>
    </SelectCard>
  );
}

/** One submitted review (Mobile review card). */
function MyReviewCard({ review }: { review: MyReview }) {
  return (
    <AppCard>
      <Group justify="space-between" align="flex-start" gap={8} wrap="nowrap">
        <Text fz={14} fw={700} lh="19px" c="var(--agri-text-strong)" lineClamp={2} style={{ flex: 1 }}>
          {review.product.name}
        </Text>
        <StatusBadge
          label={REVIEW_STATUS_LABEL[review.status]}
          tone={REVIEW_STATUS_TONE[review.status]}
        />
      </Group>
      <StarsRow rating={review.rating} />
      {review.content ? (
        <Text fz={13} lh="19px" c="var(--agri-text)" mt={8} style={{ whiteSpace: "pre-wrap" }}>
          {review.content}
        </Text>
      ) : null}
      {review.evidence && review.evidence.length > 0 ? (
        <Box mt={8}>
          <EvidenceGallery images={review.evidence} label="Ảnh đã gửi" thumbSize={56} />
        </Box>
      ) : null}
      <Text fz={12.5} c="var(--agri-muted)" mt={4}>
        {formatDateTime(review.createdAt)}
      </Text>
    </AppCard>
  );
}

function ReviewCreateForm({ onCreated }: { onCreated: () => void }) {
  const searchParams = useSearchParams();
  const presetId = Number(searchParams.get("orderItemId") ?? "");
  const hasPreset = Number.isFinite(presetId);

  const [pickedId, setPickedId] = useState<number | null>(null);
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState("");
  const [evidence, setEvidence] = useState<PickedEvidence[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const eligible = useQuery({
    queryKey: queryKeys.reviews.eligible(),
    queryFn: () => resources.listReviewableItems({ page: 1, limit: ELIGIBLE_LIMIT }),
  });

  /** `explicit tap ?? deep link` — always one of the rows actually on screen. */
  const selected =
    eligible.data?.data.find((item) => item.orderItemId === pickedId) ??
    (hasPreset
      ? (eligible.data?.data.find((item) => item.orderItemId === presetId) ?? null)
      : null);

  /** Object URLs of the picked photos, released once the review is sent. */
  const clearEvidence = () => {
    for (const item of evidence) URL.revokeObjectURL(item.previewUrl);
    setEvidence([]);
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Vui lòng chọn sản phẩm cần đánh giá.");
      // Upload first: a failed photo means no review is created and the form
      // survives for a retry.
      const evidenceIds = await uploadEvidence(evidence, setEvidence, resources.uploadEvidence);
      return resources.createReview({
        orderItemId: selected.orderItemId,
        rating,
        content: content.trim() || undefined,
        evidenceIds: evidenceIds.length > 0 ? evidenceIds : undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reviews.all });
      setContent("");
      setRating(5);
      setFormError(null);
      clearEvidence();
      onCreated();
    },
    onError: (err) => {
      setFormError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Gửi đánh giá thất bại.",
      );
    },
  });

  const submit = () => {
    setFormError(null);
    if (!selected) {
      setFormError("Vui lòng chọn sản phẩm cần đánh giá.");
      return;
    }
    create.mutate();
  };

  if (eligible.isPending) return <LoadingView label="Đang tải sản phẩm có thể đánh giá…" />;
  if (eligible.isError) {
    return <ErrorState error={eligible.error} onRetry={() => eligible.refetch()} />;
  }

  const reviewable = eligible.data.data;

  if (reviewable.length === 0) {
    return (
      <Text fz={12.5} lh="18px" c="var(--agri-muted)">
        Bạn chưa có sản phẩm nào cần đánh giá. Đánh giá mở khi đơn hàng đã được giao và sản
        phẩm chưa được đánh giá.
      </Text>
    );
  }

  return (
    <Stack gap={0}>
      <Text fz={13} fw={600} c="var(--agri-text)" mb={4}>
        Chọn sản phẩm đã mua
      </Text>
      {reviewable.map((item) => (
        <ReviewableRow
          key={item.orderItemId}
          item={item}
          active={selected?.orderItemId === item.orderItemId}
          onClick={() => {
            setPickedId(item.orderItemId);
            setFormError(null);
          }}
        />
      ))}

      {selected ? (
        <>
          <Text fz={13} fw={600} c="var(--agri-text)" mt={8} mb={4}>
            Điểm (1–5)
          </Text>
          <Group gap={8} align="center">
            {[1, 2, 3, 4, 5].map((star) => (
              <UnstyledButton
                key={star}
                onClick={() => setRating(star)}
                aria-label={`${star} sao`}
                aria-pressed={rating === star}
              >
                <IconStar
                  size={32}
                  aria-hidden
                  color={rating >= star ? "var(--agri-warning)" : "var(--agri-border-strong)"}
                  fill={rating >= star ? "var(--agri-warning)" : "none"}
                />
              </UnstyledButton>
            ))}
            <Text fz={12.5} fw={700} c="var(--agri-text)" ml={4}>
              {rating}/5
            </Text>
          </Group>

          <Text fz={13} fw={600} c="var(--agri-text)" mt={12} mb={4}>
            Nhận xét (tùy chọn)
          </Text>
          <Textarea
            value={content}
            onChange={(event) => setContent(event.currentTarget.value)}
            placeholder="Cảm nhận của bạn về sản phẩm"
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
          Chọn một sản phẩm ở trên để viết đánh giá.
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
        {create.isPending ? "Đang gửi…" : "Gửi đánh giá"}
      </Button>
      {!selected && !create.isPending ? (
        <Text fz={12.5} lh="18px" c="var(--agri-muted)" mt={8} ta="center">
          Hãy chọn một sản phẩm ở trên để tiếp tục.
        </Text>
      ) : null}
    </Stack>
  );
}

function ReviewListViewInner() {
  const [tab, setTab] = useState<string | null>("create");

  const eligibleQuery = useQuery({
    queryKey: queryKeys.reviews.eligible(),
    queryFn: () => resources.listReviewableItems({ page: 1, limit: ELIGIBLE_LIMIT }),
  });

  const reviewsQuery = useQuery({
    queryKey: queryKeys.reviews.mine(),
    queryFn: () => resources.listMyReviews({ page: 1, limit: FETCH_LIMIT }),
  });

  const pendingCount = eligibleQuery.data?.data.length ?? 0;
  const myReviews = reviewsQuery.data?.data ?? [];

  return (
    <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
      <PageTitle>Đánh giá của tôi</PageTitle>

      <Tabs
        value={tab}
        onChange={setTab}
        variant="pills"
        radius={8}
        mt={{ base: 0, md: 12 }}
        styles={{ tab: { fontWeight: 600 }, list: { flexWrap: "wrap" } }}
      >
        <Tabs.List>
          <Tabs.Tab value="create">
            Viết đánh giá{pendingCount > 0 ? ` (${pendingCount})` : ""}
          </Tabs.Tab>
          <Tabs.Tab value="done">
            Đánh giá của tôi{myReviews.length > 0 ? ` (${myReviews.length})` : ""}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="create" pt={12}>
          <AppCard padding={16}>
            <ReviewCreateForm onCreated={() => setTab("done")} />
          </AppCard>
        </Tabs.Panel>

        <Tabs.Panel value="done" pt={12}>
          {reviewsQuery.isPending ? (
            <LoadingView label="Đang tải đánh giá…" />
          ) : reviewsQuery.isError ? (
            <ErrorState error={reviewsQuery.error} onRetry={() => reviewsQuery.refetch()} />
          ) : myReviews.length === 0 ? (
            <EmptyState
              kind="orders"
              title="Chưa có đánh giá"
              description="Chỉ đơn đã giao mới được đánh giá."
              action={
                <Button radius={8} onClick={() => setTab("create")}>
                  Viết đánh giá mới
                </Button>
              }
            />
          ) : (
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing={8} verticalSpacing={8}>
              {myReviews.map((review) => (
                <MyReviewCard key={review.id} review={review} />
              ))}
            </SimpleGrid>
          )}
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}

export function ReviewListView() {
  return (
    <Suspense
      fallback={
        <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
          <LoadingView />
        </Container>
      }
    >
      <ReviewListViewInner />
    </Suspense>
  );
}
