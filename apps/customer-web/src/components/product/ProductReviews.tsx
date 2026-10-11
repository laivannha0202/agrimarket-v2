"use client";

/**
 * Public product reviews.
 *
 * `GET /reviews/product/:id` already returns only APPROVED reviews, so no
 * client-side filtering hides anything: low ratings are shown exactly like high
 * ones. Ratings are never filtered, sorted away or suppressed.
 */

import { Card, Divider, Group, Pagination, Rating, Skeleton, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDate } from "@/lib/format";
import { EmptyState, ErrorState } from "@/components/common/States";
import { EvidenceGallery } from "@/components/common/EvidenceGallery";

export function ProductReviews({ productId }: { productId: number }) {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.reviews.forProduct(productId, page),
    queryFn: () => resources.listProductReviews(productId, page, 10),
    placeholderData: (previous) => previous,
  });

  if (isLoading) {
    return (
      <Stack gap="sm">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} height={80} radius="md" />
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
        title="Chưa có đánh giá"
        description="Sản phẩm này chưa có đánh giá nào được công khai."
      />
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text fw={600}>{total} đánh giá</Text>
      </Group>

      <Stack gap="sm">
        {reviews.map((review) => (
          <Card key={review.id} padding="md" radius="md" withBorder>
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap">
                <Group gap="sm">
                  <Text size="sm" fw={600}>
                    {review.customer.fullName}
                  </Text>
                  <Rating value={review.rating} readOnly size="sm" />
                </Group>
                <Text size="xs" c="dimmed">
                  {formatDate(review.createdAt)}
                </Text>
              </Group>
              {review.content ? <Text size="sm">{review.content}</Text> : null}
              {/**
               * Only APPROVED reviews reach this feed (the API filters by
               * status), so any photo shown here is already public by policy.
               */}
              <EvidenceGallery images={review.evidence} label="Ảnh từ người mua" />
            </Stack>
          </Card>
        ))}
      </Stack>

      {totalPages > 1 ? (
        <>
          <Divider />
          <Group justify="center">
            <Pagination total={totalPages} value={page} onChange={setPage} />
          </Group>
        </>
      ) : null}
    </Stack>
  );
}
