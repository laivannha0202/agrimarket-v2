"use client";

/**
 * Public product reviews.
 *
 * `GET /reviews/product/:id` already returns only APPROVED reviews, so no
 * client-side filtering hides anything: low ratings are shown exactly like high
 * ones. Ratings are never filtered, sorted away or suppressed.
 */

import { Divider, Group, Pagination, Rating, Skeleton, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDate } from "@/lib/format";
import { EmptyState, ErrorState } from "@/components/common/States";
import { EvidenceGallery } from "@/components/common/EvidenceGallery";
import { AppCard } from "@/components/ui/kit";

export function ProductReviews({ productId }: { productId: number }) {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.reviews.forProduct(productId, page),
    queryFn: () => resources.listProductReviews(productId, page, 10),
    placeholderData: (previous) => previous,
  });

  if (isLoading) {
    return (
      <Stack gap={8}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} height={72} radius={12} />
        ))}
      </Stack>
    );
  }

  if (isError) {
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  const reviews = data?.data ?? [];
  const totalPages = data?.meta.totalPages ?? 0;
  const total = data?.meta.total ?? 0;

  if (reviews.length === 0) {
    return (
      <EmptyState
        kind="search"
        title="Chưa có đánh giá"
        description="Sản phẩm này chưa có đánh giá nào được công khai."
      />
    );
  }

  return (
    <Stack gap={10}>
      <Text fz={13.5} fw={700} c="var(--agri-muted)">
        {total} đánh giá
      </Text>

      <Stack gap={8}>
        {reviews.map((review) => (
          <AppCard key={review.id} padding={12}>
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Text fz={13} fw={600} truncate>
                    {review.customer.fullName}
                  </Text>
                  <Rating value={review.rating} readOnly size="sm" />
                </Group>
                <Text fz={12} c="var(--agri-muted)" style={{ flexShrink: 0 }}>
                  {formatDate(review.createdAt)}
                </Text>
              </Group>
              {review.content ? (
                <Text fz={13} c="var(--agri-muted)" style={{ lineHeight: 1.45 }}>
                  {review.content}
                </Text>
              ) : null}
              {/**
               * Only APPROVED reviews reach this feed (the API filters by
               * status), so any photo shown here is already public by policy.
               */}
              <EvidenceGallery images={review.evidence} label="Ảnh từ người mua" />
            </Stack>
          </AppCard>
        ))}
      </Stack>

      {totalPages > 1 ? (
        <>
          <Divider />
          <Group justify="center">
            <Pagination size="sm" total={totalPages} value={page} onChange={setPage} />
          </Group>
        </>
      ) : null}
    </Stack>
  );
}
