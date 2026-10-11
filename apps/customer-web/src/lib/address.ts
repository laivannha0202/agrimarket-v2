/**
 * Delivery-address form helpers, shared by the address book and the checkout
 * screen so the two forms cannot drift apart.
 *
 * WHAT IS (AND IS NOT) DECIDED HERE
 *
 * The backend owns the address rules: it resolves the official commune name
 * from the code, refuses a code that is unknown or that belongs to another
 * province, normalises the phone, and computes the shipping fee. Everything in
 * this module is client-side feedback — the same checks run server-side on the
 * values that are actually stored.
 *
 * The 104 Hưng Yên xã/phường are NOT listed here. They are read from
 * `GET /locations/provinces/:code/wards`, which is the single source of truth.
 *
 * TWO GENERATIONS, ONE FORM
 *
 * A new address is always built from the verified catalogue: tỉnh/thành phố →
 * xã/phường, with no district level (the 2025 model has none). An address saved
 * before the reorganisation has no codes; it keeps its own free text and can
 * still be edited without inventing a commune for it. The moment the customer
 * picks a ward from the catalogue the address becomes a code-verified one, and
 * the legacy text is replaced by the official name the backend resolves.
 */

import { z } from "zod";
import type { Address, ShippingAddressInput } from "@/lib/api/types";

/**
 * Address form.
 *
 * `provinceCode` / `wardCode` are optional at the field level so a legacy row
 * can be submitted unchanged, and the refinement below enforces the real rule:
 * a code pair is all-or-nothing, and an address must end up with either a
 * verified pair or its own legacy province text.
 */
export const addressFormSchema = z
  .object({
    recipientName: z.string().trim().min(1, "Vui lòng nhập tên người nhận"),
    phone: z
      .string()
      .trim()
      .min(8, "Số điện thoại chưa hợp lệ")
      .max(20, "Số điện thoại chưa hợp lệ"),
    provinceCode: z.string().trim(),
    wardCode: z.string().trim(),
    village: z.string().trim().max(120, "Tên thôn/tổ dân phố quá dài"),
    detail: z.string().trim().min(1, "Vui lòng nhập địa chỉ chi tiết"),
    /**
     * The stored free text of a legacy address. Hidden from the form, carried
     * through untouched: it is never used to guess a code, and it is only sent
     * back when the customer did not choose a catalogue ward.
     */
    legacyProvince: z.string().trim(),
    legacyDistrict: z.string().trim(),
    legacyWard: z.string().trim(),
  })
  .superRefine((values, ctx) => {
    const hasProvince = values.provinceCode.length > 0;
    const hasWard = values.wardCode.length > 0;

    if (hasProvince && !hasWard) {
      ctx.addIssue({
        code: "custom",
        path: ["wardCode"],
        message: "Vui lòng chọn xã/phường",
      });
      return;
    }
    if (!hasProvince && hasWard) {
      ctx.addIssue({
        code: "custom",
        path: ["provinceCode"],
        message: "Vui lòng chọn tỉnh/thành phố",
      });
      return;
    }
    if (!hasProvince && !values.legacyProvince) {
      ctx.addIssue({
        code: "custom",
        path: ["provinceCode"],
        message: "Vui lòng chọn tỉnh/thành phố",
      });
    }
  });

export type AddressFormValues = z.infer<typeof addressFormSchema>;

export const EMPTY_ADDRESS_FORM: AddressFormValues = {
  recipientName: "",
  phone: "",
  provinceCode: "",
  wardCode: "",
  village: "",
  detail: "",
  legacyProvince: "",
  legacyDistrict: "",
  legacyWard: "",
};

/** True when the form is being used to migrate a legacy address. */
export function isLegacyForm(values: AddressFormValues): boolean {
  return values.provinceCode.length === 0 && values.wardCode.length === 0;
}

/**
 * Form values → API payload.
 *
 * With a code pair, `province` is the catalogue's province name (the backend
 * also forces it server-side) and the legacy district/ward are omitted, so an
 * edited address cannot keep a district that the 2025 model does not have.
 *
 * Without a code pair, the stored free text is sent back unchanged: an old
 * address is not silently rewritten, and no commune is invented for it.
 */
export function toAddressPayload(
  values: AddressFormValues,
  provinceName: string,
): ShippingAddressInput {
  const base = {
    recipientName: values.recipientName,
    phone: values.phone,
    village: values.village || undefined,
    detail: values.detail,
  };

  if (!isLegacyForm(values)) {
    return {
      ...base,
      province: provinceName || values.legacyProvince,
      provinceCode: values.provinceCode,
      wardCode: values.wardCode,
    };
  }

  return {
    ...base,
    province: values.legacyProvince,
    district: values.legacyDistrict || undefined,
    ward: values.legacyWard || undefined,
  };
}

/** Seeds the form from a saved address (edit mode). */
export function toAddressFormValues(address: Address): AddressFormValues {
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    provinceCode: address.provinceCode ?? "",
    wardCode: address.wardCode ?? "",
    village: address.village ?? "",
    detail: address.detail,
    legacyProvince: address.province ?? "",
    legacyDistrict: address.district ?? "",
    legacyWard: address.ward ?? "",
  };
}

/**
 * Seeds the form for a NEW address: the catalogue's province is preselected
 * when the storefront serves exactly one, so the customer only picks a commune.
 */
export function newAddressForm(provinceCode: string): AddressFormValues {
  return { ...EMPTY_ADDRESS_FORM, provinceCode };
}

/**
 * One-line display for a saved address.
 *
 * A new-style address shows `wardName` (the official name resolved from the
 * code) and never a district — the 2025 model has no district level. A legacy
 * address shows its own free-text `ward`/`district` so an old row keeps reading
 * the way it was saved.
 */
export function formatAddressLine(
  address: Pick<
    Address,
    "detail" | "village" | "wardName" | "ward" | "district" | "province"
  >,
): string {
  return [
    address.detail,
    address.village,
    address.wardName ?? address.ward,
    address.wardName ? null : address.district,
    address.province,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Accent- and case-insensitive fold used ONLY to narrow the already-loaded
 * commune list in the picker.
 *
 * The authoritative search is the backend's (`?search=`), which folds the same
 * way against a precomputed haystack. This local copy exists so typing does not
 * issue a request per keystroke; it never decides whether a ward is valid.
 */
export function foldForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

/** True when a ward's name or code matches the picker's search box. */
export function wardMatches(
  ward: { code: string; fullName: string; name: string },
  search: string,
): boolean {
  const needle = foldForSearch(search);
  if (!needle) return true;
  return (
    foldForSearch(ward.fullName).includes(needle) ||
    foldForSearch(ward.name).includes(needle) ||
    ward.code.includes(needle)
  );
}
