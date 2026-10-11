"use client";

/**
 * Checkout.
 *
 * The amount shown before submitting comes from `POST /orders/checkout-preview`:
 * the backend resolves the price, applies the voucher, reports the shipping fee
 * and the live sellable quantity. Nothing is computed here, so the total on
 * screen is the total that will be charged — and a client-supplied shipping fee
 * cannot exist, because the checkout DTO has no such field (the API rejects it).
 *
 * Submitting uses an idempotency key: it is reused while the payload stays the
 * same, so a retry after a lost response returns the original order instead of
 * creating a second one. It is regenerated as soon as the payload changes or
 * after a successful order.
 *
 * Only COD is offered. `PaymentMethod.VNPAY` / `MOCK_ONLINE` exist in the enum
 * but no gateway or payment-initiation endpoint exists, so no online payment UI
 * is shown.
 */

import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Modal,
  Radio,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCheck,
  IconMapPin,
  IconPlus,
  IconTicket,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@/lib/api/client";
import { resources, type CheckoutPayload } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import {
  addressFormSchema,
  formatAddressLine,
  newAddressForm,
  toAddressPayload,
  type AddressFormValues,
} from "@/lib/address";
import { formatDate, formatMoney } from "@/lib/format";
import { useCartProducts } from "@/lib/hooks/useCartProducts";
import { useDebounced } from "@/lib/hooks/useDebouncedValue";
import { EmptyCartState, ErrorState, ListSkeleton } from "@/components/common/States";
import { WardPicker } from "@/components/common/WardPicker";
import { layout } from "@/theme";

