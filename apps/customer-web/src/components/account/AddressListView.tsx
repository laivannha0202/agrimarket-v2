"use client";

/**
 * Sổ địa chỉ — web twin of the Mobile addresses + address-edit screens.
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
 * this screen agree on which address a customer sees first. Creating and editing
 * stay in a modal (the app uses a separate screen); the fields, labels and
 * buttons are word-for-word the app's.
 */

import {
  Button,
  Container,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconCircleCheck,
  IconMapPin,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
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
import { AppCard, GhostButton, PageTitle, ToneBadge } from "@/components/ui/kit";
import { layout } from "@/theme";
import type { Address } from "@/lib/api/types";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text fz={15} fw={700} c="var(--agri-text-strong)" mb={8}>
      {children}
    </Text>
  );
}

/** Muted inline error row (Mobile `errorRow`). */
function ErrorRow({ message }: { message: string }) {
  return (
    <Group gap={6} align="flex-start" wrap="nowrap">
      <IconAlertCircle
        size={15}
        color="var(--agri-danger)"
        style={{ flexShrink: 0, marginTop: 2 }}
        aria-hidden
      />
      <Text fz={13} lh="18px" c="var(--agri-danger)" style={{ flex: 1 }}>
        {message}
      </Text>
    </Group>
  );
}

