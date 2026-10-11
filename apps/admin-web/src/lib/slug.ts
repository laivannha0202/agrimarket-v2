/**
 * Client-side slug suggestion (mirrors the backend `slugify` rule).
 * The backend remains the authority: it validates the pattern and guarantees
 * uniqueness, auto-generating a slug when the field is left empty.
 */
const VI_MAP: Record<string, string> = {
  "à": "a", "á": "a", "ạ": "a", "ả": "a", "ã": "a",
  "â": "a", "ầ": "a", "ấ": "a", "ậ": "a", "ẩ": "a", "ẫ": "a",
  "ă": "a", "ằ": "a", "ắ": "a", "ặ": "a", "ẳ": "a", "ẵ": "a",
  "è": "e", "é": "e", "ẹ": "e", "ẻ": "e", "ẽ": "e",
  "ê": "e", "ề": "e", "ế": "e", "ệ": "e", "ể": "e", "ễ": "e",
  "ì": "i", "í": "i", "ị": "i", "ỉ": "i", "ĩ": "i",
  "ò": "o", "ó": "o", "ọ": "o", "ỏ": "o", "õ": "o",
  "ô": "o", "ồ": "o", "ố": "o", "ộ": "o", "ổ": "o", "ỗ": "o",
  "ơ": "o", "ờ": "o", "ớ": "o", "ợ": "o", "ở": "o", "ỡ": "o",
  "ù": "u", "ú": "u", "ụ": "u", "ủ": "u", "ũ": "u",
  "ư": "u", "ừ": "u", "ứ": "u", "ự": "u", "ử": "u", "ữ": "u",
  "ỳ": "y", "ý": "y", "ỵ": "y", "ỷ": "y", "ỹ": "y",
  "đ": "d",
};

/** Strip diacritic marks by decomposing and dropping non-ASCII pieces. */
function stripMarks(s: string): string {
  return s
    .normalize("NFD")
    .split("")
    .filter((c) => (c.codePointAt(0) ?? 0) < 128)
    .join("");
}

export function suggestSlug(input: string): string {
  let out = "";
  for (const ch of input.toLowerCase().trim()) {
    out += VI_MAP[ch] ?? ch;
  }
  return (
    stripMarks(out)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .slice(0, 120)
  );
}

/** Suggest a SKU from the product name, e.g. "Cà chua bi đỏ" + "Gói 500 g" -> "CCB-GOI500G". */
export function suggestSku(productName: string, variantName?: string): string {
  const words = stripMarks(productName)
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const initials = words
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const suffix = stripMarks(variantName ?? "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toUpperCase()
    .slice(0, 8);
  const base = initials || "SP";
  return suffix ? `${base}-${suffix}` : base;
}
