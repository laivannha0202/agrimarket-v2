import { describe, expect, it } from "vitest";
import {
  buildEvidenceFileName,
  EVIDENCE_MAX_SIDE_PX,
  guessMime,
  isConvertibleEvidence,
  isSupportedEvidence,
  MAX_EVIDENCE,
  MAX_EVIDENCE_BYTES,
  needsCompression,
  normalizeExtension,
  rejectReasonForAsset,
} from "../evidence";

describe("evidence helpers (mirror backend caps, never widen)", () => {
  it("caps at 5 photos per request", () => {
    expect(MAX_EVIDENCE).toBe(5);
  });

  it("caps upload at 5 MB like the API", () => {
    expect(MAX_EVIDENCE_BYTES).toBe(5 * 1024 * 1024);
  });

  it("normalizes extensions case-insensitively", () => {
    expect(normalizeExtension("ANH.JPG")).toBe("jpg");
    expect(normalizeExtension("anh.HEIC")).toBe("heic");
    expect(normalizeExtension("noext")).toBe("");
  });

  it("guesses MIME without ever inventing a new accepted type", () => {
    expect(guessMime("a.png")).toBe("image/png");
    expect(guessMime("a.webp")).toBe("image/webp");
    expect(guessMime("a.jpg")).toBe("image/jpeg");
    expect(guessMime("a.heic")).toBe("image/jpeg");
  });

  it("accepts only JPG/PNG/WebP outright", () => {
    expect(isSupportedEvidence("a.jpg", "image/jpeg")).toBe(true);
    expect(isSupportedEvidence("a.png", "image/png")).toBe(true);
    expect(isSupportedEvidence("a.webp", "image/webp")).toBe(true);
    expect(isSupportedEvidence("a.gif", "image/gif")).toBe(false);
    expect(isSupportedEvidence("trojan.png", "application/x-sh")).toBe(true); // name passes; server checks magic bytes
  });

  it("flags HEIC/HEIF as convertible, not rejected", () => {
    expect(isConvertibleEvidence("IMG.HEIC", "image/heic")).toBe(true);
    expect(isConvertibleEvidence("IMG.HEIF", null)).toBe(true);
    expect(isConvertibleEvidence("a.jpg", "image/jpeg")).toBe(false);
  });

  it("rejects unsupported formats with a Vietnamese message", () => {
    expect(rejectReasonForAsset({ fileName: "a.gif", mimeType: "image/gif" })).toContain("JPG");
    expect(rejectReasonForAsset({ fileName: "a.jpg", mimeType: "image/jpeg" })).toBeNull();
    expect(rejectReasonForAsset({ fileName: "IMG.HEIC", mimeType: "image/heic" })).toBeNull();
  });

  it("builds a safe upload name with a supported extension", () => {
    expect(buildEvidenceFileName("my photo.PNG", "image/png", 0, 123)).toBe("my-photo.png");
    expect(buildEvidenceFileName("IMG.HEIC", "image/jpeg", 1, 123)).toBe("IMG.jpg");
    expect(buildEvidenceFileName(undefined, "image/jpeg", 2, 123)).toBe("anh-123-2.jpg");
    expect(buildEvidenceFileName("../../etc/passwd", "image/jpeg", 0, 1)).toContain(".jpg");
  });

  it("detects when client-side resize is needed", () => {
    expect(needsCompression(4000, 3000)).toBe(true);
    expect(needsCompression(800, 600)).toBe(false);
    expect(needsCompression(null, null)).toBe(true);
    expect(EVIDENCE_MAX_SIDE_PX).toBe(1600);
  });
});