function AddressCard({
  address,
  onEdit,
  onDelete,
  onSetDefault,
  defaultPending,
}: {
  address: Address;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  defaultPending: boolean;
}) {
  return (
    <AppCard padding={12}>
      <Group gap={6} align="center" wrap="nowrap">
        <IconUser size={15} color="var(--agri-muted-soft)" style={{ flexShrink: 0 }} aria-hidden />
        <Text fz={14} fw={700} c="var(--agri-text-strong)" truncate style={{ flex: 1 }}>
          {address.recipientName} · {address.phone}
        </Text>
        {address.isDefault ? <ToneBadge tone="green">Mặc định</ToneBadge> : null}
      </Group>

      <Group gap={6} align="flex-start" wrap="nowrap" mt={4}>
        <IconMapPin
          size={15}
          color="var(--agri-muted-soft)"
          style={{ flexShrink: 0, marginTop: 2 }}
          aria-hidden
        />
        <Text fz={13} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
          {formatAddressLine(address)}
        </Text>
      </Group>

      {address.wardCode ? null : (
        <Group gap={6} align="flex-start" wrap="nowrap" mt={8}>
          <ToneBadge tone="gray">Địa chỉ cũ</ToneBadge>
          <Text fz={12.5} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
            Chưa theo danh mục xã/phường 2025. Sửa và chọn lại xã/phường để dùng địa chỉ đã xác
            minh.
          </Text>
        </Group>
      )}

      <Group gap={8} mt={12} wrap="nowrap">
        <GhostButton
          radius={8}
          onClick={onEdit}
          leftSection={<IconPencil size={15} aria-hidden />}
          styles={{
            root: { flex: 1, minHeight: 40, borderColor: "var(--agri-border-strong)" },
            label: { fontSize: 13, fontWeight: 600, color: "var(--agri-text)" },
          }}
        >
          Sửa
        </GhostButton>
        {address.isDefault ? null : (
          <GhostButton
            radius={8}
            onClick={onSetDefault}
            loading={defaultPending}
            leftSection={<IconCircleCheck size={15} aria-hidden />}
            styles={{
              root: { flex: 1, minHeight: 40, borderColor: "var(--agri-border-strong)" },
              label: { fontSize: 13, fontWeight: 600, color: "var(--agri-text)" },
            }}
          >
            Mặc định
          </GhostButton>
        )}
        <GhostButton
          radius={8}
          onClick={onDelete}
          leftSection={<IconTrash size={15} aria-hidden />}
          styles={{
            root: { flex: 1, minHeight: 40, borderColor: "var(--agri-danger)" },
            label: { fontSize: 13, fontWeight: 600, color: "var(--agri-danger)" },
          }}
        >
          Xóa
        </GhostButton>
      </Group>
    </AppCard>
  );
}

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
    <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
      <PageTitle>Sổ địa chỉ</PageTitle>

      <Group align="flex-start" gap={16} wrap="wrap" mt={{ base: 0, md: 12 }}>
        <AccountNav />

        <Stack gap={12} style={{ flex: 1 }} miw={{ base: 0, md: 300 }}>
          <AppCard padding={16}>
            <Group gap={8} align="center" wrap="nowrap">
              <IconMapPin size={18} color="var(--agri-primary)" aria-hidden />
              <SectionTitle>Địa chỉ giao hàng</SectionTitle>
            </Group>

            {isError ? (
              <ErrorState error={error} onRetry={() => refetch()} />
            ) : isLoading ? (
              <ListSkeleton rows={2} />
            ) : addresses.length === 0 ? (
              <EmptyState
                kind="orders"
                title="Chưa có địa chỉ"
                description="Thêm địa chỉ giao hàng để đặt hàng nhanh hơn."
              />
            ) : (
              <Stack gap={8}>
                {addresses.map((address) => (
                  <AddressCard
                    key={address.id}
                    address={address}
                    onEdit={() => openEdit(address)}
                    onDelete={() => setDeleteTarget(address)}
                    onSetDefault={() => setDefault.mutate(address.id)}
                    defaultPending={setDefault.isPending}
                  />
                ))}
              </Stack>
            )}

            <Button
              radius={8}
              fullWidth
              mt={12}
              leftSection={<IconPlus size={16} aria-hidden />}
              onClick={openCreate}
              styles={{ root: { minHeight: 48 }, label: { fontSize: 15, fontWeight: 700 } }}
            >
              Thêm địa chỉ
            </Button>
          </AppCard>
        </Stack>
      </Group>

      <Modal
        opened={modalOpened}
        onClose={modal.close}
        title={editing ? "Sửa địa chỉ giao hàng" : "Thêm địa chỉ giao hàng"}
        centered
        size="md"
      >
        <form onSubmit={handleSubmit((values) => saveAddress.mutate(values))}>
          <Stack gap={12}>
            {formError ? <ErrorRow message={formError} /> : null}

            {editing && !editing.wardCode ? (
              <Group gap={6} align="flex-start" wrap="nowrap">
                <ToneBadge tone="gray">Địa chỉ cũ</ToneBadge>
                <Text fz={12.5} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
                  Địa chỉ này được lưu trước khi cập nhật danh mục: {formatAddressLine(editing)}.
                  Giữ nguyên nếu bạn không muốn đổi, hoặc chọn xã/phường theo danh mục mới ở bên
                  dưới.
                </Text>
              </Group>
            ) : null}

            <TextInput
              label="Người nhận"
              placeholder="Nguyễn Văn A"
              required
              size="md"
              error={errors.recipientName?.message}
              {...register("recipientName")}
            />
            <TextInput
              label="Điện thoại"
              placeholder="0912345678"
              required
              size="md"
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
              label="Thôn / Tổ dân phố (tùy chọn)"
              placeholder="Ví dụ: Thôn Đông"
              description="Ghi rõ thôn/ấp/tổ dân phố nếu cần, hệ thống chưa có danh mục cấp này."
              size="md"
              error={errors.village?.message}
              {...register("village")}
            />
            <TextInput
              label="Địa chỉ chi tiết"
              placeholder="Số nhà, đường"
              required
              size="md"
              error={errors.detail?.message}
              {...register("detail")}
            />
            <Group justify="flex-end" gap={8}>
              <Button
                variant="default"
                onClick={modal.close}
                type="button"
                radius={8}
                styles={{ root: { minHeight: 44 }, label: { fontSize: 13.5, fontWeight: 700 } }}
              >
                Hủy
              </Button>
              <Button
                type="submit"
                radius={8}
                loading={saveAddress.isPending}
                styles={{ root: { minHeight: 44 }, label: { fontSize: 13.5, fontWeight: 700 } }}
              >
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
        <Stack gap={12}>
          <Text fz={13.5} lh="19px" c="var(--agri-text)">
            Xóa địa chỉ của {deleteTarget?.recipientName}? Thao tác này không thể hoàn tác.
          </Text>
          <Group justify="flex-end" gap={8}>
            <Button
              variant="default"
              onClick={() => setDeleteTarget(null)}
              radius={8}
              styles={{ root: { minHeight: 44 }, label: { fontSize: 13.5, fontWeight: 700 } }}
            >
              Hủy
            </Button>
            <Button
              color="red"
              radius={8}
              loading={removeAddress.isPending}
              onClick={() => deleteTarget && removeAddress.mutate(deleteTarget.id)}
              styles={{ root: { minHeight: 44 }, label: { fontSize: 13.5, fontWeight: 700 } }}
            >
              Xóa
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
