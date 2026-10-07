/**
 * Lightweight API client for the AgriMarket V2 backend.
 *
 * - native fetch only (no axios)
 * - attaches the bearer token from the auth session
 * - parses JSON safely, handles 204 and non-JSON error bodies
 * - maps HTTP errors to a friendly Vietnamese `ApiError` without leaking
 *   stack traces / Prisma internals to the UI
 * - supports query params and an AbortController timeout
 */

import { getToken } from "@/lib/auth/session";

const API_BASE_URL =
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
}

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  params?: Record<string, QueryValue>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function buildUrl(path: string, params?: Record<string, QueryValue>): string {
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

function extractMessage(status: number, body: unknown): string {
  const fallback = fallbackMessage(status);
  if (!body || typeof body !== "object") return fallback;
  const b = body as ApiErrorBody;
  const raw = b.message;
  if (Array.isArray(raw)) {
    const joined = raw.filter(Boolean).join(" ");
    return joined || fallback;
  }
  if (typeof raw === "string" && raw.trim()) {
    // Keep server business messages (they are already human readable) but
    // never surface internal technical text.
    if (/prisma|sql|stack|at \w+\./i.test(raw)) return fallback;
    return raw;
  }
  return fallback;
}

function fallbackMessage(status: number): string {
  switch (status) {
    case 400:
      return "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.";
    case 401:
      return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
    case 403:
      return "Bạn không có quyền thực hiện thao tác này.";
    case 404:
      return "Không tìm thấy dữ liệu.";
    case 409:
      return "Dữ liệu đã tồn tại hoặc xung đột nghiệp vụ.";
    default:
      return "Đã xảy ra lỗi. Vui lòng thử lại.";
  }
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, params, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

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
    throw new ApiError(0, "Không kết nối được máy chủ. Vui lòng thử lại.");
  }
  clearTimeout(timeout);

  const parsed = await parseBody(res);

  if (!res.ok) {
    const apiError = new ApiError(
      res.status,
      extractMessage(res.status, parsed),
      parsed && typeof parsed === "object" ? (parsed as ApiErrorBody) : undefined,
    );
    if (res.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("agri:unauthorized"));
    }
    throw apiError;
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string, params?: Record<string, QueryValue>, signal?: AbortSignal) =>
    apiFetch<T>(path, { method: "GET", params, signal }),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PATCH", body }),
};