/** `crypto.randomUUID` needs a secure context; this works everywhere. */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ck-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function CheckoutView() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [voucherCode, setVoucherCode] = useState("");
  const [note, setNote] = useState("");
  const [addressModalOpened, addressModal] = useDisclosure(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const cartQuery = useQuery({
    queryKey: queryKeys.cart.me(),
    queryFn: resources.getCart,
  });

  const addressesQuery = useQuery({
    queryKey: queryKeys.addresses.me(),
    queryFn: resources.listAddresses,
  });

  const vouchersQuery = useQuery({
    queryKey: queryKeys.vouchers.list(50),
    queryFn: () => resources.listVouchers(50),
    staleTime: 60_000,
  });

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors },
  } = useForm<AddressFormValues>({
    resolver: zodResolver(addressFormSchema),
    defaultValues: newAddressForm(""),
  });

  // `useWatch` rather than the form's `watch()`: `watch` returns a fresh
  // function on every render, which the React Compiler cannot memoize safely.
  const formProvinceCode = useWatch({ control, name: "provinceCode" });
  const formWardCode = useWatch({ control, name: "wardCode" });

  const provincesQuery = useQuery({
    queryKey: queryKeys.locations.provinces(),
    queryFn: resources.listProvinces,
    staleTime: 60 * 60_000,
  });

  // Derived list state is declared before the mutations that read it: a
  // mutation defined above would close over the binding before it is
  // initialised, which is exactly what the React Compiler refuses to memoize.
  const items = useMemo(() => cartQuery.data?.items ?? [], [cartQuery.data]);
  const addresses = useMemo(() => addressesQuery.data ?? [], [addressesQuery.data]);

  const formProvinceName = useMemo(
    () => provincesQuery.data?.find((p) => p.code === formProvinceCode)?.name ?? "",
    [provincesQuery.data, formProvinceCode],
  );

  const openAddressModal = () => {
    reset(newAddressForm(provincesQuery.data?.[0]?.code ?? ""));
    addressModal.open();
  };

  const createAddress = useMutation({
    mutationFn: (values: AddressFormValues) =>
      resources.createAddress({
        ...toAddressPayload(values, formProvinceName),
        isDefault: addresses.length === 0,
      }),
    onSuccess: (address) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.addresses.all });
      setSelectedAddressId(address.id);
      addressModal.close();
      reset(newAddressForm(""));
      notifications.show({
        title: "Đã thêm địa chỉ",
        message: "Địa chỉ giao hàng mới đã được lưu.",
        color: "agri",
        icon: <IconCheck size={16} />,
      });
    },
    onError: (error) => {
      notifications.show({
        title: "Không lưu được địa chỉ",
        message: error instanceof ApiError ? error.message : "Vui lòng thử lại.",
        color: "red",
      });
    },
  });

  /** Voucher typing is debounced so the preview is not re-fetched per keystroke. */
  const debouncedVoucher = useDebounced(voucherCode.trim(), 400);

  const previewQuery = useQuery({
    queryKey: ["checkout", "preview", debouncedVoucher || null, items.length],
    queryFn: () =>
      resources.checkoutPreview({
        voucherCode: debouncedVoucher || undefined,
      }),
    enabled: items.length > 0,
    retry: false,
  });

  const preview = previewQuery.data;

  /**
   * The cart API sends only `product.partnerId` (no `partner` relation), so
   * partner names are resolved from the public product resource.
   */
  const productIds = useMemo(
    () => items.map((item) => item.productVariant.product.id),
    [items],
  );
  const products = useCartProducts(productIds);

  /** Partner name for a cart line, or a neutral label while it is loading. */
  const partnerNameOf = (productId: number): string =>
    products.get(productId)?.partner.name ?? "Đang tải tên đối tác…";

  const selectedAddress = useMemo(() => {
    if (addresses.length === 0) return null;
    if (selectedAddressId !== null) {
      return addresses.find((a) => a.id === selectedAddressId) ?? addresses[0];
    }
    return addresses.find((a) => a.isDefault) ?? addresses[0];
  }, [addresses, selectedAddressId]);

  /**
   * Any change to the order invalidates a previous submit error: the message
   * belonged to the old payload, and the button must not stay blocked by it.
   */
  const selectAddress = (id: number) => {
    setSelectedAddressId(id);
    setSubmitError(null);
  };

  /** Authoritative line data, keyed by variant, from the preview response. */
  const previewLineByVariant = useMemo(() => {
    const map = new Map<number, NonNullable<typeof preview>["items"][number]>();
    for (const line of preview?.items ?? []) map.set(line.productVariantId, line);
    return map;
  }, [preview]);

  /**
   * Partner groups, mirroring the backend's per-partner split. Keyed on
   * `partnerId` so the memo does not depend on the product lookup map; names and
   * amounts are resolved while rendering.
   */
  const groups = useMemo(() => {
    const map = new Map<number, { count: number; productIds: number[] }>();
    for (const item of items) {
      const product = item.productVariant.product;
      const existing = map.get(product.partnerId);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(product.partnerId, { count: 1, productIds: [product.id] });
      }
    }
    return Array.from(map, ([partnerId, group]) => ({ partnerId, ...group }));
  }, [items]);

  const buildPayload = (): CheckoutPayload | null => {
    if (!selectedAddress) return null;
    return {
      shippingAddress: {
        recipientName: selectedAddress.recipientName,
        phone: selectedAddress.phone,
        province: selectedAddress.province,
        // A code-verified address sends the official pair so the backend can
        // re-resolve the commune and snapshot the OFFICIAL name; a legacy
        // address sends its own free text and is snapshotted as-is.
        provinceCode: selectedAddress.provinceCode ?? undefined,
        wardCode: selectedAddress.wardCode ?? undefined,
        district: selectedAddress.wardCode ? undefined : (selectedAddress.district ?? undefined),
        ward: selectedAddress.wardCode ? undefined : (selectedAddress.ward ?? undefined),
        village: selectedAddress.village ?? undefined,
        detail: selectedAddress.detail,
      },
      voucherCode: voucherCode.trim() || undefined,
      paymentMethod: "COD",
      note: note.trim() || undefined,
      // The total the customer is looking at. If the price or a promotion
      // changed since the preview, the backend refuses with a 409 instead of
      // silently charging a different amount.
      expectedGrandTotal: preview?.grandTotal,
    };
  };

  /**
   * One idempotency key per payload: a retry of the same order reuses it (so a
   * lost response cannot create a duplicate), while any change to the order
   * gets a new key. Cleared after a successful checkout.
   */
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null);
  const idempotencyKeyFor = (payload: CheckoutPayload): string => {
    const signature = JSON.stringify(payload);
    if (!idempotencyRef.current || idempotencyRef.current.signature !== signature) {
      idempotencyRef.current = { signature, key: newIdempotencyKey() };
    }
    return idempotencyRef.current.key;
  };

  const checkout = useMutation({
    mutationFn: ({ payload, key }: { payload: CheckoutPayload; key: string }) =>
      resources.checkout(payload, key),
    onSuccess: (order) => {
      idempotencyRef.current = null;
      // The cart lines were consumed server-side; refresh derived state.
      queryClient.invalidateQueries({ queryKey: queryKeys.cart.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      router.replace(`/dat-hang-thanh-cong/${order.id}`);
    },
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : "Không đặt được hàng. Vui lòng kiểm tra lại giỏ hàng.";
      setSubmitError(message);
      // A 409 means the total moved under the customer (a flash sale ended, a
      // voucher ran out, …). Pull a fresh preview so the new amount is on
      // screen and the next confirm sends the updated `expectedGrandTotal`.
      if (error instanceof ApiError && error.status === 409) {
        void previewQuery.refetch();
      }
      notifications.show({
        title: "Đặt hàng chưa thành công",
        message,
        color: "red",
        icon: <IconAlertTriangle size={16} />,
      });
    },
  });

  /** A preview line that reports no sellable stock blocks the submit. */
  const unavailableLines = useMemo(
    () => (preview?.items ?? []).filter((line) => !line.available),
    [preview],
  );

  const handlePlaceOrder = () => {
    setSubmitError(null);
    const payload = buildPayload();
    if (!payload) {
      setSubmitError("Vui lòng chọn địa chỉ giao hàng.");
      return;
    }
    if (items.length === 0) {
      setSubmitError("Giỏ hàng đang trống.");
      return;
    }
    // The preview total is the contract that prevents a silent re-price: never
    // confirm without echoing the amount the customer actually saw.
    if (preview?.grandTotal === undefined) {
      setSubmitError("Đang kiểm tra lại giá và tồn kho. Vui lòng thử lại sau giây lát.");
      void previewQuery.refetch();
      return;
    }
    checkout.mutate({ payload, key: idempotencyKeyFor(payload) });
  };

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

  if (items.length === 0) {
    return (
      <Container size={layout.containerSize} py="xl">
        <EmptyCartState
          action={
            <Button component={Link} href="/san-pham">
              Mua nông sản
            </Button>
          }
        />
      </Container>
    );
  }

  return (
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Title order={2}>Thanh toán</Title>

        <Group align="flex-start" gap="lg" wrap="wrap">
          <Stack gap="md" style={{ flex: 1, minWidth: 300 }}>
            {/* Address */}
            <Card padding="lg" radius="md" withBorder>
              <Stack gap="md">
                <Group justify="space-between" wrap="wrap">
                  <Group gap="sm">
                    <IconMapPin size={18} color="var(--mantine-color-agri-8)" />
                    <Title order={4}>Địa chỉ giao hàng</Title>
                  </Group>
                  <Button
                    variant="light"
                    size="xs"
                    leftSection={<IconPlus size={14} />}
                    onClick={openAddressModal}
                  >
                    Thêm địa chỉ
                  </Button>
                </Group>

                <Divider />

                {addressesQuery.isError ? (
                  <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                    <Text size="sm">
                      Chưa tải được sổ địa chỉ. Bạn vẫn có thể thêm địa chỉ mới.
                    </Text>
                  </Alert>
                ) : addresses.length === 0 ? (
                  <Alert color="orange" variant="light" icon={<IconAlertCircle size={16} />}>
                    <Text size="sm">
                      Bạn chưa có địa chỉ giao hàng nào. Vui lòng thêm địa chỉ để đặt hàng.
                    </Text>
                  </Alert>
                ) : (
                  <Radio.Group
                    value={selectedAddress ? String(selectedAddress.id) : null}
                    onChange={(value) => selectAddress(Number(value))}
                  >
                    <Stack gap="sm">
                      {addresses.map((address) => (
                        <Card
                          key={address.id}
                          padding="sm"
                          radius="md"
                          withBorder
                          onClick={() => selectAddress(address.id)}
                          style={{ cursor: "pointer" }}
                        >
                          <Radio
                            value={String(address.id)}
                            label={
                              <Stack gap={2} pl={4}>
                                <Group gap="xs">
                                  <Text size="sm" fw={600}>
                                    {address.recipientName}
                                  </Text>
                                  <Text size="sm" c="dimmed">
                                    {address.phone}
                                  </Text>
                                  {address.isDefault ? (
                                    <Badge size="xs" variant="light" color="agri" radius="sm">
                                      Mặc định
                                    </Badge>
                                  ) : null}
                                  {address.wardCode ? null : (
                                    <Badge size="xs" variant="light" color="gray" radius="sm">
                                      Địa chỉ cũ
                                    </Badge>
                                  )}
                                </Group>
                                <Text size="xs" c="dimmed">
                                  {formatAddressLine(address)}
                                </Text>
                              </Stack>
                            }
                          />
                        </Card>
                      ))}
                    </Stack>
                  </Radio.Group>
                )}

                <Button component={Link} href="/tai-khoan/dia-chi" variant="subtle" size="xs" w="fit-content">
                  Quản lý sổ địa chỉ
                </Button>
              </Stack>
            </Card>

            {/* Partner groups */}
            <Card padding="lg" radius="md" withBorder>
              <Stack gap="md">
                <Group justify="space-between" wrap="wrap">
                  <Title order={4}>Đơn hàng của bạn</Title>
                  {groups.length > 1 ? (
                    <Badge variant="light" color="blue" radius="sm">
                      Đơn hàng gồm {groups.length} kiện từ {groups.length} đối tác
                    </Badge>
                  ) : null}
                </Group>
                <Divider />

                {groups.map((group) => (
                  <Stack key={group.partnerId} gap="xs">
                    <Group justify="space-between" wrap="wrap">
                      <Text size="sm" fw={600}>
                        {partnerNameOf(group.productIds[0])}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {group.count} sản phẩm
                      </Text>
                    </Group>
                    <Stack gap={4}>
                      {items
                        .filter(
                          (item) =>
                            item.productVariant.product.partnerId === group.partnerId,
                        )
                        .map((item) => {
                          const line = previewLineByVariant.get(item.productVariantId);
                          return (
                            <Group key={item.id} justify="space-between" wrap="nowrap" gap="sm">
                              <Text size="sm" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
                                {item.productVariant.product.name} ·{" "}
                                {item.productVariant.name} × {Number(item.quantity)}
                              </Text>
                              {line ? (
                                <Text size="sm" style={{ flexShrink: 0 }}>
                                  {formatMoney(line.subtotal)}
                                </Text>
                              ) : (
                                <Skeleton height={16} width={72} radius="sm" />
                              )}
                            </Group>
                          );
                        })}
                    </Stack>
                    <Divider />
                  </Stack>
                ))}

                <Textarea
                  label="Ghi chú cho đơn hàng"
                  placeholder="Ví dụ: giao trong giờ hành chính"
                  value={note}
                  onChange={(event) => {
                    setNote(event.currentTarget.value);
                    setSubmitError(null);
                  }}
                  autosize
                  minRows={2}
                />
              </Stack>
            </Card>

            {/* Voucher */}
            <Card padding="lg" radius="md" withBorder>
              <Stack gap="md">
                <Group gap="sm">
                  <IconTicket size={18} color="var(--mantine-color-agri-8)" />
                  <Title order={4}>Mã giảm giá</Title>
                </Group>
                <Divider />

                <TextInput
                  label="Mã giảm giá"
                  placeholder="Nhập mã, ví dụ HUNGYEN50K"
                  value={voucherCode}
                  onChange={(event) => {
                    setVoucherCode(event.currentTarget.value.toUpperCase());
                    setSubmitError(null);
                  }}
                  description="Hệ thống kiểm tra điều kiện áp dụng và hiển thị số tiền giảm ngay bên dưới."
                />

                {(vouchersQuery.data?.data ?? []).length > 0 ? (
                  <Stack gap="xs">
                    <Text size="sm" fw={600}>
                      Mã đang áp dụng trên sàn
                    </Text>
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                      {(vouchersQuery.data?.data ?? []).map((voucher) => (
                        <Card
                          key={voucher.id}
                          padding="sm"
                          radius="md"
                          withBorder
                          onClick={() => {
                            setVoucherCode(voucher.code);
                            setSubmitError(null);
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          <Stack gap={4}>
                            <Group gap="xs" wrap="wrap">
                              <Text size="sm" fw={700}>
                                {voucher.code}
                              </Text>
                              <Badge size="xs" variant="light" color="agri" radius="sm">
                                {voucher.discountType === "PERCENT"
                                  ? `Giảm ${Number(voucher.discountValue)}%`
                                  : `Giảm ${formatMoney(voucher.discountValue)}`}
                              </Badge>
                            </Group>
                            <Text size="xs" c="dimmed">
                              {voucher.name}
                            </Text>
                            <Text size="xs" c="dimmed">
                              Đơn từ {formatMoney(voucher.minOrderAmount)}
                              {voucher.maxDiscount
                                ? ` · tối đa ${formatMoney(voucher.maxDiscount)}`
                                : ""}
                            </Text>
                            <Text size="xs" c="dimmed">
                              Hiệu lực đến {formatDate(voucher.endsAt)}
                            </Text>
                          </Stack>
                        </Card>
                      ))}
                    </SimpleGrid>
                  </Stack>
                ) : null}
              </Stack>
            </Card>

            {/* Payment */}
            <Card padding="lg" radius="md" withBorder>
              <Stack gap="md">
                <Title order={4}>Phương thức thanh toán</Title>
                <Divider />
                <Radio.Group value="COD">
                  <Radio
                    value="COD"
                    label={
                      <Stack gap={2} pl={4}>
                        <Text size="sm" fw={600}>
                          Thanh toán khi nhận hàng (COD)
                        </Text>
                        <Text size="xs" c="dimmed">
                          Đơn hàng ở trạng thái chờ thanh toán cho đến khi bạn nhận hàng.
                        </Text>
                      </Stack>
                    }
                  />
                </Radio.Group>
                <Alert color="gray" variant="light" icon={<IconAlertCircle size={15} />}>
                  <Text size="xs">
                    Thanh toán trực tuyến (VNPay) chưa được mở trên hệ thống. Hiện chỉ hỗ
                    trợ COD.
                  </Text>
                </Alert>
              </Stack>
            </Card>
          </Stack>

          {/* Summary */}
          <Card
            padding="lg"
            radius="md"
            withBorder
            w={{ base: "100%", md: 340 }}
            style={{ flexShrink: 0 }}
          >
            <Stack gap="md">
              <Title order={4}>Tổng kết đơn hàng</Title>

              {previewQuery.isLoading ? (
                <Stack gap="xs">
                  <Skeleton height={18} radius="sm" />
                  <Skeleton height={18} radius="sm" />
                  <Skeleton height={18} radius="sm" />
                </Stack>
              ) : null}

              {previewQuery.isError ? (
                <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
                  <Stack gap="sm">
                    <Text size="sm">
                      {previewQuery.error instanceof ApiError
                        ? previewQuery.error.message
                        : "Chưa kiểm tra được giá và tồn kho."}
                    </Text>
                    <Button
                      variant="light"
                      color="red"
                      size="xs"
                      w="fit-content"
                      onClick={() => previewQuery.refetch()}
                    >
                      Kiểm tra lại
                    </Button>
                  </Stack>
                </Alert>
              ) : null}

              {preview ? (
                <>
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">
                        Tạm tính ({preview.itemCount} sản phẩm)
                      </Text>
                      <Text size="sm">{formatMoney(preview.subtotal)}</Text>
                    </Group>
                    {preview.discountTotal > 0 ? (
                      <Group justify="space-between">
                        <Text size="sm" c="dimmed">
                          Giảm giá{preview.voucher ? ` (${preview.voucher.code})` : ""}
                        </Text>
                        <Text size="sm" c="agri.7">
                          −{formatMoney(preview.discountTotal)}
                        </Text>
                      </Group>
                    ) : null}
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">
                        Phí giao hàng
                      </Text>
                      <Text size="sm">{formatMoney(preview.shippingFee)}</Text>
                    </Group>
                  </Stack>

                  <Divider />

                  <Group justify="space-between">
                    <Text size="sm" fw={600}>
                      Tổng thanh toán
                    </Text>
                    <Text size="lg" fw={700} c="agri.8">
                      {formatMoney(preview.grandTotal)}
                    </Text>
                  </Group>
                </>
              ) : null}

              {unavailableLines.length > 0 ? (
                <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
                  <Text size="xs">
                    Có {unavailableLines.length} sản phẩm không còn đủ hàng cho số lượng bạn
                    chọn. Vui lòng giảm số lượng trong giỏ hàng trước khi đặt.
                  </Text>
                </Alert>
              ) : null}

              {submitError ? (
                <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
                  <Stack gap="sm">
                    <Text size="sm">{submitError}</Text>
                    <Button
                      variant="light"
                      color="red"
                      size="xs"
                      w="fit-content"
                      onClick={() => {
                        setSubmitError(null);
                        cartQuery.refetch();
                        previewQuery.refetch();
                      }}
                    >
                      Tải lại giỏ hàng
                    </Button>
                  </Stack>
                </Alert>
              ) : null}

              <Button
                size="md"
                fullWidth
                onClick={handlePlaceOrder}
                loading={checkout.isPending}
                disabled={
                  checkout.isPending ||
                  !selectedAddress ||
                  unavailableLines.length > 0 ||
                  previewQuery.isLoading ||
                  !preview
                }
              >
                Đặt hàng (COD)
              </Button>

              <Text size="xs" c="dimmed" ta="center">
                Bằng việc đặt hàng, bạn đồng ý để hệ thống kiểm tra lại giá và tồn kho của
                từng sản phẩm.
              </Text>

              <Button component={Link} href="/gio-hang" variant="subtle" size="sm" fullWidth>
                Về giỏ hàng
              </Button>
            </Stack>
          </Card>
        </Group>
      </Stack>

      <Modal
        opened={addressModalOpened}
        onClose={addressModal.close}
        title="Thêm địa chỉ giao hàng"
        centered
        size="md"
      >
        <form onSubmit={handleSubmit((values) => createAddress.mutate(values))}>
          <Stack gap="md">
            <Group grow align="flex-start">
              <TextInput
                label="Tên người nhận"
                required
                error={errors.recipientName?.message}
                {...register("recipientName")}
              />
              <TextInput
                label="Số điện thoại"
                required
                error={errors.phone?.message}
                {...register("phone")}
              />
            </Group>
            <WardPicker
              provinceCode={formProvinceCode}
              wardCode={formWardCode}
              onProvinceChange={(code) => {
                setValue("provinceCode", code, { shouldValidate: true });
                setValue("wardCode", "", { shouldValidate: false });
              }}
              onWardChange={(code) => setValue("wardCode", code, { shouldValidate: true })}
              provinceError={errors.provinceCode?.message}
              wardError={errors.wardCode?.message}
              disabled={createAddress.isPending}
            />
            <TextInput
              label="Thôn / Tổ dân phố"
              placeholder="Không bắt buộc"
              error={errors.village?.message}
              {...register("village")}
            />
            <TextInput
              label="Địa chỉ chi tiết"
              placeholder="Số nhà, đường"
              required
              error={errors.detail?.message}
              {...register("detail")}
            />
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={addressModal.close} type="button">
                Hủy
              </Button>
              <Button type="submit" loading={createAddress.isPending}>
                Lưu địa chỉ
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Container>
  );
}
