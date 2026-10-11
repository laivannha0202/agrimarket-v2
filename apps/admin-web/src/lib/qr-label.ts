/**
 * QR label helpers for lot traceability (admin "Lô & QR").
 *
 * The payload encoded into a lot's QR must satisfy two scanners at once:
 *
 * - the AgriMarket mobile app (Expo) — its parser accepts either the bare
 *   trace code (`TRC-...`) or a trace-page URL whose path/query contains it;
 * - a stock phone camera — only a real URL is actionable there.
 *
 * So the payload is resolved at render time:
 * - `NEXT_PUBLIC_TRACE_BASE_URL` configured as a public HTTPS origin ->
 *   `<base>/truy-xuat/<traceCode>` (the existing customer-web trace page);
 * - otherwise -> the bare trace code from the database (still scanned by the
 *   app; a generic camera shows the code as text for manual entry).
 *
 * Localhost and LAN addresses are never encoded: a label printed with
 * `https://192.168.x.x/...` is dead outside one office network.
 */

const TRACE_CODE_RE = /^TRC-\d{6}-[A-Z0-9]{2,16}$/;

/** Trace codes follow the seeded `TRC-000001-CACHU` shape (case-insensitive). */
export function isValidTraceCode(traceCode: string | null | undefined): boolean {
  if (!traceCode) return false;
  return TRACE_CODE_RE.test(traceCode.trim().toUpperCase());
}

/** True for loopback / RFC1918 / link-local hosts that must not go on a label. */
function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const a = Number(v4[1]);
  const b = Number(v4[2]);
  if (a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function normalizePublicBaseUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (isLocalOrPrivateHost(url.hostname)) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

/**
 * Resolve the exact string encoded into the QR for one lot.
 * Returns "" when the lot has no valid trace code (caller must not render QR).
 */
export function resolveTraceQrPayload(
  traceCode: string | null | undefined,
  baseUrl: string | null | undefined,
): string {
  const code = (traceCode ?? "").trim().toUpperCase();
  if (!isValidTraceCode(code)) return "";
  const base = normalizePublicBaseUrl(baseUrl);
  if (!base) return code;
  return `${base}/truy-xuat/${encodeURIComponent(code)}`;
}

/** Escape interpolated values before they are written into label HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface QrLabelData {
  qrDataUrl: string;
  productName: string;
  lotCode: string;
  traceCode: string;
}

/**
 * Printable tem (label): product name, lot code and trace code next to the QR
 * image. Inline styles only — the print document has no access to app CSS.
 */
export function buildQrLabelHtml(data: QrLabelData): string {
  const productName = escapeHtml(data.productName || "—");
  const lotCode = escapeHtml(data.lotCode);
  const traceCode = escapeHtml(data.traceCode);
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>Tem QR ${lotCode}</title>
<style>
  @page { size: auto; margin: 6mm; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #000; }
  .label { width: 72mm; border: 1px solid #000; border-radius: 3mm; padding: 4mm; display: flex; gap: 4mm; align-items: center; }
  .qr { width: 34mm; height: 34mm; }
  .info { flex: 1; min-width: 0; }
  .product { font-size: 13px; font-weight: 700; margin: 0 0 2mm; line-height: 1.25; }
  .line { font-size: 10.5px; margin: 0 0 1.5mm; }
  .code { font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; font-weight: 700; }
  .hint { font-size: 8.5px; color: #333; margin: 2mm 0 0; }
</style>
</head>
<body>
  <div class="label">
    <img class="qr" src="${data.qrDataUrl}" alt="QR ${traceCode}" />
    <div class="info">
      <p class="product">${productName}</p>
      <p class="line">Lô: <span class="code">${lotCode}</span></p>
      <p class="line">Mã truy xuất: <span class="code">${traceCode}</span></p>
      <p class="hint">Quét mã QR hoặc nhập mã truy xuất trên ứng dụng AgriMarket.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Print an HTML document without navigating away from the admin app:
 * a hidden same-origin iframe is written synchronously and printed.
 *
 * Printing waits for the embedded QR image (a data URL) to finish loading —
 * printing too early can produce a blank frame — with a hard timeout fallback
 * so a failed image never blocks the print dialog.
 */
export function printHtmlDocument(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    try {
      win.focus();
      win.print();
    } catch {
      // A blocked print dialog must not crash the admin UI; the iframe is
      // removed below either way.
    }
  };

  const img = doc.querySelector("img");
  if (img && !img.complete) {
    img.addEventListener("load", () => window.setTimeout(doPrint, 50), { once: true });
    img.addEventListener("error", () => window.setTimeout(doPrint, 50), { once: true });
    window.setTimeout(doPrint, 1000);
  } else {
    window.setTimeout(doPrint, 50);
  }

  window.setTimeout(() => frame.remove(), 60_000);
}
