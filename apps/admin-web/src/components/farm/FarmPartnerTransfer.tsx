"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Form, Input, Select, Typography } from "antd";
import { SwapOutlined } from "@ant-design/icons";
import { DetailCard } from "@/components/common/DetailPage";
import { FormModal } from "@/components/common/FormModal";
import { useAuth } from "@/lib/auth/auth-provider";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import type { Farm, Partner } from "@/types/api";

const PARTNER_PAGE_SIZE = 100;

async function loadEligiblePartners(search: string): Promise<Partner[]> {
  const filters = {
    limit: PARTNER_PAGE_SIZE,
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    ...(search ? { search } : {}),
  };
  const firstPage = await resources.partners({ ...filters, page: 1 });
  const partners = [...firstPage.data];

  for (let page = 2; page <= firstPage.meta.totalPages; page += 1) {
    const result = await resources.partners({ ...filters, page });
    partners.push(...result.data);
  }

  // Keep the UI defensive if a stale cache or an inconsistent API response
  // contains a partner that no longer meets the transfer requirements.
  return partners.filter(
    (partner) =>
      partner.status === "ACTIVE" && partner.verificationStatus === "VERIFIED",
  );
}

interface TransferValues extends Record<string, unknown> {
  newPartnerId: number;
  reason: string;
}

