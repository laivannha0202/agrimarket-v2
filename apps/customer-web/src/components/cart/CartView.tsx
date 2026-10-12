"use client";

/**
 * Cart.
 *
 * The cart is grouped by partner, matching the backend's per-partner order
 * split. The cart NEVER reserves stock and its totals are NOT the checkout
 * source of truth — checkout re-resolves prices, re-validates the voucher and
 * re-checks sellable stock server-side.
 */

import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Modal,
  NumberInput,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconShoppingCart, IconTrash } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatMoney } from "@/lib/format";
import { resolveDisplayPrice } from "@/lib/promotions";
import { usePromotionIndex } from "@/components/product/usePromotionIndex";
import { useCartProducts, primaryImageUrl } from "@/lib/hooks/useCartProducts";
import { ProductImage } from "@/components/common/ProductImage";
import {
  EmptyCartState,
  ErrorState,
  ListSkeleton,
} from "@/components/common/States";
import { layout } from "@/theme";
import type { Cart, CartItem } from "@/lib/api/types";

export function CartView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { index } = usePromotionIndex();
  const [pendingRemoval, setPendingRemoval] = useState<CartItem | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const cartQuery = useQuery({
    queryKey: queryKeys.cart.me(),
    queryFn: resources.getCart,
  });

  const applyCart = (cart: Cart) => {
    queryClient.setQueryData(queryKeys.cart.me(), cart);
  };

  const updateItem = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: number; quantity: number }) =>
      resources.updateCartItem(itemId, quantity),
    onSuccess: applyCart,
    onError: (error) => {
      notifications.show({
        title: "Không cập nhật được",
        message: error instanceof ApiError ? error.message : "Vui lòng thử lại.",
        color: "red",
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.cart.all });
    },
  });

  const removeItem = useMutation({
    mutationFn: (itemId: number) => resources.removeCartItem(itemId),
    onSuccess: (cart) => {
      applyCart(cart);
      setPendingRemoval(null);
    },
    onError: (error) => {
      notifications.show({
        title: "Không xóa được sản phẩm",
        message: error instanceof ApiError ? error.message : "Vui lòng thử lại.",
        color: "red",
      });
    },
  });

  const clearCart = useMutation({
    mutationFn: () => resources.clearCart(),
    onSuccess: (cart) => {
      applyCart(cart);
      setConfirmClearAll(false);
    },
    onError: (error) => {
      notifications.show({
        title: "Không xóa được giỏ hàng",
        message: error instanceof ApiError ? error.message : "Vui lòng thử lại.",
        color: "red",
      });
    },
  });

  const items = useMemo(() => cartQuery.data?.items ?? [], [cartQuery.data]);

  /**
   * The cart API sends only `product.partnerId` (no `partner` relation), so the
   * partner name and the product image come from the public product resource.
   */
  const productIds = useMemo(
    () => items.map((item) => item.productVariant.product.id),
    [items],
  );
  const products = useCartProducts(productIds);

  /**
   * Grouped by partner, exactly like the backend splits the order. Grouping keys
   * on `partnerId` alone, so the memo does not depend on the (per-render) product
   * lookup map; the partner *name* is resolved while rendering.
   */
  const groups = useMemo(() => {
    const map = new Map<number, CartItem[]>();
    for (const item of items) {
      const partnerId = item.productVariant.product.partnerId;
      const existing = map.get(partnerId);
      if (existing) existing.push(item);
      else map.set(partnerId, [item]);
    }
    return Array.from(map, ([partnerId, groupItems]) => ({ partnerId, items: groupItems }));
  }, [items]);

  const totals = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    for (const item of items) {
      const price = resolveDisplayPrice(item.productVariant, index);
      const quantity = Number(item.quantity);
      subtotal += price.basePrice * quantity;
      discount += price.discountAmount * quantity;
    }
    return { subtotal, discount, total: subtotal - discount };
  }, [items, index]);

  if (cartQuery.isLoading) {
    return (
      <Container size={layout.containerSize} py="xl">
        <ListSkeleton rows={4} />
      </Container>
    );
  }

  if (cartQuery.isError) {
    return (
      <Container size={layout.containerSize} py="xl">
        <ErrorState error={cartQuery.error} onRetry={() => cartQuery.refetch()} />
      </Container>
    );
  }

  return (
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Breadcrumbs separator="/" visibleFrom="sm">
          <Text component={Link} href="/" size="sm" c="dimmed">
            Trang chủ
          </Text>
          <Text size="sm">Giỏ hàng</Text>
        </Breadcrumbs>

        <Group justify="space-between" align="center" wrap="wrap">
          <Title order={2}>Giỏ hàng</Title>
          {items.length > 0 ? (
            <Button
              variant="subtle"
              color="red"
              size="sm"
              leftSection={<IconTrash size={16} />}
              onClick={() => setConfirmClearAll(true)}
              loading={clearCart.isPending}
            >
              Xóa toàn bộ
            </Button>
          ) : null}
        </Group>

        {items.length === 0 ? (
          <EmptyCartState
            action={
              <Button component={Link} href="/san-pham" leftSection={<IconShoppingCart size={16} />}>
                Mua nông sản
              </Button>
            }
          />
        ) : (
          <Group align="flex-start" gap="lg" wrap="wrap">
            <Stack gap="md" style={{ flex: 1, minWidth: 300 }}>
              {groups.map((group) => (
                <Card key={group.partnerId} padding="md" radius="md" withBorder>
                  <Stack gap="md">
                    <Group justify="space-between" wrap="wrap">
                      <Text fw={700}>
                        {group.items[0]
                          ? (products.get(group.items[0].productVariant.product.id)?.partner
                              .name ?? "Đang tải tên đối tác…")
                          : "Đang tải tên đối tác…"}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {group.items.length} sản phẩm
                      </Text>
                    </Group>
                    <Divider />

                    <Stack gap="md">
                      {group.items.map((item) => {
                        const variant = item.productVariant;
                        const product = variant.product;
                        const price = resolveDisplayPrice(variant, index);
                        const quantity = Number(item.quantity);
                        const image = primaryImageUrl(products.get(product.id));

                        return (
                          <Group
                            key={item.id}
                            align="flex-start"
                            gap="md"
                            wrap="nowrap"
                            style={{ minWidth: 0 }}
                          >
                            <Box w={72} style={{ flexShrink: 0 }}>
                              <ProductImage
                                src={image}
                                alt={product.name}
                                ratio={1}
                                radius={6}
                                fallbackLabel={product.name}
                              />
                            </Box>

                            <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                              <Text
                                component={Link}
                                href={`/san-pham/${product.id}`}
                                size="sm"
                                fw={600}
                                className="agri-clamp-2"
                              >
                                {product.name}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {variant.name}
                              </Text>
                              <Group gap={8} align="baseline">
                                <Text size="sm" fw={700} c="agri.9">
                                  {formatMoney(price.unitPrice)}
                                </Text>
                                {price.source !== "NONE" ? (
                                  <Text size="xs" c="dimmed" td="line-through">
                                    {formatMoney(price.basePrice)}
                                  </Text>
                                ) : null}
                              </Group>
                            </Stack>

                            <Stack gap={6} align="flex-end" style={{ flexShrink: 0 }}>
                              <NumberInput
                                value={quantity}
                                onChange={(value) => {
                                  const parsed =
                                    typeof value === "number" ? value : Number(value);
                                  if (!Number.isFinite(parsed) || parsed < 1) {
                                    // Quantity 0 removes the line, after confirm.
                                    if (parsed === 0) setPendingRemoval(item);
                                    return;
                                  }
                                  updateItem.mutate({
                                    itemId: item.id,
                                    quantity: parsed,
                                  });
                                }}
                                min={0}
                                allowDecimal={false}
                                allowNegative={false}
                                w={100}
                                size="sm"
                                suffix={` ${variant.saleUnit}`}
                                aria-label={`Số lượng ${product.name}`}
                              />
                              <Text size="sm" fw={600}>
                                {formatMoney(price.unitPrice * quantity)}
                              </Text>
                              <Button
                                variant="subtle"
                                color="red"
                                size="compact-xs"
                                leftSection={<IconTrash size={13} />}
                                onClick={() => setPendingRemoval(item)}
                              >
                                Xóa
                              </Button>
                            </Stack>
                          </Group>
                        );
                      })}
                    </Stack>
                  </Stack>
                </Card>
              ))}
            </Stack>

            <Card
              padding="lg"
              radius="md"
              withBorder
              w={{ base: "100%", md: 320 }}
              style={{ flexShrink: 0 }}
            >
              <Stack gap="md">
                <Title order={4}>Tạm tính</Title>
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      Tổng tiền hàng
                    </Text>
                    <Text size="sm">{formatMoney(totals.subtotal)}</Text>
                  </Group>
                  {totals.discount > 0 ? (
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">
                        Giảm giá sản phẩm
                      </Text>
                      <Text size="sm" c="red.7">
                        −{formatMoney(totals.discount)}
                      </Text>
                    </Group>
                  ) : null}
                  <Divider />
                  <Group justify="space-between">
                    <Text fw={700}>Tạm tính</Text>
                    <Text fw={700} c="agri.9">
                      {formatMoney(totals.total)}
                    </Text>
                  </Group>
                </Stack>

                <Alert color="gray" variant="light" icon={<IconAlertCircle size={15} />}>
                  <Text size="xs">
                    Phí giao hàng và mã giảm giá được áp dụng ở bước thanh toán. Giá và tồn
                    kho được kiểm tra lại khi đặt hàng.
                  </Text>
                </Alert>

                <Button
                  size="md"
                  fullWidth
                  onClick={() => router.push("/thanh-toan")}
                  disabled={items.length === 0}
                >
                  Tiến hành đặt hàng
                </Button>
                <Button component={Link} href="/san-pham" variant="default" fullWidth size="sm">
                  Tiếp tục mua sắm
                </Button>
              </Stack>
            </Card>
          </Group>
        )}
      </Stack>

      <Modal
        opened={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        title="Xóa sản phẩm khỏi giỏ?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            {pendingRemoval?.productVariant.product.name ?? ""} sẽ được xóa khỏi giỏ hàng.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setPendingRemoval(null)}>
              Giữ lại
            </Button>
            <Button
              color="red"
              loading={removeItem.isPending}
              onClick={() => pendingRemoval && removeItem.mutate(pendingRemoval.id)}
            >
              Xóa sản phẩm
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={confirmClearAll}
        onClose={() => setConfirmClearAll(false)}
        title="Xóa toàn bộ giỏ hàng?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            {items.length} sản phẩm trong giỏ sẽ bị xóa. Bạn có thể thêm lại sau, nhưng giá và
            tồn kho có thể đã thay đổi.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setConfirmClearAll(false)}>
              Giữ lại
            </Button>
            <Button
              color="red"
              loading={clearCart.isPending}
              onClick={() => clearCart.mutate()}
            >
              Xóa toàn bộ
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
