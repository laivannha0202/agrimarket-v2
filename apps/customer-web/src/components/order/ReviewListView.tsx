"use client";

/**
 * Product reviews.
 *
 * Two halves, both backed by the API:
 *  - "Chờ đánh giá": the customer's DELIVERED order items that have no review
 *    yet. The backend enforces the rules it does not let the client pre-check
 *    (item must belong to the caller, order must be DELIVERED, one review per
 *    item), so a rejection is shown verbatim.
 *  - "Đã đánh giá": `GET /reviews/me` — the customer's own reviews with their
 *    real status (PENDING / APPROVED / HIDDEN), so the history survives a
 *    logout and a fresh login on another device.
 */

import {
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Rating,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { IconInfoCircle, IconStar } from "@tabler/icons-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDate, formatQuantity } from "@/lib/format";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/States";
import { ReviewModal } from "@/components/order/ReviewModal";
import { useReviewedOrderItemIds } from "@/lib/hooks/useReviewedOrderItemIds";
import { layout } from "@/theme";
import type { MyReview, OrderItem } from "@/lib/api/types";

const FETCH_LIMIT = 100;

const REVIEW_STATUS_LABEL: Record<MyReview["status"], string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  HIDDEN: "Đã ẩn",
};

export function ReviewListView() {
  const [activeTab, setActiveTab] = useState("pending");
  const [reviewItem, setReviewItem] = useState<OrderItem | null>(null);
  const [justReviewed, setJustReviewed] = useState<number[]>([]);

  const ordersQuery = useQuery({
    queryKey: queryKeys.orders.list({ page: 1, limit: FETCH_LIMIT }),
    queryFn: () => resources.listMyOrders({ page: 1, limit: FETCH_LIMIT }),
  });

  const reviewsQuery = useQuery({
    queryKey: queryKeys.reviews.mine(),
    queryFn: () => resources.listMyReviews({ page: 1, limit: FETCH_LIMIT }),
  });

  const reviewable = useMemo(() => {
    const orders = (ordersQuery.data?.data ?? []).filter(
      (order) => order.status === "DELIVERED",
    );
    return orders.flatMap((order) =>
      order.partnerOrders.flatMap((partnerOrder) =>
        partnerOrder.items.map((item) => ({
          order,
          partnerName: partnerOrder.partner.name,
          item,
        })),
      ),
    );
  }, [ordersQuery.data]);

  // `GET /reviews/me` is the single source of "already reviewed" — no join.
  const reviewedItemIds = useReviewedOrderItemIds(
    useMemo(() => reviewable.map((entry) => entry.item), [reviewable]),
  );

  const pending = useMemo(
    () =>
      reviewable.filter(
        (entry) => !justReviewed.includes(entry.item.id) && !reviewedItemIds.has(entry.item.id),
      ),
    [reviewable, justReviewed, reviewedItemIds],
  );

  const myReviews = reviewsQuery.data?.data ?? [];

  return (
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Breadcrumbs separator="/" visibleFrom="sm">
          <Text component={Link} href="/" size="sm" c="dimmed">
            Trang chủ
          </Text>
          <Text size="sm">Đánh giá sản phẩm</Text>
        </Breadcrumbs>

        <Stack gap={4}>
          <Title order={2}>Đánh giá sản phẩm</Title>
          <Text size="sm" c="dimmed">
            Chia sẻ cảm nhận của bạn về nông sản đã mua để giúp người mua khác lựa chọn.
          </Text>
        </Stack>

        <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
          <Text size="sm">
            Chỉ sản phẩm trong đơn hàng đã giao mới có thể đánh giá, và mỗi sản phẩm chỉ đánh
            giá một lần. Đánh giá sẽ được duyệt trước khi hiển thị công khai.
          </Text>
        </Alert>

        <Tabs value={activeTab} onChange={(value) => setActiveTab(value ?? "pending")} variant="outline">
          <Tabs.List>
            <Tabs.Tab value="pending">
              Chờ đánh giá{pending.length > 0 ? ` (${pending.length})` : ""}
            </Tabs.Tab>
            <Tabs.Tab value="done">
              Đã đánh giá{myReviews.length > 0 ? ` (${myReviews.length})` : ""}
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="pending" pt="md">
            {ordersQuery.isError ? (
              <ErrorState error={ordersQuery.error} onRetry={() => ordersQuery.refetch()} />
            ) : ordersQuery.isLoading ? (
              <ListSkeleton rows={3} />
            ) : pending.length === 0 ? (
              <EmptyState
                icon={<IconStar size={28} />}
                title="Chưa có sản phẩm nào để đánh giá"
                description="Sản phẩm trong đơn hàng đã giao sẽ xuất hiện tại đây để bạn đánh giá."
                action={
                  <Button component={Link} href="/don-hang">
                    Xem đơn hàng của tôi
                  </Button>
                }
              />
            ) : (
              <Stack gap="sm">
                {pending.map(({ order, partnerName, item }) => (
                  <Card key={item.id} padding="md" radius="md" withBorder>
                    <Stack gap="sm">
                      <Group justify="space-between" wrap="wrap" gap="xs">
                        <Text size="sm" fw={700}>
                          {item.productNameSnapshot}
                        </Text>
                        <Text size="xs" c="dimmed">
                          Đơn {order.code} · {formatDate(order.createdAt)}
                        </Text>
                      </Group>
                      <Divider />
                      <Text size="xs" c="dimmed">
                        {partnerName} · Mã hàng {item.skuSnapshot} ·{" "}
                        {formatQuantity(item.quantity)}
                      </Text>
                      <Button
                        variant="light"
                        size="xs"
                        w="fit-content"
                        leftSection={<IconStar size={14} />}
                        onClick={() => setReviewItem(item)}
                      >
                        Đánh giá sản phẩm
                      </Button>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="done" pt="md">
            {reviewsQuery.isError ? (
              <ErrorState error={reviewsQuery.error} onRetry={() => reviewsQuery.refetch()} />
            ) : reviewsQuery.isLoading ? (
              <ListSkeleton rows={3} />
            ) : myReviews.length === 0 ? (
              <EmptyState
                icon={<IconStar size={28} />}
                title="Bạn chưa đánh giá sản phẩm nào"
                description="Đánh giá của bạn sẽ được lưu tại đây và vẫn xem được sau khi đăng nhập lại."
              />
            ) : (
              <Stack gap="sm">
                {myReviews.map((review) => (
                  <Card key={review.id} padding="md" radius="md" withBorder>
                    <Stack gap="sm">
                      <Group justify="space-between" wrap="wrap" gap="xs">
                        <Text size="sm" fw={700}>
                          {review.product.name}
                        </Text>
                        <Badge
                          variant="light"
                          color={
                            review.status === "APPROVED"
                              ? "agri"
                              : review.status === "HIDDEN"
                                ? "red"
                                : "yellow"
                          }
                          radius="sm"
                          size="sm"
                        >
                          {REVIEW_STATUS_LABEL[review.status]}
                        </Badge>
                      </Group>
                      <Group gap="xs" wrap="wrap">
                        <Rating value={review.rating} readOnly size="sm" />
                        <Text size="xs" c="dimmed">
                          {formatDate(review.createdAt)}
                        </Text>
                      </Group>
                      {review.content ? (
                        <Text size="sm">{review.content}</Text>
                      ) : (
                        <Text size="sm" c="dimmed">
                          Bạn chỉ chấm điểm, không kèm nhận xét.
                        </Text>
                      )}
                    </Stack>
                  </Card>
                ))}
              </Stack>
            )}
          </Tabs.Panel>
        </Tabs>
      </Stack>

      {reviewItem ? (
        <ReviewModal
          orderItem={reviewItem}
          opened
          onClose={() => setReviewItem(null)}
          onCreated={() => {
            setJustReviewed((prev) => [...prev, reviewItem.id]);
            reviewsQuery.refetch();
          }}
        />
      ) : null}
    </Container>
  );
}