export function FarmPartnerTransfer({ farm }: { farm: Farm }) {
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [transferredPartner, setTransferredPartner] = useState<{
    farmId: number;
    partner: NonNullable<Farm["partner"]>;
  } | null>(null);
  const [form] = Form.useForm<TransferValues>();
  const selectedPartnerId = Form.useWatch("newPartnerId", form);
  const reason = Form.useWatch("reason", form);
  const submitLock = useRef(false);
  const canTransfer = user?.role === "ADMIN";

  const currentPartner =
    transferredPartner?.farmId === farm.id ? transferredPartner.partner : farm.partner;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const partners = useQuery({
    queryKey: ["partners", "farm-transfer-options", debouncedSearch],
    enabled: open && canTransfer && farm.status === "INACTIVE",
    staleTime: 30_000,
    queryFn: () => loadEligiblePartners(debouncedSearch),
  });

  const transfer = useMutation({
    mutationFn: (values: TransferValues) =>
      resources.transferFarmPartner(farm.id, {
        newPartnerId: values.newPartnerId,
        reason: values.reason.trim(),
      }),
    onSuccess: (updatedFarm, values) => {
      const selectedPartner = partners.data?.find(
        (partner) => partner.id === values.newPartnerId,
      );

      queryClient.setQueryData<Farm>(queryKeys.farm(farm.id), (current) => ({
        ...(current ?? farm),
        ...updatedFarm,
        partner:
          updatedFarm.partner ??
          (selectedPartner
            ? {
                id: selectedPartner.id,
                code: selectedPartner.code,
                name: selectedPartner.name,
              }
            : current?.partner ?? farm.partner),
      }));
      setTransferredPartner({
        farmId: farm.id,
        partner:
          updatedFarm.partner ??
          (selectedPartner
            ? { id: selectedPartner.id, code: selectedPartner.code, name: selectedPartner.name }
            : farm.partner ?? { id: updatedFarm.partnerId, code: "", name: "HTX mới" }),
      });
      void queryClient.invalidateQueries({ queryKey: ["farms"] });
      message.success("Đã chuyển trang trại sang HTX mới.");
      setOpen(false);
      form.resetFields();
      setSearch("");
    },
    onError: (error) => {
      message.error(
        error instanceof Error ? error.message : "Không thể chuyển HTX. Vui lòng thử lại.",
      );
    },
  });

  if (!canTransfer) return null;

  const openTransfer = () => {
    if (farm.status !== "INACTIVE") return;
    form.resetFields();
    setSearch("");
    setOpen(true);
  };

  const closeTransfer = () => {
    if (submitLock.current || transfer.isPending) return;
    setOpen(false);
    form.resetFields();
    setSearch("");
  };

  const submitTransfer = async (values: TransferValues) => {
    if (submitLock.current || transfer.isPending) return;
    submitLock.current = true;
    try {
      await transfer.mutateAsync(values);
    } catch {
      // The mutation surfaces the backend's business message through App.
    } finally {
      submitLock.current = false;
    }
  };

  const eligiblePartners = (partners.data ?? []).filter(
    (partner) => partner.id !== farm.partnerId,
  );
  const canSubmit =
    Number.isInteger(selectedPartnerId) &&
    eligiblePartners.some((partner) => partner.id === selectedPartnerId) &&
    typeof reason === "string" &&
    reason.trim().length > 0 &&
    reason.trim().length <= 1000 &&
    !partners.isFetching &&
    !partners.isError;

  return (
    <>
      <DetailCard
        title="Quản lý HTX"
        extra={
          <Button
            icon={<SwapOutlined aria-hidden="true" />}
            onClick={openTransfer}
            disabled={farm.status !== "INACTIVE"}
            title={
              farm.status === "ACTIVE"
                ? "Chuyển trang trại sang INACTIVE trước khi chuyển HTX."
                : undefined
            }
          >
            Chuyển HTX
          </Button>
        }
      >
        <div style={{ display: "grid", gap: 6 }}>
          <Typography.Text type="secondary">HTX hiện tại</Typography.Text>
          <Typography.Text strong>
            {currentPartner ? `${currentPartner.code} — ${currentPartner.name}` : "Chưa có HTX"}
          </Typography.Text>
        </div>
        {farm.status === "ACTIVE" ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            title="Chưa thể chuyển HTX"
            description="Trang trại đang ACTIVE. Hãy chuyển trạng thái trang trại sang INACTIVE trước khi thực hiện chuyển HTX."
          />
        ) : null}
      </DetailCard>

      <FormModal<TransferValues>
        open={open}
        title="Chuyển trang trại sang HTX khác"
        form={form}
        onCancel={closeTransfer}
        onSubmit={(values) => void submitTransfer(values)}
        submitting={transfer.isPending}
        okDisabled={!canSubmit}
        okText="Xác nhận chuyển"
        width="min(560px, calc(100vw - 32px))"
      >
        <Alert
          type="info"
          showIcon
          title="HTX hiện tại"
          description={
            currentPartner ? `${currentPartner.code} — ${currentPartner.name}` : "Chưa có HTX"
          }
          style={{ marginBottom: 16 }}
        />

        <Alert
          type="warning"
          showIcon
          title="Phạm vi thao tác"
          description="Thao tác chỉ thay đổi HTX quản lý trang trại. Không chuyển sản phẩm, đơn hàng hoặc lịch sử tài chính. Nếu trang trại đã có sản phẩm, mùa vụ hoặc chứng nhận liên kết, Backend có thể từ chối chuyển."
          style={{ marginBottom: 16 }}
        />

        <Form.Item
          label="HTX tiếp nhận"
          name="newPartnerId"
          rules={[{ required: true, message: "Vui lòng chọn HTX tiếp nhận." }]}
        >
          <Select
            showSearch
            filterOption={false}
            placeholder="Tìm theo mã hoặc tên HTX"
            options={eligiblePartners.map((partner) => ({
              label: `${partner.code} — ${partner.name}`,
              value: partner.id,
            }))}
            loading={partners.isFetching}
            disabled={partners.isError}
            onSearch={setSearch}
            notFoundContent={
              partners.isError
                ? "Không tải được danh sách HTX."
                : partners.isFetching
                  ? "Đang tải HTX..."
                  : "Không có HTX phù hợp."
            }
          />
        </Form.Item>

        {partners.isError ? (
          <Alert
            type="error"
            showIcon
            title="Không tải được danh sách HTX"
            description={partners.error.message}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        {!partners.isFetching && !partners.isError && eligiblePartners.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            title="Chưa có HTX đủ điều kiện"
            description="Danh sách chỉ gồm HTX đã VERIFIED và đang ACTIVE; HTX hiện tại không được phép chọn."
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Form.Item
          label="Lý do chuyển"
          name="reason"
          rules={[
            { required: true, whitespace: true, message: "Vui lòng nhập lý do chuyển." },
            { max: 1000, message: "Lý do không được vượt quá 1.000 ký tự." },
          ]}
        >
          <Input.TextArea
            rows={3}
            maxLength={1000}
            showCount
            placeholder="Nhập lý do chuyển HTX..."
          />
        </Form.Item>
      </FormModal>
    </>
  );
}
