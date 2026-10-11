/**
 * Pure evidence-image helpers shared by the after-sales photo picker.
 *
 * KEPT PURE ON PURPOSE: this module has no React Native imports so the
 * mobile unit runner (node) can execute it. `EvidencePicker.tsx` owns the
 * Expo calls (permissions, camera, library, compression) and imports only
 * these predicates + constants.
 *
 * Backend contract mirrored here (never widened):
 * - `POST /evidence` accepts JPG / PNG / WebP by real magic bytes, max 5 MB.
 * - `evidenceIds` is capped at 5 per request (`MAX_EVIDENCE_PER_REQUEST`).
 * What lands on disk is re-encoded server-side, so this file only decides
 * what the picker accepts / how it labels files — the server re-checks bytes.
 */

/** Max photos per request. Mirrors `MAX_EVIDENCE_PER_REQUEST` on the API. */
export const MAX_EVIDENCE = 5;

/** Max upload the API accepts. Mirrors `MAX_IMAGE_BYTES` (5 MB). */
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

/** Longest side the client resizes to before upload (matches server 1600px). */
export const EVIDENCE_MAX_SIDE_PX = 1600;

/** Extensions the API accepts (lowercase, without dot). */
export const SUPPORTED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;

/** MIME types the API accepts. */
export const SUPPORTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** iOS camera default that the picker can still salvage by re-encoding. */
const CONVERTIBLE_EXTENSIONS = ["heic", "heif"] as const;

export function normalizeExtension(name: string): string {
  const parts = name.split(".");
  return (parts.length > 1 ? parts.pop() ?? "" : "").toLowerCase();
}

/** Best-effort MIME from the file name; the server re-checks the real bytes. */
export function guessMime(name: string): string {
  const ext = normalizeExtension(name);
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

/** True when the extension/MIME is one the API accepts outright. */
export function isSupportedEvidence(name: string, mimeType?: string | null): boolean {
  const ext = normalizeExtension(name);
  if ((SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) return true;
  if (mimeType && (SUPPORTED_MIME_TYPES as readonly string[]).includes(mimeType.toLowerCase())) {
    return true;
  }
  return false;
}

/** True when the file is an iOS HEIC/HEIF photo the picker can convert to JPEG. */
export function isConvertibleEvidence(name: string, mimeType?: string | null): boolean {
  const ext = normalizeExtension(name);
  if ((CONVERTIBLE_EXTENSIONS as readonly string[]).includes(ext)) return true;
  const mime = (mimeType ?? "").toLowerCase();
  return mime === "image/heic" || mime === "image/heif";
}

/**
 * File name sent with the upload. The server stores a random UUID and never
 * builds a path from this value — it is kept only for support/debugging.
 * Guarantees a supported extension so the server-side extension check sees
 * what the bytes actually are after client-side re-encoding.
 */
export function buildEvidenceFileName(
  originalName: string | undefined,
  mimeType: string,
  index: number,
  now = Date.now(),
): string {
  const ext =
    mimeType.toLowerCase() === "image/png"
      ? "png"
      : mimeType.toLowerCase() === "image/webp"
        ? "webp"
        : "jpg";
  const fallback = `anh-${now}-${index}.${ext}`;
  if (!originalName) return fallback;
  const base = originalName.split("/").pop()?.split("\\").pop() ?? "";
  const stem = base.replace(/\.[^.]*$/, "").trim().replace(/\s+/g, "-").slice(0, 60);
  if (!stem) return fallback;
  return `${stem}.${ext}`;
}

/** True when the image exceeds the client resize target on either side. */
export function needsCompression(
  width: number | null | undefined,
  height: number | null | undefined,
): boolean {
  if (!width || !height) return true;
  return width > EVIDENCE_MAX_SIDE_PX || height > EVIDENCE_MAX_SIDE_PX;
}

/**
 * Client-side rejection reason for a picked asset, or `null` when the asset
 * may proceed (including HEIC, which is converted before upload).
 * `fileSize` is the picker-reported byte count when the platform provides it.
 */
export function rejectReasonForAsset(asset: {
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}): string | null {
  const name = asset.fileName ?? "anh.jpg";
  if (isSupportedEvidence(name, asset.mimeType)) return null;
  if (isConvertibleEvidence(name, asset.mimeType)) return null;
  return "Chỉ nhận ảnh JPG, PNG hoặc WebP.";
}
