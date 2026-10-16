/**
 * Trace-code parser for manual input and pasted trace links — a straight port
 * of the Mobile `lib/trace-code.ts`, so both clients accept exactly the same
 * strings and reject exactly the same ones.
 *
 * Real data on AgriMarket lots is one of:
 * - a bare code, e.g. `TRC-000019-BAPCA` (any letter case, padding spaces OK);
 * - a trace page URL, e.g. `https://shop.../truy-xuat/TRC-000019-BAPCA`;
 * - a URL carrying the code in a query parameter, e.g. `?code=TRC-...`.
 *
 * The backend lookup (`GET /trace/:traceCode`) is an exact match, so the
 * parser returns the UPPERCASED code or `null` when nothing valid is found.
 * Callers must NOT route to the trace screen (or call the API) with `null`.
 */

const TRACE_CODE_RE = /^TRC-\d{6}-[A-Z0-9]{2,16}$/;

function candidate(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().toUpperCase();
  return TRACE_CODE_RE.test(normalized) ? normalized : null;
}

/**
 * Extract a trace code from raw manual input or a pasted link.
 * Never throws; returns `null` for empty, arbitrary or external data.
 */
export function parseTraceCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;

  const direct = candidate(text);
  if (direct) return direct;

  // Absolute URL: strip scheme+authority, then inspect path and query values.
  if (/^https?:\/\//i.test(text)) {
    const withoutScheme = text.replace(/^https?:\/\//i, "");
    const slash = withoutScheme.indexOf("/");
    const rest = slash >= 0 ? withoutScheme.slice(slash) : "";
    return parsePathAndQuery(rest);
  }

  // App-relative path such as `/truy-xuat/TRC-000019-BAPCA?code=...`.
  if (text.startsWith("/")) return parsePathAndQuery(text);

  return null;
}

/** Scan `path` segments then `query` values for the first valid trace code. */
function parsePathAndQuery(value: string): string | null {
  const qIndex = value.indexOf("?");
  const path = qIndex >= 0 ? value.slice(0, qIndex) : value;
  const query = qIndex >= 0 ? value.slice(qIndex + 1) : "";

  for (const segment of path.split("/")) {
    const hit = candidate(safeDecode(segment));
    if (hit) return hit;
  }

  if (query) {
    for (const pair of query.split("&")) {
      const eq = pair.indexOf("=");
      const rawValue = eq >= 0 ? pair.slice(eq + 1) : pair;
      const hit = candidate(safeDecode(rawValue));
      if (hit) return hit;
    }
  }

  return null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** True when the raw value already is (or contains, for URLs) a valid code. */
export function isTraceCode(raw: unknown): boolean {
  return parseTraceCode(raw) !== null;
}
