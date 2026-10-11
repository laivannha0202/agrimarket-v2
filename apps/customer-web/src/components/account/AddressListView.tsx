"use client";

/**
 * Address book.
 *
 * Full CRUD against `/customers/me/addresses`: list, create, edit, delete and
 * "set as default". Every call is scoped to the signed-in customer server-side,
 * and exactly one address stays default (the backend re-flags the others).
 *
 * The form is the 2025 two-level model: tỉnh/thành phố → xã/phường, both chosen
 * from the verified catalogue that the BACKEND owns. The client sends the
 * official code pair; the display name is resolved server-side, so an invented
 * commune cannot be saved. A district field is deliberately absent — the model
 * has no district level, and the legacy text of an old address is left alone.
 *
 * The list is ordered with the default address first, so the checkout screen and
 * this screen agree on which address a customer sees first.
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
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconAlertCircle, IconMapPin, IconPencil, IconPlus, IconStar, IconTrash } from "@tabler/icons-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import {
  EMPTY_ADDRESS_FORM,
  addressFormSchema,
  formatAddressLine,
  newAddressForm,
  toAddressFormValues,
  toAddressPayload,
  type AddressFormValues,
} from "@/lib/address";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/States";
import { WardPicker } from "@/components/common/WardPicker";
import { AccountNav } from "@/components/account/AccountNav";
import { layout } from "@/theme";
import type { Address } from "@/lib/api/types";

export function AddressListView() {
  const queryClient = useQueryClient();
  const [modalOpened, modal] = useDisclosure(false);
  const [editing, setEditing] = useState<Address | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Address | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.addresses.me(),
    queryFn: resources.listAddresses,
  });

  const provincesQuery = useQuery({
    queryKey: queryKeys.locations.provinces(),
    queryFn: resources.listProvinces,
    staleTime: 60 * 60_000,
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
    defaultValues: EMPTY_ADDRESS_FORM,
  });

  // `useWatch` rather than the form's `watch()`: `watch` returns a fresh
  // function on every render, which the React Compiler cannot memoize safely.
  const provinceCode = useWatch({ control, name: "provinceCode" });
  const wardCode = useWatch({ control, name: "wardCode" });

  /** The catalogue's province name is what gets stored next to the code. */
  const provinceName = useMemo(
    () => provincesQuery.data?.find((p) => p.code === provinceCode)?.name ?? "",
    [provincesQuery.data, provinceCode],
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.addresses.all });

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    // The storefront delivers inside one province today; preselecting it saves
    // a pointless choice and matches what the picker will show anyway.
    reset(newAddressForm(provincesQuery.data?.[0]?.code ?? ""));
    modal.open();
  };

  const openEdit = (address: Address) => {
    setEditing(address);
    setFormError(null);
    reset(toAddressFormValues(address));
    modal.open();
  };

  const saveAddress = useMutation({
    mutationFn: (values: AddressFormValues) => {
      const payload = toAddressPayload(values, provinceName);
      return editing
        ? resources.updateAddress(editing.id, payload)
        : resources.createAddress(payload);
    },
    onSuccess: () => {
      invalidate();
      modal.close();
      reset(EMPTY_ADDRESS_FORM);
      notifications.show({
        title: editing ? "Đã cập nhật địa chỉ" : "Đã thêm địa chỉ",
        message: editing
          ? "Thông tin địa chỉ giao hàng đã được lưu."
          : "Địa chỉ giao hàng mới đã được lưu.",
        color: "agri",
      });
    },
    onError: (err) => {
      setFormError(
        err instanceof ApiError ? err.message : "Không lưu được địa chỉ. Vui lòng thử lại.",
      );
    },
  });

  const setDefault = useMutation({
    mutationFn: (id: number) => resources.setDefaultAddress(id),
    onSuccess: () => {
      invalidate();
      notifications.show({
        title: "Đã đặt địa chỉ mặc định",
        message: "Địa chỉ này sẽ được chọn trước khi bạn đặt hàng.",
        color: "agri",
      });
    },
    onError: (err) => {
      notifications.show({
        title: "Không đặt được mặc định",
        message: err instanceof ApiError ? err.message : "Vui lòng thử lại.",
        color: "red",
      });
    },
  });

  const removeAddress = useMutation({
    mutationFn: (id: number) => resources.deleteAddress(id),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
      notifications.show({
        title: "Đã xóa địa chỉ",
        message: "Địa chỉ giao hàng đã được xóa khỏi sổ địa chỉ.",
        color: "agri",
      });
    },
    onError: (err) => {
      notifications.show({
        title: "Không xóa được địa chỉ",
        message: err instanceof ApiError ? err.message : "Vui lòng thử lại.",
        color: "red",
      });
    },
  });

  const addresses = data ?? [];

  return (
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Stack gap={4}>
          <Title order={2}>Sổ địa chỉ</Title>
          <Text size="sm" c="dimmed">
            Địa chỉ giao hàng dùng khi bạn đặt hàng trên AgriMarket.
          </Text>
        </Stack>

        <Group align="flex-start" gap="lg" wrap="wrap">
          <AccountNav />

          <Stack gap="md" style={{ flex: 1, minWidth: 300 }}>
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
                    onClick={openCreate}
                  >
                    Thêm địa chỉ
                  </Button>
                </Group>
                <Divider />

                {isError ? (
                  <ErrorState error={error} onRetry={() => refetch()} />
                ) : isLoading ? (
                  <ListSkeleton rows={2} />
                ) : addresses.length === 0 ? (
                  <EmptyState
                    icon={<IconMapPin size={28} />}
                    title="Chưa có địa chỉ giao hàng"
                    description="Thêm địa chỉ để đặt hàng nhanh hơn ở lần mua tiếp theo."
                    action={
                      <Button onClick={openCreate} leftSection={<IconPlus size={16} />}>
                        Thêm địa chỉ
                      </Button>
                    }
                  />
                ) : (
                  <Stack gap="sm">
                    {addresses.map((address) => (
                      <Card key={address.id} padding="md" radius="md" withBorder>
                        <Stack gap={6}>
                          <Group gap="xs" wrap="wrap">
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
                          <Text size="sm">{formatAddressLine(address)}</Text>

                          <Group gap="xs" wrap="wrap" mt={4}>
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              leftSection={<IconPencil size={13} />}
                              onClick={() => openEdit(address)}
                            >
                              Sửa
                            </Button>
                            {address.isDefault ? null : (
                              <Button
                                size="compact-xs"
                                variant="subtle"
                                leftSection={<IconStar size={13} />}
                                loading={setDefault.isPending}
                                onClick={() => setDefault.mutate(address.id)}
                              >
                                Đặt mặc định
                              </Button>
                            )}
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              color="red"
                              leftSection={<IconTrash size={13} />}
                              onClick={() => setDeleteTarget(address)}
                            >
                              Xóa
                            </Button>
                          </Group>
                        </Stack>
                      </Card>
                    ))}
                  </Stack>
                )}

                <Button component={Link} href="/thanh-toan" variant="subtle" size="sm" w="fit-content">
                  Đi tới thanh toán
                </Button>
              </Stack>
            </Card>
          </Stack>
        </Group>
      </Stack>

      <Modal
        opened={modalOpened}
        onClose={modal.close}
        title={editing ? "Sửa địa chỉ giao hàng" : "Thêm địa chỉ giao hàng"}
        centered
        size="md"
      >
        <form onSubmit={handleSubmit((values) => saveAddress.mutate(values))}>
          <Stack gap="md">
            {formError ? (
              <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                <Text size="sm">{formError}</Text>
              </Alert>
            ) : null}

            {editing && !editing.wardCode ? (
              <Alert color="orange" variant="light" icon={<IconAlertCircle size={16} />}>
                <Text size="sm">
                  Địa chỉ này được lưu theo mô hình cũ. Chọn lại tỉnh/thành phố và xã/phường
                  theo danh mục hiện hành để cập nhật.
                </Text>
              </Alert>
            ) : null}

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

            <WardPicker
              provinceCode={provinceCode}
              wardCode={wardCode}
              onProvinceChange={(code) => {
                setValue("provinceCode", code, { shouldValidate: true });
                setValue("wardCode", "", { shouldValidate: false });
              }}
              onWardChange={(code) => setValue("wardCode", code, { shouldValidate: true })}
              provinceError={errors.provinceCode?.message}
              wardError={errors.wardCode?.message}
              disabled={saveAddress.isPending}
            />

            <TextInput
              label="Thôn / Tổ dân phố"
              placeholder="Không bắt buộc"
              description="Ghi rõ thôn/ấp/tổ dân phố nếu cần, hệ thống chưa có danh mục cấp này."
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
              <Button variant="default" onClick={modal.close} type="button">
                Hủy
              </Button>
              <Button type="submit" loading={saveAddress.isPending}>
                Lưu địa chỉ
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Xóa địa chỉ"
        centered
        size="md"
      >
        <Stack gap="md">
          <Text size="sm">
            Bạn chắc chắn muốn xóa địa chỉ của {deleteTarget?.recipientName}? Hành động này
            không thể hoàn tác.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setDeleteTarget(null)}>
              Giữ lại
            </Button>
            <Button
              color="red"
              loading={removeAddress.isPending}
              onClick={() => deleteTarget && removeAddress.mutate(deleteTarget.id)}
            >
              Xóa địa chỉ
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
