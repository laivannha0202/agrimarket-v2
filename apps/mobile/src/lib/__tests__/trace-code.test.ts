import { describe, expect, it } from "vitest";
import { isTraceCode, parseTraceCode } from "../trace-code";

describe("parseTraceCode", () => {
  it("accepts a bare code in any letter case", () => {
    expect(parseTraceCode("TRC-000019-BAPCA")).toBe("TRC-000019-BAPCA");
    expect(parseTraceCode("  trc-000019-bapca  ")).toBe("TRC-000019-BAPCA");
  });

  it("extracts the code from a trace page URL path", () => {
    expect(parseTraceCode("https://shop.agrimarket.vn/truy-xuat/TRC-000019-BAPCA")).toBe("TRC-000019-BAPCA");
    expect(parseTraceCode("http://192.168.1.10:3000/trace/trc-000019-bapca")).toBe("TRC-000019-BAPCA");
    expect(parseTraceCode("/truy-xuat/TRC-000019-BAPCA")).toBe("TRC-000019-BAPCA");
  });

  it("extracts the code from a URL query parameter", () => {
    expect(parseTraceCode("https://shop.agrimarket.vn/tra-cuu?code=TRC-000019-BAPCA")).toBe("TRC-000019-BAPCA");
    expect(parseTraceCode("https://shop.agrimarket.vn/x?foo=1&traceCode=trc-000019-bapca")).toBe("TRC-000019-BAPCA");
    expect(parseTraceCode("/truy-xuat?code=TRC-000019-BAPCA")).toBe("TRC-000019-BAPCA");
  });

  it("rejects empty, arbitrary and external data without a code", () => {
    expect(parseTraceCode("")).toBeNull();
    expect(parseTraceCode("   ")).toBeNull();
    expect(parseTraceCode("HELLO-WORLD")).toBeNull();
    expect(parseTraceCode("TRC-19-BAPCA")).toBeNull();
    expect(parseTraceCode("https://example.com/products/12")).toBeNull();
    expect(parseTraceCode("https://example.com/?code=NOTACODE")).toBeNull();
    expect(parseTraceCode(undefined)).toBeNull();
    expect(parseTraceCode(123)).toBeNull();
  });

  it("never uppercases a whole URL into a fake code", () => {
    // The old bug: `raw.toUpperCase()` turned any URL into a "code".
    const url = "https://example.com/products/12";
    expect(parseTraceCode(url)).toBeNull();
    expect(isTraceCode(url)).toBe(false);
  });

  it("isTraceCode mirrors parseTraceCode", () => {
    expect(isTraceCode("TRC-000019-BAPCA")).toBe(true);
    expect(isTraceCode("nope")).toBe(false);
  });

  /**
   * The parser deliberately avoids `URL`/`URLSearchParams`: React Native's
   * partial polyfill behaves differently from Node, so a QR that is a URL could
   * parse on the phone differently from these tests. These cases pin the
   * pure-string behaviour that now runs identically on both.
   */
  it("parses URL-shaped input without relying on the URL polyfill", () => {
    // Authority-only URL with no path or query holds no code.
    expect(parseTraceCode("https://example.com")).toBeNull();
    // Query value before path code: the path is scanned first.
    expect(parseTraceCode("https://x.vn/truy-xuat/TRC-000019-BAPCA?code=TRC-000002-XXXX")).toBe(
      "TRC-000019-BAPCA",
    );
    // Percent-encoded path segment must still be found.
    expect(parseTraceCode("https://x.vn/trace/TRC-000019-BAPCA%20")).toBe("TRC-000019-BAPCA");
    // Query pair with no `=` sign.
    expect(parseTraceCode("/tra-cuu?TRC-000019-BAPCA")).toBe("TRC-000019-BAPCA");
    // Later query value wins only if earlier ones are not codes.
    expect(parseTraceCode("/x?a=1&b=TRC-000019-BAPCA&c=2")).toBe("TRC-000019-BAPCA");
  });

  it("gives the same result for a scanned QR and manual entry of the same lot", () => {
    // Both paths must land on the same trace code: this is exactly what the
    // admin QR encodes for LOT-20260930-0015 (bare code in dev, public URL in
    // production) and what a user types from the printed label.
    const scannedBare = parseTraceCode("TRC-000015-RAUMU");
    const scannedUrl = parseTraceCode("https://shop.agrimarket.vn/truy-xuat/TRC-000015-RAUMU");
    const manual = parseTraceCode("  trc-000015-raumu ");
    expect(scannedBare).toBe("TRC-000015-RAUMU");
    expect(scannedUrl).toBe("TRC-000015-RAUMU");
    expect(manual).toBe("TRC-000015-RAUMU");
    expect(scannedBare).toBe(manual);
    expect(scannedUrl).toBe(manual);
  });

  it("survives malformed percent-encoding instead of throwing", () => {
    // A lone "%" is invalid percent-encoding; the parser must not throw.
    expect(parseTraceCode("https://x.vn/trace/%E0%A4%A")).toBeNull();
    expect(parseTraceCode("https://x.vn/trace/%")).toBeNull();
    expect(parseTraceCode("/x?code=%")).toBeNull();
  });
});
