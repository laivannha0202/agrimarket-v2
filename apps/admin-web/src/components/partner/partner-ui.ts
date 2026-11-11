import type { PartnerType, PartnerVerificationStatus } from "@/types/api";
import type { StatusDescriptor } from "@/lib/status";
import type { FormInstance } from "antd";

export const PARTNER_TYPE_OPTIONS: { value: PartnerType; label: string }[] = [
  { value: "COOPERATIVE", label: "Hợp tác xã" },
  { value: "COMPANY", label: "Doanh nghiệp" },
  { value: "HOUSEHOLD", label: "Hộ kinh doanh" },
  { value: "INDIVIDUAL", label: "Cá nhân" },
];

export const PARTNER_VERIFICATION_OPTIONS: { value: PartnerVerificationStatus; label: string }[] = [
  { value: "PENDING", label: "Chờ xác minh" },
  { value: "VERIFIED", label: "Đã xác minh" },
  { value: "REJECTED", label: "Bị từ chối" },
];

export function partnerTypeLabel(type: PartnerType) {
  return PARTNER_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? "Chưa phân loại";
}

export function partnerVerificationStatus(status: PartnerVerificationStatus): StatusDescriptor {
  switch (status) {
    case "VERIFIED":
      return { label: "Đã xác minh", color: "success" };
    case "REJECTED":
      return { label: "Bị từ chối", color: "error" };
    default:
      return { label: "Chờ xác minh", color: "warning" };
  }
}

/** Optional text fields are nullable in the API, so clearing an edit must persist. */
export function partnerFormPayload(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    typeof value === "string" ? (value.trim() || null) : value,
  ]));
}

/** Surface server-side uniqueness validation beside its corresponding field. */
export function showPartnerFieldError(form: FormInstance, error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const field = [
    { name: "phone", match: "Số điện thoại" },
    { name: "email", match: "Email" },
    { name: "taxCode", match: "Mã số thuế" },
    { name: "registrationDocumentUrl", match: "giấy tờ" },
  ].find((item) => message.toLowerCase().includes(item.match.toLowerCase()));
  if (field) form.setFields([{ name: field.name, errors: [message] }]);
}
