"use client";

/**
 * Checkout — the web twin of the Mobile checkout screen.
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
 * after a successful order. A 409 is classified (`lib/checkout.ts`): a re-price
 * asks for one explicit confirmation of the NEW amount; an in-flight retry
 * needs no confirmation at all.
 *
 * Only COD is offered. `PaymentMethod.VNPAY` / `MOCK_ONLINE` exist in the enum
 * but no gateway or payment-initiation endpoint exists, so no online payment UI
 * is shown.
 *
 * TWO MODES, ONE FLOW
 *
 * `/thanh-toan` checks out the cart; `/thanh-toan?mua-ngay=<variantId>:<qty>`
 * ("Mua ngay") checks out exactly that one line and leaves the cart untouched.
 * Both modes run through the same preview + idempotent submit path, and the
 * payload is built by the shared `buildCheckoutPayload` helper, so the Web and
 * Mobile flows cannot diverge.
 */

import {
  Box,
  Button,
  Container,
  Divider,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconCash,
  IconChevronDown,
  IconChevronUp,
  IconCircle,
  IconCircleCheck,
  IconCircleDot,
  IconEdit,
  IconMapPin,
  IconMessageCircle,
  IconPlus,
  IconReceipt,
  IconTag,
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
import {
  buildCheckoutPayload,
  checkoutErrorMessage,
  classifyCheckoutConflict,
  needsTotalConfirm,
  parseBuyNowParam,
  translatedMessage,
} from "@/lib/checkout";
import { formatMoney, formatQuantity } from "@/lib/format";
import { splitVouchers, voucherValueLabel } from "@/lib/vouchers";
import { EmptyState, ErrorState } from "@/components/common/States";
import { WardPicker } from "@/components/common/WardPicker";
import {
  AppCard,
  BottomBar,
  GhostButton,
  LoadingView,
  PageTitle,
  ToneBadge,
} from "@/components/ui/kit";
import { layout } from "@/theme";
import type { Address } from "@/lib/api/types";

/** `crypto.randomUUID` needs a secure context; this works everywhere. */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ck-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Compact error line inside a card (Mobile `ErrorView` at card scale). */
function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Group gap={6} wrap="nowrap" align="center">
      <IconAlertCircle size={15} color="var(--agri-danger)" style={{ flexShrink: 0 }} />
      <Text fz={12.5} c="var(--agri-danger)" style={{ flex: 1 }}>
        {message}
      </Text>
      {onRetry ? (
        <Text
          component="button"
          type="button"
          fz={12.5}
          fw={700}
          c="var(--agri-danger)"
          onClick={onRetry}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Thử lại
        </Text>
      ) : null}
    </Group>
  );
}

