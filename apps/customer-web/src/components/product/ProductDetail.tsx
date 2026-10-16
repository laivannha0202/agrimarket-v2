"use client";

/**
 * Product detail — the web twin of the Mobile product screen.
 *
 * Gallery with real uploaded images (backend `sortOrder`, primary first), name
 * + status, farm row, price block, trust strip, variant picker, quantity,
 * description, origin, reviews and a sticky two-button action bar.
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
  Avatar,
  Box,
  Button,
  Card,
  Container,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconBuildingStore,
  IconCheck,
  IconCircleCheck,
  IconChevronRight,
  IconLeaf,
  IconQrcode,
  IconShieldCheck,
  IconShoppingCart,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import {
  discountPercent,
  formatMoney,
  formatQuantity,
  formatDateTime,
  formatWeight,
  variantSpecLabel,
} from "@/lib/format";
import { variantDisplayPrice } from "@/lib/promotions";
import { displayVariant } from "@/lib/product-variant";
import { useAuth } from "@/lib/auth/useAuth";
import { ProductImage } from "@/components/common/ProductImage";
import { ErrorState, DetailSkeleton, NotFoundState } from "@/components/common/States";
import { ProductReviews } from "@/components/product/ProductReviews";
import { FarmCertificates } from "@/components/product/FarmCertificates";
import { usePromotionIndex } from "@/components/product/usePromotionIndex";
import { AppCard, BottomBar, GhostButton, QtyStepper, ToneBadge, KVRow } from "@/components/ui/kit";
import { layout } from "@/theme";

const PRICE_SOURCE_LABEL: Record<string, string | null> = {
  NONE: null,
  PRODUCT_DISCOUNT: "Giảm giá",
  FLASH_SALE: "Flash Sale",
};

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

  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [activeImage, setActiveImage] = useState(0);

  /**
   * Gallery: real uploaded images only — the backend's primary first, then the
   * rest in `sortOrder`, so the first slide is the same photo the card showed.
   */
  const images = useMemo(() => {
    const list = [...(product?.images ?? [])].filter((image) => Boolean(image.url));
    list.sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) ||
        a.sortOrder - b.sortOrder ||
        a.id - b.id,
    );
    return list;
  }, [product]);

  /**
   * Default to the variant the CARD advertised (cheapest sellable one): a
   * customer who tapped a card showing 12.000₫ must land on the same price.
   * An explicit choice always wins.
   */
  const selected =
    product?.variants.find((variant) => variant.id === selectedVariantId) ??
    displayVariant(product ?? { variants: [] }, index)?.variant ??
    null;

  const price = selected ? variantDisplayPrice(selected, index) : null;
  const percent = price ? discountPercent(price.basePrice, price.unitPrice) : null;
  const canBuySelected =
    selected !== null && selected.status === "ACTIVE" && selected.inStock;
  const weight = selected ? formatWeight(selected.weight, selected.weightUnit) : "";
  const maxQuantity = selected ? Math.max(1, Math.floor(selected.availableQuantity)) : 1;
  const clampedQuantity = Math.min(quantity, maxQuantity);

  /** Flash-sale quota line — only when the active flash sale really covers the variant. */
  const flashSale = selected ? index?.flashByVariant.get(selected.id) : undefined;
  const flashItem = flashSale?.items.find((item) => item.productVariantId === selected?.id);

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
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py="xl">
        <DetailSkeleton />
      </Container>
    );
  }

  if (productQuery.isError) {
    const isNotFound = productQuery.error instanceof ApiError && productQuery.error.status === 404;
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py="xl">
        {isNotFound ? (
          <NotFoundState
            title="Không tìm thấy sản phẩm"
            description="Sản phẩm có thể đã ngừng bán hoặc đường dẫn không đúng."
            action={
              <GhostButton component={Link} href="/san-pham" radius={8}>
                Về danh mục sản phẩm
              </GhostButton>
            }
          />
        ) : (
          <ErrorState error={productQuery.error} onRetry={() => productQuery.refetch()} />
        )}
      </Container>
    );
  }

  if (!product) return null;

  const currentImage = images[Math.min(activeImage, Math.max(0, images.length - 1))]?.url ?? null;

  const handleAddToCart = () => {
    if (!selected || !canBuySelected) return;
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
    addToCart.mutate({ variantId: selected.id, qty: clampedQuantity });
  };

  const handleBuyNow = () => {
    if (!selected || !canBuySelected) return;
    if (!isAuthenticated || !isCustomer) {
      handleAddToCart();
      return;
    }
    // "Mua ngay" reuses the SAME cart + checkout flow: the item is added to the
    // cart and the customer is sent to checkout. No second pricing path exists.
    addToCart.mutate(
      { variantId: selected.id, qty: clampedQuantity },
      { onSuccess: () => router.push("/thanh-toan") },
    );
  };

  return (
    <Container
      size={layout.containerSize}
      px={{ base: 0, sm: "lg" }}
      py={{ base: 0, sm: 24 }}
      pb={{ base: 96, sm: 24 }}
    >
      {/* Mantine v9 `gap` is not a responsive prop, so a single value is used. */}
      <Stack gap={12}>
        <Group
          gap={6}
          visibleFrom="sm"
          wrap="wrap"
          px={{ base: 12, sm: 0 }}
          style={{ marginBottom: 4 }}
        >
          <Text component={Link} href="/" fz={13} c="var(--agri-muted)">
            Trang chủ
          </Text>
          <Text fz={13} c="var(--agri-muted-soft)">
            /
          </Text>
          <Text component={Link} href="/san-pham" fz={13} c="var(--agri-muted)">
            Sản phẩm
          </Text>
          <Text fz={13} c="var(--agri-muted-soft)">
            /
          </Text>
          <Text
            component={Link}
            href={`/danh-muc/${product.category.slug}`}
            fz={13}
            c="var(--agri-muted)"
          >
            {product.category.name}
          </Text>
          <Text fz={13} c="var(--agri-muted-soft)">
            /
          </Text>
          <Text fz={13} c="var(--agri-text)" lineClamp={1} maw={260}>
            {product.name}
          </Text>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={{ base: 8, md: 32 }}>
          {/* ------------------------------------------------------ gallery -- */}
          <Stack gap={8}>
            <Box style={{ background: "var(--agri-surface)", borderRadius: 12, overflow: "hidden" }}>
              <ProductImage
                src={currentImage}
                alt={product.name}
                ratio={1}
                priority
                sizes="(max-width: 62em) 100vw, 560px"
              />
            </Box>
            {images.length > 1 ? (
              <Group gap={8} px={{ base: 12, sm: 0 }}>
                {images.map((image, i) => (
                  <Box
                    key={image.id}
                    w={56}
                    h={56}
                    onClick={() => setActiveImage(i)}
                    style={{
                      cursor: "pointer",
                      borderRadius: 8,
                      overflow: "hidden",
                      border:
                        i === activeImage
                          ? "2px solid var(--agri-primary)"
                          : "1px solid var(--agri-border)",
                    }}
                  >
                    <ProductImage src={image.url} alt={`${product.name} - ảnh ${i + 1}`} ratio={1} />
                  </Box>
                ))}
              </Group>
            ) : null}
          </Stack>

          {/* ------------------------------------------------------ buy box -- */}
          <Stack gap={10}>
            {/* Title block */}
            <AppCard radius={0} p={{ base: 12, sm: 16 }} style={{ borderLeft: "none", borderRight: "none" }}>
              <Stack gap={8}>
                <Text fz={{ base: 18, sm: 20 }} fw={700} c="var(--agri-text-strong)" style={{ lineHeight: 1.35 }}>
                  {product.name}
                </Text>

                <Group gap={8} wrap="wrap">
                  <ToneBadge tone="green">{product.category.name}</ToneBadge>
                  {selected ? (
                    canBuySelected ? (
                      <ToneBadge
                        tone="green"
                        icon={<IconCheck size={12} aria-hidden />}
                      >
                        Còn hàng
                      </ToneBadge>
                    ) : (
                      <ToneBadge tone="red">
                        {selected.status !== "ACTIVE" ? "Ngừng bán" : "Hết hàng"}
                      </ToneBadge>
                    )
                  ) : null}
                </Group>

                {/* Farm / partner row */}
                {product.farmId ? (
                  <Box
                    component={Link}
                    href={`/trang-trai/${product.farmId}`}
                    className="agri-press"
                    style={{ color: "var(--agri-primary)", display: "block" }}
                  >
                    <Group gap={6} wrap="nowrap" style={{ minHeight: 28 }}>
                      <IconLeaf size={15} aria-hidden />
                      <Text fz={13} fw={600} truncate style={{ flex: 1 }}>
                        {product.partner.name}
                      </Text>
                      <Text fz={12}>Xem trang trại</Text>
                      <IconChevronRight size={14} aria-hidden />
                    </Group>
                  </Box>
                ) : (
                  <Group gap={6} wrap="nowrap" style={{ minHeight: 28 }}>
                    <IconBuildingStore size={15} color="var(--agri-muted)" aria-hidden />
                    <Text fz={13} c="var(--agri-muted)" truncate>
                      {product.partner.name}
                    </Text>
                  </Group>
                )}

                {/* Price */}
                {price ? (
                  <Group gap={8} align="baseline" wrap="wrap" mt={2}>
                    <Text fz={24} fw={700} c="agri.9" style={{ lineHeight: 1.2 }}>
                      {formatMoney(price.unitPrice)}
                    </Text>
                    {percent !== null && percent > 0 ? (
                      <>
                        <Text fz={13} c="var(--agri-muted-soft)" td="line-through">
                          {formatMoney(price.basePrice)}
                        </Text>
                        <Box
                          component="span"
                          style={{
                            background: "var(--agri-danger-soft)",
                            borderRadius: 8,
                            padding: "2px 6px",
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: "var(--agri-danger)",
                          }}
                        >
                          -{percent}%
                        </Box>
                      </>
                    ) : null}
                  </Group>
                ) : (
                  <Text fz={16} fw={600} c="var(--agri-muted)" mt={2}>
                    Liên hệ để biết giá
                  </Text>
                )}

                {weight || selected ? (
                  <Text fz={13} c="var(--agri-muted)">
                    {weight ? `${weight} / ${selected?.saleUnit ?? ""}` : selected?.saleUnit}
                  </Text>
                ) : null}

                {price ? (
                  PRICE_SOURCE_LABEL[price.source] ? (
                    <Text fz={12} c="var(--agri-muted)">
                      Đang áp dụng: {PRICE_SOURCE_LABEL[price.source]}
                    </Text>
                  ) : null
                ) : null}

                {flashSale && flashItem ? (
                  <Text fz={12} c="var(--agri-danger)">
                    Còn {Math.max(0, flashItem.quota - flashItem.soldQuantity)}/{flashItem.quota}{" "}
                    suất · tối đa {flashItem.perCustomerLimit} sản phẩm mỗi khách · Kết thúc{" "}
                    {formatDateTime(flashSale.endsAt)}
                  </Text>
                ) : null}
              </Stack>
            </AppCard>

            {/* Trust strip — only facts the backend actually supports. */}
            {(product.farmId || product.category) && (
              <AppCard radius={0} py={12} style={{ borderLeft: "none", borderRight: "none" }}>
                <Group gap={0} wrap="nowrap">
                  {product.farmId ? (
                    <TrustItem icon={<IconLeaf size={17} aria-hidden />} label="Nguồn gốc" />
                  ) : null}
                  {product.category ? (
                    <TrustItem icon={<IconShieldCheck size={17} aria-hidden />} label="An toàn" />
                  ) : null}
                  {product.farmId ? (
                    <TrustItem icon={<IconQrcode size={17} aria-hidden />} label="Truy xuất" />
                  ) : null}
                </Group>
              </AppCard>
            )}

            {/* Variants */}
            <AppCard radius={0} p={{ base: 12, sm: 16 }} style={{ borderLeft: "none", borderRight: "none" }}>
              <Stack gap={10}>
                <Text fz={15} fw={700} c="var(--agri-text-strong)">
                  Chọn quy cách
                </Text>

                {product.variants.length === 0 ? (
                  <Text fz={13} c="var(--agri-muted)">
                    Sản phẩm chưa có quy cách bán.
                  </Text>
                ) : null}

                {product.variants.map((variant) => {
                  const variantPrice = variantDisplayPrice(variant, index);
                  const variantPercent = discountPercent(
                    variantPrice.basePrice,
                    variantPrice.unitPrice,
                  );
                  const active = selected?.id === variant.id;
                  return (
                    <Box
                      key={variant.id}
                      component="button"
                      type="button"
                      onClick={() => {
                        setSelectedVariantId(variant.id);
                        setQuantity(1);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        textAlign: "left",
                        border: `${active ? 1.5 : 1}px solid ${
                          active ? "var(--agri-primary)" : "var(--agri-border)"
                        }`,
                        background: active ? "var(--agri-primary-soft)" : "var(--agri-surface)",
                        borderRadius: 8,
                        padding: 12,
                        minHeight: 44,
                        cursor: "pointer",
                      }}
                    >
                      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                        <Text fz={14} fw={600}>
                          {variantSpecLabel(variant)}
                        </Text>
                        <Group gap={8} align="baseline" wrap="wrap">
                          <Text fz={15} fw={700} c="agri.9">
                            {formatMoney(variantPrice.unitPrice)}
                          </Text>
                          {variantPercent !== null && variantPercent > 0 ? (
                            <>
                              <Text fz={13} c="var(--agri-muted-soft)" td="line-through">
                                {formatMoney(variantPrice.basePrice)}
                              </Text>
                              <Text fz={12} fw={700} c="var(--agri-danger)">
                                -{variantPercent}%
                              </Text>
                            </>
                          ) : null}
                        </Group>
                        <Text fz={12} c="var(--agri-muted)">
                          {variant.status !== "ACTIVE"
                            ? "Ngừng bán"
                            : variant.inStock
                              ? `Còn ${formatQuantity(variant.availableQuantity, variant.saleUnit)}`
                              : "Tạm hết hàng"}
                        </Text>
                      </Stack>
                      {active ? (
                        <IconCircleCheck size={20} color="var(--agri-primary)" aria-hidden />
                      ) : null}
                    </Box>
                  );
                })}
              </Stack>
            </AppCard>

            {/* Quantity */}
            {selected ? (
              <AppCard radius={0} p={{ base: 12, sm: 16 }} style={{ borderLeft: "none", borderRight: "none" }}>
                <Stack gap={10}>
                  <Text fz={15} fw={700} c="var(--agri-text-strong)">
                    Số lượng
                  </Text>
                  <Group gap={12} wrap="nowrap">
                    <QtyStepper
                      value={clampedQuantity}
                      max={maxQuantity}
                      onChange={setQuantity}
                      disabled={!canBuySelected}
                    />
                    <Text fz={12} c="var(--agri-muted)" style={{ flex: 1 }}>
                      Tối đa {formatQuantity(maxQuantity, selected.saleUnit)}
                    </Text>
                  </Group>
                </Stack>
              </AppCard>
            ) : null}
          </Stack>
        </SimpleGrid>

        {/* --------------------------------------------------- description -- */}
        {product.description ? (
          <AppCard radius={0} p={{ base: 12, sm: 16 }} style={{ borderLeft: "none", borderRight: "none" }}>
            <Stack gap={8}>
              <Text fz={15} fw={700} c="var(--agri-text-strong)">
                Mô tả
              </Text>
              <Text fz={14} c="var(--agri-text)" style={{ lineHeight: 1.5 }}>
                {product.description}
              </Text>
            </Stack>
          </AppCard>
        ) : null}

        {/* ------------------------------------------------ origin & farm -- */}
        <AppCard radius={0} p={{ base: 12, sm: 16 }} style={{ borderLeft: "none", borderRight: "none" }}>
          <Stack gap={10}>
            <Text fz={15} fw={700} c="var(--agri-text-strong)">
              Nguồn gốc &amp; trang trại
            </Text>

            {product.farmId ? <ProductFarmPanel farmId={product.farmId} /> : null}

            <Group gap={8} wrap="wrap">
              <Avatar size={36} radius="xl" color="agri">
                {product.partner.name.trim().charAt(0).toUpperCase()}
              </Avatar>
              <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                <Text fz={13.5} fw={600} truncate>
                  {product.partner.name}
                </Text>
                <Text fz={12} c="var(--agri-muted)">
                  Đối tác cung cấp
                </Text>
              </Stack>
              <GhostButton
                component={Link}
                href={`/doi-tac/${product.partner.id}`}
                size="compact-sm"
                radius={8}
              >
                Xem đối tác
              </GhostButton>
            </Group>

            <Divider />

            <Group gap={8} wrap="nowrap" align="flex-start">
              <IconQrcode size={16} color="var(--agri-primary)" style={{ marginTop: 2 }} aria-hidden />
              <Text fz={12.5} c="var(--agri-muted)" style={{ lineHeight: 1.45 }}>
                Sau khi mua, bạn xem được mã truy xuất của lô hàng thực tế trong chi tiết
                đơn hàng.{" "}
                <Text
                  component={Link}
                  href="/truy-xuat"
                  fz={12.5}
                  fw={600}
                  c="agri.9"
                >
                  Tra cứu mã truy xuất
                </Text>
              </Text>
            </Group>
          </Stack>
        </AppCard>

        {/* ------------------------------------------------------- reviews -- */}
        <AppCard radius={0} p={{ base: 12, sm: 16 }} style={{ borderLeft: "none", borderRight: "none" }}>
          <Stack gap={10}>
            <Text fz={15} fw={700} c="var(--agri-text-strong)">
              Đánh giá
            </Text>
            <ProductReviews productId={product.id} />
          </Stack>
        </AppCard>
      </Stack>

      {/* ------------------------------------------------- action bar ------- */}
      {selected ? (
        <BottomBar>
          <Stack gap={8}>
            {!isAuthenticated ? (
              <Text fz={12} c="var(--agri-muted)">
                Đăng nhập để đặt hàng.
              </Text>
            ) : null}
            <Group grow gap={8} wrap="nowrap">
              <GhostButton
                radius={8}
                size="md"
                leftSection={<IconShoppingCart size={18} aria-hidden />}
                onClick={handleAddToCart}
                loading={addToCart.isPending}
                disabled={!canBuySelected}
                styles={{
                  root: { minHeight: 48, borderWidth: 1.5 },
                  label: { fontSize: 14, fontWeight: 700 },
                }}
              >
                Thêm vào giỏ
              </GhostButton>
              <Button
                radius={8}
                size="md"
                onClick={handleBuyNow}
                loading={addToCart.isPending}
                disabled={!canBuySelected}
                styles={{ root: { minHeight: 48 }, label: { fontSize: 14, fontWeight: 700 } }}
              >
                Mua ngay
              </Button>
            </Group>
          </Stack>
        </BottomBar>
      ) : null}
    </Container>
  );
}

