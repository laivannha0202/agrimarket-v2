/**
 * Delivery-address helpers for the mobile address book and checkout.
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

import type { Address, ShippingAddressInput, Ward } from "./types";

/** The editable shape of one address in the form. */
export interface AddressForm {
  recipientName: string;
  phone: string;
  /** Verified catalogue pair; both empty for a legacy row. */
  provinceCode: string;
  wardCode: string;
  village: string;
  detail: string;
  /**
   * The stored free text of a legacy address. Carried through untouched: it is
   * never used to guess a code, and it is only sent back when the customer did
   * not choose a catalogue ward.
   */
  legacyProvince: string;
  legacyDistrict: string;
  legacyWard: string;
}

export const EMPTY_ADDRESS_FORM: AddressForm = {
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

/** Seeds the form for a NEW address, preselecting the single served province. */
export function newAddressForm(provinceCode: string): AddressForm {
  return { ...EMPTY_ADDRESS_FORM, provinceCode };
}

/** Seeds the form from a saved address (edit mode). */
export function toAddressForm(address: Address): AddressForm {
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

/** True when the form is being used to migrate a legacy address. */
export function isLegacyForm(form: AddressForm): boolean {
  return form.provinceCode.length === 0 && form.wardCode.length === 0;
}

/**
 * Client-side gate before a save is attempted.
 *
 * Mirrors the server rules that can be checked without the catalogue: the
 * required text fields, and the all-or-nothing code pair. It cannot decide
 * whether a ward code is real — that is the backend's `findWard` — so a bad code
 * still comes back as a server error rather than being silently accepted here.
 */
export function validateAddressForm(form: AddressForm): string | null {
  if (!form.recipientName.trim()) return "Vui lòng nhập tên người nhận.";
  if (!form.phone.trim()) return "Vui lòng nhập số điện thoại.";
  if (!form.detail.trim()) return "Vui lòng nhập địa chỉ chi tiết.";

  const hasProvince = form.provinceCode.length > 0;
  const hasWard = form.wardCode.length > 0;
  if (hasProvince !== hasWard) {
    return "Vui lòng chọn cả tỉnh/thành phố và xã/phường.";
  }
  if (!hasProvince && !form.legacyProvince.trim()) {
    return "Vui lòng chọn tỉnh/thành phố và xã/phường.";
  }
  return null;
}

/**
 * Form → API payload.
 *
 * With a code pair, `province` is the catalogue's province name (the backend
 * also forces it server-side) and the legacy district/ward are omitted, so an
 * edited address cannot keep a district the 2025 model does not have.
 *
 * Without a code pair, the stored free text is sent back unchanged: an old
 * address is not silently rewritten, and no commune is invented for it.
 */
export function toAddressPayload(form: AddressForm, provinceName: string): ShippingAddressInput {
  const base = {
    recipientName: form.recipientName.trim(),
    phone: form.phone.trim(),
    village: form.village.trim() || undefined,
    detail: form.detail.trim(),
  };

  if (!isLegacyForm(form)) {
    return {
      ...base,
      province: provinceName || form.legacyProvince,
      provinceCode: form.provinceCode,
      wardCode: form.wardCode,
    };
  }

  return {
    ...base,
    province: form.legacyProvince,
    district: form.legacyDistrict || undefined,
    ward: form.legacyWard || undefined,
  };
}

/**
 * One-line display for a saved address.
 *
 * Prefers the catalogue name (`wardName`, resolved by the backend from the
 * official code) and never shows a district for a code-verified address — the
 * 2025 model has no district level. A legacy address shows its own free-text
 * `ward`/`district` so an old row keeps reading the way it was saved.
 */
export function formatAddressLine(
  address: Pick<Address, "detail" | "village" | "wardName" | "ward" | "district" | "province">,
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

/** True when the address was saved against the verified catalogue. */
export function isCatalogueAddress(address: Pick<Address, "wardCode">): boolean {
  return Boolean(address.wardCode);
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
export function wardMatches(ward: Pick<Ward, "code" | "fullName" | "name">, search: string): boolean {
  const needle = foldForSearch(search);
  if (!needle) return true;
  return (
    foldForSearch(ward.fullName).includes(needle) ||
    foldForSearch(ward.name).includes(needle) ||
    ward.code.includes(needle)
  );
}
