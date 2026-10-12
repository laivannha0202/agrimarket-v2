"use client";

/**
 * Product detail.
 *
 * Left: gallery. Right: name, price, variants, quantity, add-to-cart, buy-now.
 * Below: description, origin, farm, public certificates, reviews.
 *
 * Two important business rules are respected here:
 *  - the page never pins the product to a specific harvest/lot: the exact
 *    origin of the goods is only decided by the backend at FEFO allocation
 *  - availability is the backend's own: each variant carries `inStock` and
 *    `availableQuantity` from the public catalog, so the UI shows a real
 *    "còn hàng / hết hàng" state and caps the quantity picker, while checkout
 *    remains the final authority.
 */

import {
  Alert,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Card,
  Container,
  Divider,
  Group,
  NumberInput,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBuildingStore,
  IconCheck,
  IconInfoCircle,
  IconLeaf,
  IconShieldCheck,
  IconShoppingCart,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { variantSpecLabel } from "@/lib/format";
import { variantDisplayPrice } from "@/lib/promotions";
import { useAuth } from "@/lib/auth/useAuth";
import { usePromotionIndex } from "@/components/product/usePromotionIndex";
import { ProductImage } from "@/components/common/ProductImage";
import { PriceBlock } from "@/components/common/PriceBlock";
import { ErrorState, DetailSkeleton, NotFoundState } from "@/components/common/States";
import { ProductReviews } from "@/components/product/ProductReviews";
import { FarmCertificates } from "@/components/product/FarmCertificates";
import { layout } from "@/theme";

export function ProductDetail({ productId }: { productId: number }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isCustomer, isAuthenticated } = useAuth();

  const productQuery = useQuery({
    queryKey: queryKeys.products.detail(productId),
    queryFn: () => resources.getProduct(productId),
    enabled: Number.isFinite(productId),
  });

  const { index } = usePromotionIndex();

  const product = productQuery.data;
  const activeVariants = useMemo(
    () => (product?.variants ?? []).filter((variant) => variant.status === "ACTIVE"),
    [product],
  );

  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [activeImage, setActiveImage] = useState(0);

  // Default to the first active variant once the product loads.
  const effectiveVariantId = selectedVariantId ?? activeVariants[0]?.id ?? null;
  const selectedVariant = activeVariants.find((v) => v.id === effectiveVariantId) ?? null;

  const price = selectedVariant ? variantDisplayPrice(selectedVariant, index) : null;

  /**
   * Server-reported sellable quantity for the selected variant. `inStock` is the
   * backend's own flag; the picker is capped so a customer cannot build a cart
   * line that is already known to be unfulfillable.
   */
  const availableQuantity = selectedVariant?.availableQuantity ?? null;
  const inStock = selectedVariant?.inStock ?? false;
  const maxQuantity = availableQuantity !== null && availableQuantity > 0
    ? Math.max(1, Math.floor(availableQuantity))
    : undefined;

  const addToCart = useMutation({
    mutationFn: (payload: { variantId: number; qty: number }) =>
      resources.addCartItem(payload.variantId, payload.qty),
    onSuccess: (cart) => {
      queryClient.setQueryData(queryKeys.cart.me(), cart);
      queryClient.invalidateQueries({ queryKey: queryKeys.cart.all });
      notifications.show({
        title: "Đã thêm vào giỏ",
        message: `${product?.name ?? "Sản phẩm"} đã có trong giỏ hàng.`,
        color: "agri",
        icon: <IconCheck size={16} />,
      });
    },
    onError: (error) => {
      notifications.show({
        title: "Không thêm được vào giỏ",
        message:
          error instanceof ApiError
            ? error.message
            : "Sản phẩm hiện không thể thêm vào giỏ. Vui lòng thử lại.",
        color: "red",
        icon: <IconAlertTriangle size={16} />,
      });
    },
  });

  if (productQuery.isLoading) {
    return (
      <Container size={layout.containerSize} py="xl">
        <DetailSkeleton />
      </Container>
    );
  }

  if (productQuery.isError) {
    const isNotFound = productQuery.error instanceof ApiError && productQuery.error.status === 404;
    return (
      <Container size={layout.containerSize} py="xl">
        {isNotFound ? (
          <NotFoundState
            title="Không tìm thấy sản phẩm"
            description="Sản phẩm có thể đã ngừng bán hoặc đường dẫn không đúng."
            action={
              <Button component={Link} href="/san-pham" variant="default">
                Về danh mục sản phẩm
              </Button>
            }
          />
        ) : (
          <ErrorState error={productQuery.error} onRetry={() => productQuery.refetch()} />
        )}
      </Container>
    );
  }

  if (!product) return null;

  const images = product.images.length > 0 ? product.images : [];
  const currentImage = images[activeImage]?.url ?? null;

  const handleAddToCart = () => {
    if (!selectedVariant) return;
    if (!isAuthenticated) {
      router.push(`/dang-nhap?tiep-theo=${encodeURIComponent(`/san-pham/${productId}`)}`);
      return;
    }
    if (!isCustomer) {
      notifications.show({
        title: "Tài khoản không phù hợp",
        message: "Vui lòng đăng nhập bằng tài khoản khách hàng để mua hàng.",
        color: "orange",
      });
      return;
    }
    addToCart.mutate({ variantId: selectedVariant.id, qty: quantity });
  };

  const handleBuyNow = () => {
    if (!selectedVariant) return;
    if (!isAuthenticated || !isCustomer) {
      handleAddToCart();
      return;
    }
    // "Mua ngay" reuses the SAME cart + checkout flow: the item is added to the
    // cart and the customer is sent to checkout. No second pricing path exists.
    addToCart.mutate(
      { variantId: selectedVariant.id, qty: quantity },
      { onSuccess: () => router.push("/thanh-toan") },
    );
  };

  return (
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Breadcrumbs separator="/" visibleFrom="sm">
          <Text component={Link} href="/" size="sm" c="dimmed">
            Trang chủ
          </Text>
          <Text component={Link} href="/san-pham" size="sm" c="dimmed">
            Sản phẩm
          </Text>
          <Text
            component={Link}
            href={`/danh-muc/${product.category.slug}`}
            size="sm"
            c="dimmed"
          >
            {product.category.name}
          </Text>
          <Text size="sm" lineClamp={1} maw={260}>
            {product.name}
          </Text>
        </Breadcrumbs>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={{ base: "lg", md: 40 }}>
          {/* Gallery */}
          <Stack gap="sm">
            <Card padding={0} radius="md" withBorder>
              <ProductImage
                src={currentImage}
                alt={product.name}
                ratio={1}
                priority
                fallbackLabel={product.name}
                sizes="(max-width: 62em) 90vw, 560px"
              />
            </Card>
            {images.length > 1 ? (
              <Group gap="sm">
                {images.map((image, i) => (
                  <Box
                    key={image.id}
                    w={64}
                    h={64}
                    onClick={() => setActiveImage(i)}
                    style={{
                      cursor: "pointer",
                      borderRadius: 8,
                      overflow: "hidden",
                      border:
                        i === activeImage
                          ? "2px solid var(--mantine-color-agri-8)"
                          : "1px solid var(--agri-border)",
                    }}
                  >
                    <ProductImage src={image.url} alt={`${product.name} - ảnh ${i + 1}`} ratio={1} />
                  </Box>
                ))}
              </Group>
            ) : null}
          </Stack>

          {/* Buy box */}
          <Stack gap="md">
            <Stack gap="xs">
              <Title order={2}>{product.name}</Title>
              <Group gap="xs" wrap="wrap">
                <Badge variant="light" color="agri" radius="sm">
                  {product.category.name}
                </Badge>
                <Badge variant="light" color="gray" radius="sm">
                  {product.partner.name}
                </Badge>
              </Group>
            </Stack>

            <Card padding="md" radius="md" withBorder>
              <Stack gap="md">
                <PriceBlock price={price} />

                {price?.source === "FLASH_SALE" && price.flash ? (
                  <Alert color="red" variant="light" icon={<IconInfoCircle size={16} />}>
                    <Stack gap={2}>
                      <Text size="sm" fw={600}>
                        {price.flash.name}
                      </Text>
                      <Text size="xs">
                        Còn {price.flash.remaining}/{price.flash.quota} suất · tối đa{" "}
                        {price.flash.perCustomerLimit} sản phẩm mỗi khách
                      </Text>
                      <Text size="xs" c="dimmed">
                        Kết thúc{" "}
                        {new Date(price.flash.endsAt).toLocaleString("vi-VN", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </Text>
                    </Stack>
                  </Alert>
                ) : null}

                {activeVariants.length > 0 ? (
                  <Stack gap="xs">
                    <Text size="sm" fw={600}>
                      Chọn loại đóng gói
                    </Text>
                    <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
                      {activeVariants.map((variant) => {
                        const variantPrice = variantDisplayPrice(variant, index);
                        const selected = variant.id === effectiveVariantId;
                        const soldOut = variant.inStock === false;
                        return (
                          <Card
                            key={variant.id}
                            padding="xs"
                            radius="md"
                            withBorder
                            onClick={() => {
                              setSelectedVariantId(variant.id);
                              setQuantity(1);
                            }}
                            style={{
                              cursor: "pointer",
                              borderColor: selected
                                ? "var(--mantine-color-agri-8)"
                                : undefined,
                              borderWidth: selected ? 2 : 1,
                              opacity: soldOut ? 0.6 : 1,
                            }}
                          >
                            <Stack gap={2}>
                              <Text size="sm" fw={600}>
                                {variantSpecLabel(variant)}
                              </Text>
                              <Text size="xs" c="dimmed">
                                Đơn vị: {variant.saleUnit}
                              </Text>
                              <Group gap="xs" wrap="wrap">
                                <Text size="sm" fw={700} c="agri.9">
                                  {variantPrice.unitPrice.toLocaleString("vi-VN")} ₫
                                </Text>
                                <Badge
                                  size="xs"
                                  variant="light"
                                  color={soldOut ? "red" : "agri"}
                                  radius="sm"
                                >
                                  {soldOut ? "Hết hàng" : "Còn hàng"}
                                </Badge>
                              </Group>
                            </Stack>
                          </Card>
                        );
                      })}
                    </SimpleGrid>
                  </Stack>
                ) : (
                  <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
                    Sản phẩm hiện chưa có loại đóng gói nào đang bán.
                  </Alert>
                )}

                <Group align="flex-end" gap="md" wrap="wrap">
                  <NumberInput
                    label="Số lượng"
                    value={quantity}
                    onChange={(value) => {
                      const parsed = typeof value === "number" ? value : Number(value);
                      setQuantity(Number.isFinite(parsed) && parsed >= 1 ? parsed : 1);
                    }}
                    min={1}
                    max={maxQuantity}
                    step={1}
                    w={130}
                    suffix={selectedVariant ? ` ${selectedVariant.saleUnit}` : ""}
                    allowDecimal={false}
                    allowNegative={false}
                  />
                  <Text size="xs" c="dimmed" pb={6}>
                    Đơn vị bán: {selectedVariant?.saleUnit ?? "—"}
                  </Text>
                </Group>

                {selectedVariant && !inStock ? (
                  <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
                    <Text size="xs">
                      Loại đóng gói này hiện đã hết hàng. Vui lòng chọn loại khác hoặc quay lại
                      sau.
                    </Text>
                  </Alert>
                ) : (
                  <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
                    <Text size="xs">
                      Tình trạng còn hàng được kiểm tra lại khi bạn đặt hàng. Lô hàng cụ thể
                      sẽ được hệ thống phân bổ theo hạn sử dụng gần nhất.
                    </Text>
                  </Alert>
                )}

                <Group grow gap="sm">
                  <Button
                    size="md"
                    variant="light"
                    leftSection={<IconShoppingCart size={18} />}
                    onClick={handleAddToCart}
                    loading={addToCart.isPending}
                    disabled={!selectedVariant || !inStock}
                  >
                    Thêm vào giỏ
                  </Button>
                  <Button
                    size="md"
                    onClick={handleBuyNow}
                    loading={addToCart.isPending}
                    disabled={!selectedVariant || !inStock}
                  >
                    Mua ngay
                  </Button>
                </Group>
              </Stack>
            </Card>

            <Group gap="lg" wrap="wrap">
              <Group gap={6}>
                <IconShieldCheck size={16} color="var(--mantine-color-agri-8)" />
                <Text size="xs" c="dimmed">
                  Lô hàng đạt kiểm định mới được bán
                </Text>
              </Group>
              <Group gap={6}>
                <IconLeaf size={16} color="var(--mantine-color-agri-8)" />
                <Text size="xs" c="dimmed">
                  Truy xuất nguồn gốc theo từng lô
                </Text>
              </Group>
            </Group>
          </Stack>
        </SimpleGrid>

        <Tabs defaultValue="info" variant="outline" mt="md">
          <Tabs.List>
            <Tabs.Tab value="info">Thông tin sản phẩm</Tabs.Tab>
            <Tabs.Tab value="origin">Nguồn gốc & trang trại</Tabs.Tab>
            <Tabs.Tab value="reviews">Đánh giá</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="info" pt="md">
            <Card padding="lg" radius="md" withBorder>
              <Stack gap="md">
                <Title order={4}>Mô tả</Title>
                <Text size="sm" c={product.description ? undefined : "dimmed"}>
                  {product.description || "Đối tác chưa cập nhật mô tả cho sản phẩm này."}
                </Text>

                {activeVariants.length > 0 ? (
                  <>
                    <Divider />
                    <Title order={4}>Quy cách đóng gói</Title>
                    <Stack gap="xs">
                      {activeVariants.map((variant) => (
                        <Group key={variant.id} justify="space-between" wrap="nowrap">
                          <Text size="sm">{variantSpecLabel(variant)}</Text>
                          <Text size="sm" c="dimmed">
                            Đơn vị: {variant.saleUnit}
                          </Text>
                        </Group>
                      ))}
                    </Stack>
                  </>
                ) : null}
              </Stack>
            </Card>
          </Tabs.Panel>

          <Tabs.Panel value="origin" pt="md">
            <Stack gap="md">
              <Card padding="lg" radius="md" withBorder>
                <Stack gap="sm">
                  <Group gap="sm">
                    <IconBuildingStore size={20} color="var(--mantine-color-agri-8)" />
                    <Title order={4}>Đối tác cung cấp</Title>
                  </Group>
                  <Text size="sm" fw={600}>
                    {product.partner.name}
                  </Text>
                  <Button
                    component={Link}
                    href={`/doi-tac/${product.partner.id}`}
                    variant="light"
                    size="xs"
                    w="fit-content"
                  >
                    Xem đối tác
                  </Button>
                  <Divider my="xs" />
                  <Text size="xs" c="dimmed">
                    Đối tác là đơn vị cung cấp nông sản. Nguồn gốc cụ thể của hàng hóa
                    được xác định theo lô hàng thực tế khi đơn được phân bổ.
                  </Text>
                </Stack>
              </Card>

              {product.farmId ? <ProductFarmPanel farmId={product.farmId} /> : null}

              <Card padding="lg" radius="md" withBorder>
                <Stack gap="sm">
                  <Group gap="sm">
                    <IconShieldCheck size={20} color="var(--mantine-color-agri-8)" />
                    <Title order={4}>Truy xuất nguồn gốc</Title>
                  </Group>
                  <Text size="sm" c="dimmed">
                    Sau khi mua, bạn xem được mã truy xuất của lô hàng thực tế trong chi
                    tiết đơn hàng.
                  </Text>
                  <Button
                    component={Link}
                    href="/truy-xuat"
                    variant="light"
                    size="xs"
                    w="fit-content"
                  >
                    Tra cứu mã truy xuất
                  </Button>
                </Stack>
              </Card>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="reviews" pt="md">
            <ProductReviews productId={product.id} />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}

/** Farm panel on the product page: public info + valid certificates only. */
function ProductFarmPanel({ farmId }: { farmId: number }) {
  const farmQuery = useQuery({
    queryKey: queryKeys.farms.detail(farmId),
    queryFn: () => resources.getFarm(farmId),
    staleTime: 5 * 60_000,
  });

  if (farmQuery.isLoading) {
    return <Card padding="lg" radius="md" withBorder h={140} />;
  }
  if (farmQuery.isError || !farmQuery.data) return null;

  const farm = farmQuery.data;

  return (
    <Card padding="lg" radius="md" withBorder>
      <Stack gap="sm">
        <Group gap="sm">
          <IconLeaf size={20} color="var(--mantine-color-agri-8)" />
          <Title order={4}>Trang trại</Title>
        </Group>
        <Text size="sm" fw={600}>
          {farm.name}
        </Text>
        <Text size="sm" c="dimmed">
          {farm.address}
        </Text>
        {farm.areaHa ? (
          <Text size="sm" c="dimmed">
            Diện tích: {Number(farm.areaHa).toLocaleString("vi-VN")} ha
          </Text>
        ) : null}
        {farm.description ? (
          <Text size="sm" c="dimmed">
            {farm.description}
          </Text>
        ) : null}
        <FarmCertificates farmId={farm.id} />
        <Button
          component={Link}
          href={`/trang-trai/${farm.id}`}
          variant="light"
          size="xs"
          w="fit-content"
        >
          Xem trang trại
        </Button>
      </Stack>
    </Card>
  );
}