/** Small icon + label pair in the trust strip. */
function TrustItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Stack align="center" gap={4} style={{ flex: 1 }}>
      <Box
        w={38}
        h={38}
        style={{
          borderRadius: 999,
          background: "var(--agri-primary-soft)",
          display: "grid",
          placeItems: "center",
          color: "var(--agri-primary)",
        }}
      >
        {icon}
      </Box>
      <Text fz={11.5} fw={600}>
        {label}
      </Text>
    </Stack>
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
    return <Card padding="md" radius={12} withBorder h={120} />;
  }
  if (farmQuery.isError || !farmQuery.data) return null;

  const farm = farmQuery.data;

  return (
    <Stack gap={8}>
      <Group gap={8}>
        <IconLeaf size={18} color="var(--agri-primary)" aria-hidden />
        <Text fz={14.5} fw={700}>
          {farm.name}
        </Text>
      </Group>
      <KVRow label="Địa chỉ" value={farm.address} />
      {farm.areaHa ? (
        <KVRow
          label="Diện tích"
          value={`${Number(farm.areaHa).toLocaleString("vi-VN")} ha`}
        />
      ) : null}
      {farm.description ? (
        <Text fz={12.5} c="var(--agri-muted)" style={{ lineHeight: 1.45 }}>
          {farm.description}
        </Text>
      ) : null}
      <FarmCertificates farmId={farm.id} />
      <GhostButton
        component={Link}
        href={`/trang-trai/${farm.id}`}
        size="compact-sm"
        radius={8}
        w="fit-content"
      >
        Xem trang trại
      </GhostButton>
    </Stack>
  );
}
