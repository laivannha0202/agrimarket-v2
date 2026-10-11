/**
 * Lightweight API client for the AgriMarket V2 backend.
 *
 * - native `fetch` only (no axios)
 * - attaches the bearer token from the auth session
 * - safe JSON parsing, 204 support, query params, AbortController timeout
 * - maps HTTP errors to a friendly Vietnamese `ApiError` and never leaks
 *   stack traces, Prisma internals, English backend text or DTO field names
 */

import { getToken } from "@/lib/auth/session";
import { translateApiMessage } from "./messages";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1";

const DEFAULT_TIMEOUT_MS = 20_000;

export interface ApiErrorBody {
  statusCode?: number;
  error?: string;
  message?: string | string[];
  timestamp?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body?: ApiErrorBody;

  constructor(status: number, message: string, body?: ApiErrorBody) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  /** True when the backend rejected the request on a business rule. */
  get isBusinessError(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 401;
  }
}

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  params?: Record<string, QueryValue>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Skip the Authorization header (public endpoints). */
  anonymous?: boolean;
  /** Extra request headers (e.g. `Idempotency-Key`). */
  headers?: Record<string, string>;
}

export function buildUrl(path: string, params?: Record<string, QueryValue>): string {
  const base = API_BASE_URL.replace(/\/+$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${normalized}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function fallbackMessage(status: number): string {
  switch (status) {
    case 400:
      return "Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại.";
    case 401:
      return "Vui lòng đăng nhập để tiếp tục.";
    case 403:
      return "Bạn không có quyền thực hiện thao tác này.";
    case 404:
      return "Không tìm thấy dữ liệu.";
    case 409:
      return "Dữ liệu vừa thay đổi. Vui lòng tải lại trang.";
    case 429:
      return "Bạn thao tác quá nhanh. Vui lòng thử lại sau.";
    default:
      return "Đã xảy ra lỗi. Vui lòng thử lại.";
  }
}

function extractMessage(status: number, body: unknown): string {
  const fallback = fallbackMessage(status);
  if (!body || typeof body !== "object") return fallback;
  const raw = (body as ApiErrorBody).message;

  const sanitize = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Never surface internal technical text to the customer.
    if (/prisma|sql|stack|at \w+\.|invocation|generated\/prisma/i.test(trimmed)) {
      return null;
    }
    // The backend answers in English; the storefront is Vietnamese. Only
    // recognised business messages are shown (translated); anything else falls
    // back to the status-based Vietnamese text rather than leaking English or
    // DTO field names into the UI.
    return translateApiMessage(trimmed);
  };

  if (Array.isArray(raw)) {
    const parts = raw.map((item) => sanitize(String(item))).filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : fallback;
  }
  if (typeof raw === "string") {
    return sanitize(raw) ?? fallback;
  }
  return fallback;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    body,
    params,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    anonymous = false,
    headers: extraHeaders,
  } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (!anonymous) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (extraHeaders) Object.assign(headers, extraHeaders);

  let res: Response;
  try {
    res = await fetch(buildUrl(path, params), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(0, "Yêu cầu quá thời gian chờ. Vui lòng thử lại.");
    }
    throw new ApiError(0, "Không kết nối được máy chủ. Vui lòng kiểm tra kết nối.");
  }
  clearTimeout(timeout);

  const parsed = await parseBody(res);

  if (!res.ok) {
    const error = new ApiError(
      res.status,
      extractMessage(res.status, parsed),
      parsed && typeof parsed === "object" ? (parsed as ApiErrorBody) : undefined,
    );
    if (res.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("agri:unauthorized"));
    }
    throw error;
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string, params?: Record<string, QueryValue>, signal?: AbortSignal) =>
    apiFetch<T>(path, { method: "GET", params, signal }),
  getPublic: <T>(path: string, params?: Record<string, QueryValue>, signal?: AbortSignal) =>
    apiFetch<T>(path, { method: "GET", params, signal, anonymous: true }),
  post: <T>(path: string, body?: unknown, options?: Partial<RequestOptions>) =>
    apiFetch<T>(path, { method: "POST", body, ...options }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string, params?: Record<string, QueryValue>) =>
    apiFetch<T>(path, { method: "DELETE", params }),
};

/**
 * Fetches one private evidence photo and returns it as an object URL.
 *
 * A plain `<img src="...">` cannot be used: the file route is authorised, and
 * an image tag sends no `Authorization` header, so the request would arrive
 * anonymous and be refused for everything except an approved review image. The
 * bytes are therefore fetched with the session and turned into a blob URL.
 *
 * Returns `null` on any failure — a missing or forbidden photo must degrade to
 * a placeholder, not to an unhandled rejection. The caller owns the returned
 * URL and must revoke it.
 */
export async function fetchEvidenceBlobUrl(id: number): Promise<string | null> {
  const token = getToken();
  try {
    const res = await fetch(buildUrl(`/evidence/${id}/file`), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