export function CheckoutView({ buyNowRaw }: { buyNowRaw?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  /**
   * "Mua ngay" (`/thanh-toan?mua-ngay=<variantId>:<quantity>`): checkout with
   * exactly the tapped line, WITHOUT going through the cart — the cart keeps
   * whatever it already holds. Absent (undefined) -> normal cart checkout;
   * present but malformed -> an explicit error state, never a silent fallback
   * to the cart (that fallback is the bug this mode replaces).
   */
  const hasBuyNow = buyNowRaw !== undefined;
  const directItems = useMemo(
    () => (hasBuyNow ? parseBuyNowParam(buyNowRaw) : null),
    [buyNowRaw, hasBuyNow],
  );
  const buyNowInvalid = hasBuyNow && directItems === null;

  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherPickerOpen, setVoucherPickerOpen] = useState(false);
  const [note, setNote] = useState("");
  const [addressModalOpened, addressModal] = useDisclosure(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /**
   * The total the customer must accept before submitting, or `null`.
   *
   * Set ONLY by the 409 re-price path: the preview is trusted on arrival, so a
   * first visit needs no confirmation at all. Cleared the moment the customer
   * edits the order (address, voucher), because then the refreshed preview IS
   * their own new total.
   */
  const [pendingTotal, setPendingTotal] = useState<number | null>(null);

  const cartQuery = useQuery({
    queryKey: queryKeys.cart.me(),
    queryFn: resources.getCart,
    // A "Mua ngay" checkout must not depend on the cart (it is not read at all).
    enabled: !hasBuyNow,
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
  //
  // The ordered lines are the "Mua ngay" line when present, otherwise the cart.
  // Quantities come back as Decimal strings, so they are numbers here — the same
  // normalisation the Mobile app performs.
  const items = useMemo(
    () =>
      directItems ??
      (cartQuery.data?.items ?? []).map((item) => ({
        productVariantId: item.productVariantId,
        quantity: Number(item.quantity),
      })),
    [cartQuery.data, directItems],
  );
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
        icon: <IconCircleCheck size={16} />,
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

  const voucher = voucherCode.trim();

  /**
   * The preview prices the exact lines in the signature — the buy-now line or
   * the cart lines — so the endpoint never has to be trusted to guess the right
   * selection. The same inputs (lines + voucher) always produce the same
   * preview, which is why the key is shared with the cart screen when no
   * voucher is applied.
   */
  const itemSignature = items
    .map((item) => `${item.productVariantId}:${item.quantity}`)
    .join(",");

  const previewQuery = useQuery({
    queryKey: queryKeys.checkout.preview(itemSignature, voucher),
    queryFn: () =>
      resources.checkoutPreview({
        items: items.length > 0 ? items : undefined,
        voucherCode: voucher || undefined,
      }),
    enabled: items.length > 0,
    retry: false,
  });

  const preview = previewQuery.data;

  /** Voucher ordering per the backend's own rules; every amount comes from the preview. */
  const voucherGroups = useMemo(
    () => splitVouchers(vouchersQuery.data?.data ?? [], preview?.subtotal ?? 0),
    [vouchersQuery.data, preview],
  );

  const selectedAddress = useMemo(() => {
    if (addresses.length === 0) return null;
    if (selectedAddressId !== null) {
      return addresses.find((a) => a.id === selectedAddressId) ?? addresses[0];
    }
    return addresses.find((a) => a.isDefault) ?? addresses[0];
  }, [addresses, selectedAddressId]);

  /**
   * Any change to the order invalidates a previous submit error (the message
   * belonged to the old payload) and any pending re-price confirmation (the new
   * preview is the customer's own total, so nothing needs confirming).
   */
  const selectAddress = (id: number) => {
    setSelectedAddressId(id);
    setSubmitError(null);
    setPendingTotal(null);
  };

  const chooseVoucher = (code: string) => {
    setVoucherCode(code);
    setSubmitError(null);
    setPendingTotal(null);
    setVoucherPickerOpen(false);
  };

  const clearVoucher = () => {
    setVoucherCode("");
    setSubmitError(null);
    setPendingTotal(null);
    setVoucherPickerOpen(false);
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
      // Only a cart checkout consumed cart lines. A "Mua ngay" order leaves the
      // cart byte-for-byte as it was, so refetching it would be wasted work.
      if (!hasBuyNow) {
        queryClient.invalidateQueries({ queryKey: queryKeys.cart.all });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      router.replace(`/dat-hang-thanh-cong/${order.id}`);
    },
    onError: (error) => {
      const conflict = classifyCheckoutConflict(error);
      let message: string;
      if (conflict === "in-flight") {
        // Same request, still processing. Retrying with the SAME key is correct
        // and safe, so no confirmation is demanded — that would force the
        // customer to re-confirm a total that never changed.
        message =
          "Đơn hàng trước đang được xử lý. Vui lòng đợi vài giây rồi bấm đặt hàng lại (không tạo đơn trùng).";
      } else if (conflict === "total-changed") {
        // The price/voucher/stock really did move: refresh the preview and make
        // the customer accept the NEW amount before submitting again.
        if (preview) setPendingTotal(preview.grandTotal);
        void previewQuery.refetch();
        // Same wording as the Mobile app: the backend's translated message when
        // it names the exact rule, otherwise a cause-specific sentence.
        message = checkoutErrorMessage(error, translatedMessage(error));
      } else {
        message = checkoutErrorMessage(error, translatedMessage(error));
      }
      setSubmitError(message);
      notifications.show({
        title: "Đặt hàng chưa thành công",
        message,
        color: "red",
        icon: <IconAlertCircle size={16} />,
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
    if (!selectedAddress) {
      setSubmitError("Vui lòng chọn địa chỉ giao hàng.");
      return;
    }
    if (items.length === 0) {
      setSubmitError(hasBuyNow ? "Dòng hàng mua ngay không hợp lệ." : "Giỏ hàng đang trống.");
      return;
    }
    // The preview total is the contract that prevents a silent re-price: never
    // confirm without echoing the amount the customer actually saw.
    if (!preview) {
      setSubmitError("Đang kiểm tra lại giá và tồn kho. Vui lòng thử lại sau giây lát.");
      void previewQuery.refetch();
      return;
    }
    const payload = buildCheckoutPayload(
      selectedAddress,
      items,
      voucher,
      note,
      preview,
      // The one thing that decides whether the backend may consume cart lines.
      hasBuyNow ? "BUY_NOW" : "CART",
    );
    checkout.mutate({ payload, key: idempotencyKeyFor(payload) });
  };

  /* ------------------------------------------------------------- states -- */

  if (!hasBuyNow && cartQuery.isLoading) {
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 16, sm: 24 }}>
        <LoadingView label="Đang tải giỏ hàng…" />
      </Container>
    );
  }

  if (!hasBuyNow && cartQuery.isError) {
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 16, sm: 24 }}>
        <ErrorState error={cartQuery.error} onRetry={() => cartQuery.refetch()} />
      </Container>
    );
  }

  if (buyNowInvalid || items.length === 0) {
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 16, sm: 24 }}>
        <EmptyState
          kind="cart"
          title={buyNowInvalid ? "Dòng hàng không hợp lệ" : "Chưa có sản phẩm để đặt"}
          description={
            buyNowInvalid
              ? "Thông tin mua ngay không đọc được. Vui lòng chọn lại sản phẩm."
              : "Thêm sản phẩm vào giỏ hàng trước khi đặt hàng."
          }
          action={
            <Button component={Link} href="/san-pham" radius={8}>
              Xem sản phẩm
            </Button>
          }
        />
      </Container>
    );
  }

  /* --------------------------------------------------------------- ready -- */

  const appliedCode = preview?.voucher?.code ?? null;
  const voucherDiscount = preview?.voucher?.discountAmount ?? 0;
  const grandTotal = preview?.grandTotal;
  const confirmTotal = needsTotalConfirm(preview, pendingTotal);
  const hasUnavailable = unavailableLines.length > 0;
  const canSubmit =
    !checkout.isPending &&
    selectedAddress !== null &&
    preview !== undefined &&
    !hasUnavailable;

  const renderAddress = (address: Address) => {
    const active = selectedAddress?.id === address.id;
    const catalogue = Boolean(address.wardCode);
    return (
      <Box
        key={address.id}
        role="button"
        tabIndex={0}
        aria-pressed={active}
        onClick={() => selectAddress(address.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectAddress(address.id);
          }
        }}
        className="agri-press"
        style={{
          border: active
            ? "1.5px solid var(--agri-primary)"
            : "1px solid var(--agri-border)",
          background: active ? "var(--agri-primary-soft)" : "var(--agri-surface)",
          borderRadius: 8,
          padding: 12,
          marginBottom: 8,
          cursor: "pointer",
        }}
      >
        <Group gap={6} wrap="nowrap">
          {active ? (
            <IconCircleDot size={18} color="var(--agri-primary)" aria-hidden />
          ) : (
            <IconCircle size={18} color="var(--agri-muted-soft)" aria-hidden />
          )}
          {/* The name/phone line gets the full width; the badges sit on their
              own row so a long phone number is never clipped. */}
          <Text fz={14} fw={600} c="var(--agri-text)" truncate style={{ flex: 1 }}>
            {address.recipientName} · {address.phone}
          </Text>
        </Group>
        {address.isDefault || !catalogue ? (
          <Group gap={6} mt={4} ml={24}>
            {address.isDefault ? <ToneBadge tone="green">Mặc định</ToneBadge> : null}
            {catalogue ? null : <ToneBadge tone="gray">Địa chỉ cũ</ToneBadge>}
          </Group>
        ) : null}
        <Text fz={12.5} c="var(--agri-muted)" mt={4} ml={24} style={{ lineHeight: "18px" }}>
          {formatAddressLine(address)}
        </Text>
        {catalogue ? null : (
          <Text fz={12} c="var(--agri-warning)" mt={2} ml={24} style={{ lineHeight: "17px" }}>
            Địa chỉ lưu trước cập nhật danh mục 2025. Vào sổ địa chỉ để chọn lại xã/phường.
          </Text>
        )}
      </Box>
    );
  };

  return (
    <Container
      size={layout.containerSize}
      px={{ base: 12, sm: "lg" }}
      py={{ base: 12, sm: 24 }}
      pb={{ base: 132, sm: 24 }}
    >
      <Stack gap={12}>
        <PageTitle>Đặt hàng</PageTitle>

        <Group align="flex-start" gap={12} wrap="wrap">
          <Stack gap={8} style={{ flex: "1 1 420px", minWidth: 0 }}>
            {/* ------------------------------------------------------ address -- */}
            <AppCard>
              <Group gap={6} wrap="nowrap" mb={8}>
                <IconMapPin size={17} color="var(--agri-primary)" aria-hidden />
                <Text fz={15} fw={700} c="var(--agri-text-strong)" style={{ flex: 1 }}>
                  Địa chỉ giao hàng
                </Text>
              </Group>

              {addressesQuery.isLoading ? <LoadingView label="Đang tải địa chỉ…" /> : null}
              {addressesQuery.isError ? (
                <InlineError
                  message={
                    addressesQuery.error instanceof ApiError
                      ? addressesQuery.error.message
                      : "Không tải được địa chỉ."
                  }
                  onRetry={() => addressesQuery.refetch()}
                />
              ) : null}

              {addresses.map(renderAddress)}

              {!addressesQuery.isLoading && !addressesQuery.isError && addresses.length === 0 ? (
                <Stack gap={8}>
                  <Text fz={13} c="var(--agri-muted)">
                    Chưa có địa chỉ giao hàng.
                  </Text>
                  <GhostButton
                    onClick={openAddressModal}
                    leftSection={<IconPlus size={14} aria-hidden />}
                    radius={8}
                    w="fit-content"
                  >
                    Thêm địa chỉ
                  </GhostButton>
                </Stack>
              ) : null}

              {addresses.length > 0 ? (
                <UnstyledRow
                  onClick={() => router.push("/tai-khoan/dia-chi")}
                  ariaLabel="Quản lý sổ địa chỉ"
                >
                  <IconEdit size={15} color="var(--agri-primary)" aria-hidden />
                  <Text fz={13} fw={700} c="var(--agri-primary)">
                    Quản lý sổ địa chỉ
                  </Text>
                </UnstyledRow>
              ) : null}
            </AppCard>

            {/* ------------------------------------------------------ voucher -- */}
            <AppCard>
              <Group gap={6} wrap="nowrap" mb={8}>
                <IconTag size={17} color="var(--agri-primary)" aria-hidden />
                <Text fz={15} fw={700} c="var(--agri-text-strong)" style={{ flex: 1 }}>
                  Mã giảm giá
                </Text>
                {vouchersQuery.data ? (
                  <Text fz={12} fw={700} c="var(--agri-primary)">
                    {voucherGroups.eligible.length > 0
                      ? `${voucherGroups.eligible.length} mã dùng được`
                      : "Chưa có mã"}
                  </Text>
                ) : null}
              </Group>

              {/* Applied state: the code and the amount come from the preview. */}
              {appliedCode && voucherDiscount > 0 ? (
                <Group
                  gap={10}
                  wrap="nowrap"
                  style={{
                    border: "1px solid var(--agri-primary)",
                    borderRadius: 8,
                    padding: "0 12px",
                    minHeight: 44,
                    background: "var(--agri-primary-soft)",
                  }}
                >
                  <IconCircleCheck size={16} color="var(--agri-primary)" aria-hidden />
                  <Text fz={13.5} fw={700} c="var(--agri-primary-dark)" style={{ flex: 1 }}>
                    {appliedCode} · giảm {formatMoney(voucherDiscount)}
                  </Text>
                  <Text
                    component="button"
                    type="button"
                    fz={13}
                    fw={700}
                    c="var(--agri-danger)"
                    onClick={clearVoucher}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
                  >
                    Bỏ
                  </Text>
                </Group>
              ) : (
                <Box
                  component="button"
                  type="button"
                  onClick={() => setVoucherPickerOpen((open) => !open)}
                  aria-expanded={voucherPickerOpen}
                  aria-label="Chọn mã giảm giá"
                  className="agri-press"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    border: "1px solid var(--agri-primary-border)",
                    borderRadius: 8,
                    padding: "0 12px",
                    minHeight: 44,
                    background: "var(--agri-primary-soft)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <IconTicket size={16} color="var(--agri-primary)" aria-hidden />
                  <Text fz={14} fw={700} c="var(--agri-primary-dark)" style={{ flex: 1 }}>
                    {voucherGroups.eligible.length > 0 ? "Chọn mã giảm giá" : "Xem mã giảm giá"}
                  </Text>
                  {voucherPickerOpen ? (
                    <IconChevronUp size={16} color="var(--agri-primary)" aria-hidden />
                  ) : (
                    <IconChevronDown size={16} color="var(--agri-primary)" aria-hidden />
                  )}
                </Box>
              )}

              {/* A code the backend refused: the preview errored while one was set. */}
              {voucher && previewQuery.isError ? (
                <Box mt={8}>
                  <InlineError
                    message={
                      previewQuery.error instanceof ApiError
                        ? previewQuery.error.message
                        : "Mã giảm giá không hợp lệ."
                    }
                  />
                </Box>
              ) : null}

              {voucherPickerOpen ? (
                <Stack gap={8} mt={8}>
                  {vouchersQuery.isLoading ? <LoadingView label="Đang tải mã giảm giá…" /> : null}
                  {vouchersQuery.isError ? (
                    <InlineError
                      message={
                        vouchersQuery.error instanceof ApiError
                          ? vouchersQuery.error.message
                          : "Không tải được mã giảm giá."
                      }
                      onRetry={() => vouchersQuery.refetch()}
                    />
                  ) : null}

                  {voucherGroups.eligible.map((option) => (
                    <Box
                      key={option.voucher.id}
                      component="button"
                      type="button"
                      onClick={() => chooseVoucher(option.voucher.code)}
                      aria-label={`Áp dụng mã ${option.voucher.code}`}
                      className="agri-press"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        border: "1px solid var(--agri-border)",
                        borderRadius: 8,
                        padding: 10,
                        background: "var(--agri-surface)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Group gap={10} wrap="nowrap" justify="space-between">
                          <Text
                            fz={14}
                            fw={700}
                            c="var(--agri-primary)"
                            style={{ letterSpacing: 0.4 }}
                          >
                            {option.voucher.code}
                          </Text>
                          <Text fz={12.5} fw={700} c="var(--agri-primary-dark)">
                            {voucherValueLabel(option.voucher)}
                          </Text>
                        </Group>
                        <Text fz={12.5} c="var(--agri-text)" lineClamp={1}>
                          {option.voucher.name}
                        </Text>
                        <Text fz={11.5} lh="16px" c="var(--agri-muted)">
                          Đơn tối thiểu {formatMoney(option.voucher.minOrderAmount)}
                          {option.voucher.maxDiscount
                            ? ` · tối đa ${formatMoney(option.voucher.maxDiscount)}`
                            : ""}
                        </Text>
                      </Box>
                      <Box
                        style={{
                          background: "var(--agri-primary)",
                          borderRadius: 8,
                          padding: "0 12px",
                          minHeight: 34,
                          display: "grid",
                          placeItems: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Text fz={12.5} fw={700} c="#ffffff">
                          Áp dụng
                        </Text>
                      </Box>
                    </Box>
                  ))}

                  {voucherGroups.ineligible.length > 0 ? (
                    <Text fz={12} fw={700} c="var(--agri-muted)" mt={4}>
                      Chưa dùng được
                    </Text>
                  ) : null}
                  {voucherGroups.ineligible.map((option) => (
                    <Box
                      key={option.voucher.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        border: "1px solid var(--agri-border)",
                        borderRadius: 8,
                        padding: 10,
                        background: "var(--agri-page)",
                        opacity: 0.6,
                      }}
                    >
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Group gap={10} wrap="nowrap" justify="space-between">
                          <Text fz={14} fw={700} c="var(--agri-muted)" style={{ letterSpacing: 0.4 }}>
                            {option.voucher.code}
                          </Text>
                          <Text fz={12.5} fw={700} c="var(--agri-muted)">
                            {voucherValueLabel(option.voucher)}
                          </Text>
                        </Group>
                        <Text fz={12.5} c="var(--agri-text)" lineClamp={1}>
                          {option.voucher.name}
                        </Text>
                        <Text fz={11.5} lh="16px" c="var(--agri-danger)">
                          {option.reason}
                        </Text>
                      </Box>
                    </Box>
                  ))}

                  {!vouchersQuery.isLoading && !vouchersQuery.isError &&
                  voucherGroups.eligible.length + voucherGroups.ineligible.length === 0 ? (
                    <Text fz={11.5} c="var(--agri-muted)">
                      Hiện chưa có chương trình giảm giá nào.
                    </Text>
                  ) : null}
                </Stack>
              ) : null}
            </AppCard>

            {/* ------------------------------------------ note & payment ----- */}
            <AppCard>
              <Group gap={6} wrap="nowrap" mb={8}>
                <IconMessageCircle size={17} color="var(--agri-primary)" aria-hidden />
                <Text fz={15} fw={700} c="var(--agri-text-strong)" style={{ flex: 1 }}>
                  Ghi chú & thanh toán
                </Text>
              </Group>
              <Textarea
                value={note}
                onChange={(event) => {
                  setNote(event.currentTarget.value);
                  setSubmitError(null);
                }}
                placeholder="Ghi chú cho đơn hàng (tùy chọn)"
                autosize
                minRows={2}
                aria-label="Ghi chú đơn hàng"
              />
              <Group gap={6} wrap="nowrap" mt={12}>
                <IconCash size={17} color="var(--agri-primary)" aria-hidden />
                <Text fz={13} fw={600} c="var(--agri-text)" style={{ flex: 1 }}>
                  Thanh toán tiền mặt khi nhận hàng (COD)
                </Text>
              </Group>
            </AppCard>

            {submitError ? (
              <Group
                gap={6}
                align="flex-start"
                wrap="nowrap"
                style={{
                  background: "var(--agri-danger-soft)",
                  border: "1px solid var(--agri-danger)",
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <IconAlertCircle
                  size={16}
                  color="var(--agri-danger)"
                  style={{ flexShrink: 0, marginTop: 2 }}
                />
                <Text fz={13} lh="18px" c="var(--agri-danger)" style={{ flex: 1 }}>
                  {submitError}
                </Text>
              </Group>
            ) : null}
          </Stack>

          {/* ---------------------------------------------------------- total -- */}
          <AppCard padding={16} w={{ base: "100%", md: 340 }} style={{ flexShrink: 0 }}>
            <Group gap={6} wrap="nowrap" mb={8}>
              <IconReceipt size={17} color="var(--agri-primary)" aria-hidden />
              <Text fz={15} fw={700} c="var(--agri-text-strong)" style={{ flex: 1 }}>
                Tổng tiền
              </Text>
            </Group>

            {previewQuery.isLoading ? <LoadingView label="Đang tính tổng tiền…" /> : null}
            {previewQuery.isError && !voucher ? (
              <InlineError
                message={
                  previewQuery.error instanceof ApiError
                    ? previewQuery.error.message
                    : "Không tính được tổng tiền."
                }
                onRetry={() => previewQuery.refetch()}
              />
            ) : null}

            {preview ? (
              <Stack gap={0}>
                {preview.items.map((line) => (
                  <Group key={line.productVariantId} justify="space-between" gap={12} wrap="nowrap" py={3}>
                    <Text fz={13} lh="18px" style={{ flex: 1 }}>
                      {line.productName} × {formatQuantity(line.quantity)}
                    </Text>
                    <Text fz={13} fw={600} c="var(--agri-text)">
                      {formatMoney(line.subtotal)}
                    </Text>
                  </Group>
                ))}

                <Divider my={8} />

                <Group justify="space-between" gap={12} wrap="nowrap" py={3}>
                  <Text fz={13} c="var(--agri-muted)">
                    Tiền hàng
                  </Text>
                  <Text fz={13} fw={600} c="var(--agri-text)">
                    {formatMoney(preview.subtotal)}
                  </Text>
                </Group>
                {preview.discountTotal > 0 ? (
                  <Group justify="space-between" gap={12} wrap="nowrap" py={3}>
                    <Text fz={13} c="var(--agri-muted)">
                      Giảm giá{preview.voucher ? ` (${preview.voucher.code})` : ""}
                    </Text>
                    <Text fz={13} fw={700} c="var(--agri-primary)">
                      −{formatMoney(preview.discountTotal)}
                    </Text>
                  </Group>
                ) : null}
                <Group justify="space-between" gap={12} wrap="nowrap" py={3}>
                  <Text fz={13} c="var(--agri-muted)">
                    Phí vận chuyển
                  </Text>
                  <Text fz={13} fw={600} c="var(--agri-text)">
                    {formatMoney(preview.shippingFee)}
                  </Text>
                </Group>

                <Divider my={8} />

                <Group justify="space-between" gap={12} wrap="nowrap">
                  <Text fz={15} fw={700} c="var(--agri-text-strong)">
                    Tổng cộng
                  </Text>
                  <Text fz={17} fw={700} c="var(--agri-primary)">
                    {formatMoney(preview.grandTotal)}
                  </Text>
                </Group>
              </Stack>
            ) : null}

            {hasUnavailable ? (
              <Box mt={8}>
                <InlineError message="Có sản phẩm không còn đủ hàng cho số lượng bạn chọn. Vui lòng giảm số lượng trong giỏ hàng trước khi đặt." />
              </Box>
            ) : null}
          </AppCard>
        </Group>
      </Stack>

      {/* ------------------------------------------------------ action bar --- */}
      <BottomBar>
        <Stack gap={8}>
          {confirmTotal && grandTotal !== undefined ? (
            <Text fz={12.5} fw={600} c="var(--agri-warning)" lh="17px">
              Giá vừa được cập nhật thành {formatMoney(grandTotal)}. Bấm đặt hàng để xác nhận.
            </Text>
          ) : null}

          <Button
            radius={8}
            size="md"
            fullWidth
            onClick={handlePlaceOrder}
            disabled={!canSubmit}
            styles={{ root: { minHeight: 48 }, label: { fontSize: 15, fontWeight: 700 } }}
          >
            {checkout.isPending
              ? "Đang đặt hàng…"
              : hasUnavailable
                ? "Không đủ hàng"
                : grandTotal !== undefined
                  ? `Đặt hàng · ${formatMoney(grandTotal)}`
                  : "Đặt hàng"}
          </Button>
        </Stack>
      </BottomBar>

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

/** Centered text row acting as a link/button (Mobile `addrManage` row). */
function UnstyledRow({
  children,
  onClick,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="agri-press"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        width: "100%",
        minHeight: 44,
        background: "none",
        border: "none",
        cursor: "pointer",
      }}
    >
      {children}
    </Box>
  );
}
