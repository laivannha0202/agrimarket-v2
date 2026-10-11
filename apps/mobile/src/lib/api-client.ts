/**
 * API client for AgriMarket V2. Port of `apps/customer-web/src/lib/api/client.ts`
 * adapted to React Native (no `window`, no DOMException, SecureStore token).
 */

import { apiConfigNotice, getApiBaseUrl } from "./config";
import { translateApiMessage } from "./messages";
import { getToken, clearSession } from "./session";

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

  get isBusinessError(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 401;
  }
}

/**
 * True when the request never reached the backend: offline, DNS failure, a
 * wrong LAN address, or a timeout. `status === 0` is the marker the client sets
 * for all of those (see `apiFetch`).
 *
 * This is deliberately separate from `isBusinessError`: the UI must show the
 * offline illustration ONLY here. A 4xx/5xx means the server answered, so
 * telling the customer to check their Wi-Fi would be wrong.
 */
export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

/** Human message for a query error, falling back to `fallback`. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  params?: Record<string, QueryValue>;
  timeoutMs?: number;
  anonymous?: boolean;
  headers?: Record<string, string>;
  onUnauthorized?: () => void;
  /**
   * Send `body` as-is instead of JSON-encoding it.
   *
   * Used for `FormData` uploads. It is deliberately the ONLY thing it does:
   * no `Content-Type` header is set, because React Native has to generate the
   * multipart boundary itself and a hand-written header would either omit it or
   * contradict it — which is the classic reason an upload "works in Postman"
   * and fails on device.
   */
  raw?: boolean;
}

export function buildUrl(path: string, params?: Record<string, QueryValue>): string {
  const base = getApiBaseUrl().replace(/\/+$/, "");
  if (!base) {
    throw new ApiError(0, apiConfigNotice(base) ?? "Chưa cấu hình địa chỉ API.");
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const query = Object.entries(params ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return query ? `${base}${normalized}?${query}` : `${base}${normalized}`;
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
      return "Dữ liệu vừa thay đổi. Vui lòng tải lại.";
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
    if (/prisma|sql|stack|at \w+\.|invocation|generated\/prisma/i.test(trimmed)) return null;
    return translateApiMessage(trimmed);
  };

  if (Array.isArray(raw)) {
    const parts = raw.map((item) => sanitize(String(item))).filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : fallback;
  }
  if (typeof raw === "string") return sanitize(raw) ?? fallback;
  return fallback;
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

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    body,
    params,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    anonymous = false,
    headers: extraHeaders,
    raw = false,
  } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (!anonymous) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  // A raw body (FormData) must NOT get a Content-Type: React Native sets it,
  // including the multipart boundary it generated.
  if (body !== undefined && !raw) headers["Content-Type"] = "application/json";
  if (extraHeaders) Object.assign(headers, extraHeaders);

  let res: Response;
  try {
    res = await fetch(buildUrl(path, params), {
      method,
      headers,
      body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(0, "Yêu cầu quá thời gian chờ. Vui lòng thử lại.");
    }
    throw new ApiError(0, "Không kết nối được máy chủ. Vui lòng kiểm tra Wi-Fi và địa chỉ API.");
  }
  clearTimeout(timeout);

  const parsed = await parseBody(res);

  if (!res.ok) {
    if (res.status === 401) {
      await clearSession();
      if (unauthorizedHandler) unauthorizedHandler();
      else if (options.onUnauthorized) options.onUnauthorized();
    }
    throw new ApiError(
      res.status,
      extractMessage(res.status, parsed),
      parsed && typeof parsed === "object" ? (parsed as ApiErrorBody) : undefined,
    );
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string, params?: Record<string, QueryValue>) =>
    apiFetch<T>(path, { method: "GET", params }),
  getPublic: <T>(path: string, params?: Record<string, QueryValue>) =>
    apiFetch<T>(path, { method: "GET", params, anonymous: true }),
  post: <T>(path: string, body?: unknown, options?: Partial<RequestOptions>) =>
    apiFetch<T>(path, { method: "POST", body, ...options }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string, params?: Record<string, QueryValue>) =>
    apiFetch<T>(path, { method: "DELETE", params }),
};
