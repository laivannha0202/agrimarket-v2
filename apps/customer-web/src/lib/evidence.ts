/**
 * Pure evidence-image helpers shared by the after-sales photo picker.
 *
 * Web twin of the Mobile app's `src/lib/evidence.ts`, so both clients enforce
 * the same rules with the same wording.
 *
 * Backend contract mirrored here (never widened):
 * - `POST /evidence` accepts JPG / PNG / WebP by real magic bytes, max 5 MB.
 * - `evidenceIds` is capped at 5 per request (`MAX_EVIDENCE_PER_REQUEST`).
 * What lands on disk is re-encoded server-side, so this file only decides what
 * the picker accepts / how it labels files — the server re-checks the bytes.
 */

/** Max photos per request. Mirrors `MAX_EVIDENCE_PER_REQUEST` on the API. */
export const MAX_EVIDENCE = 5;

/** Max upload the API accepts. Mirrors `MAX_IMAGE_BYTES` (5 MB). */
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

/** MIME types the API accepts. */
export const SUPPORTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function normalizeExtension(name: string): string {
  const parts = name.split(".");
  return (parts.length > 1 ? parts.pop() ?? "" : "").toLowerCase();
}

/** True when the MIME type / extension is one the API accepts outright. */
export function isSupportedEvidence(name: string, mimeType?: string | null): boolean {
  const ext = normalizeExtension(name);
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return true;
  const mime = (mimeType ?? "").toLowerCase();
  return (SUPPORTED_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * File name sent with the upload. The server stores a random UUID and never
 * builds a path from this value — it is kept only for support/debugging.
 * Guarantees a supported extension so the server-side extension check sees
 * what the bytes actually are.
 */
export function buildEvidenceFileName(file: File, index: number): string {
  const ext =
    file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const stem = (file.name ?? "")
    .replace(/\.[^.]*$/, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  if (!stem) return `anh-${Date.now()}-${index}.${ext}`;
  return `${stem}.${ext}`;
}

/**
 * Client-side rejection reason for a picked file, or `null` when the file may
 * proceed.
 *
 * Two checks only, both mirroring the server rule the customer would otherwise
 * discover at submit time: the format the API decodes and the 5 MB ceiling.
 * The real bytes are still validated server-side.
 */
export function rejectReasonForFile(file: File): string | null {
  if (!isSupportedEvidence(file.name, file.type)) return "Chỉ nhận ảnh JPG, PNG hoặc WebP.";
  if (file.size > MAX_EVIDENCE_BYTES) return "Mỗi ảnh tối đa 5 MB.";
  return null;
}
