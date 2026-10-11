import { describe, expect, it } from "vitest";
import {
  buildQrLabelHtml,
  escapeHtml,
  isValidTraceCode,
  resolveTraceQrPayload,
} from "@/lib/qr-label";

describe("isValidTraceCode", () => {
  it("accepts real seeded trace codes", () => {
    expect(isValidTraceCode("TRC-000015-RAUMU")).toBe(true);
    expect(isValidTraceCode("TRC-000001-CACHU")).toBe(true);
    expect(isValidTraceCode("TRC-000019-BAPCA")).toBe(true);
  });

  it("rejects wrong shapes and empty values", () => {
    expect(isValidTraceCode("")).toBe(false);
    expect(isValidTraceCode(null)).toBe(false);
    expect(isValidTraceCode(undefined)).toBe(false);
    expect(isValidTraceCode("LOT-20260930-0015")).toBe(false);
    expect(isValidTraceCode("TRC-15-RAUMU")).toBe(false);
    expect(isValidTraceCode("HELLO-WORLD")).toBe(false);
  });
});

describe("resolveTraceQrPayload", () => {
  it("encodes the bare code when no public base URL is configured", () => {
    expect(resolveTraceQrPayload("TRC-000015-RAUMU", undefined)).toBe("TRC-000015-RAUMU");
    expect(resolveTraceQrPayload("TRC-000015-RAUMU", "")).toBe("TRC-000015-RAUMU");
  });

  it("encodes the public trace-page URL when a public HTTPS base is configured", () => {
    expect(resolveTraceQrPayload("TRC-000015-RAUMU", "https://shop.agrimarket.vn")).toBe(
      "https://shop.agrimarket.vn/truy-xuat/TRC-000015-RAUMU",
    );
    expect(resolveTraceQrPayload("TRC-000015-RAUMU", "https://shop.agrimarket.vn/")).toBe(
      "https://shop.agrimarket.vn/truy-xuat/TRC-000015-RAUMU",
    );
  });

  it("never encodes localhost or LAN addresses (dead on a printed label)", () => {
    const dead = [
      "http://localhost:3002",
      "https://localhost:3002",
      "https://127.0.0.1",
      "https://192.168.1.10:3002",
      "https://10.0.0.5",
      "https://172.16.4.4",
      "https://172.31.255.1",
      "https://169.254.1.1",
      "https://[::1]:3002",
    ];
    for (const base of dead) {
      expect(resolveTraceQrPayload("TRC-000015-RAUMU", base)).toBe("TRC-000015-RAUMU");
    }
  });

  it("falls back to the bare code for non-HTTPS or malformed bases", () => {
    expect(resolveTraceQrPayload("TRC-000015-RAUMU", "http://shop.agrimarket.vn")).toBe(
      "TRC-000015-RAUMU",
    );
    expect(resolveTraceQrPayload("TRC-000015-RAUMU", "not a url")).toBe("TRC-000015-RAUMU");
  });

  it("returns empty string for a lot without a valid trace code", () => {
    expect(resolveTraceQrPayload("", "https://shop.agrimarket.vn")).toBe("");
    expect(resolveTraceQrPayload(null, "https://shop.agrimarket.vn")).toBe("");
    expect(resolveTraceQrPayload("LOT-20260930-0015", "https://shop.agrimarket.vn")).toBe("");
  });

  it("normalizes letter case and surrounding spaces", () => {
    expect(resolveTraceQrPayload("  trc-000015-raumu  ", undefined)).toBe("TRC-000015-RAUMU");
  });
});

describe("escapeHtml", () => {
  it("escapes every character that could break the print document", () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;",
    );
  });
});

describe("buildQrLabelHtml", () => {
  const html = buildQrLabelHtml({
    qrDataUrl: "data:image/png;base64,AAAA",
    productName: "Rau muống hạt",
    lotCode: "LOT-20260930-0015",
    traceCode: "TRC-000015-RAUMU",
  });

  it("contains product name, lot code, trace code and the QR image", () => {
    expect(html).toContain("Rau muống hạt");
    expect(html).toContain("LOT-20260930-0015");
    expect(html).toContain("TRC-000015-RAUMU");
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });

  it("escapes untrusted text so a product name cannot inject markup", () => {
    const evil = buildQrLabelHtml({
      qrDataUrl: "data:image/png;base64,AAAA",
      productName: '<img src=x onerror="alert(1)">',
      lotCode: "LOT-1",
      traceCode: "TRC-000001-CACHU",
    });
    expect(evil).not.toContain("<img src=x");
    expect(evil).toContain("&lt;img src=x");
  });
});
