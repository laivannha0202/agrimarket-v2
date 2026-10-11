/**
 * Single place that decides which backend the mobile app talks to.
 *
 * - Reads `EXPO_PUBLIC_API_BASE_URL` (set in `.env`, see `.env.example`).
 * - There is NO hardcoded LAN fallback: the phone must reach the dev machine
 *   over Wi-Fi, and a stale IP silently pointing elsewhere is worse than an
 *   explicit "not configured" notice. When the variable is missing the app
 *   shows `ApiConfigNotice` instead of failing with a cryptic network error.
 * - NEVER use `localhost` here: `localhost` on the phone is the phone itself.
 */

function normalizeBaseUrl(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  return normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
}

/** True when `.env` points at a reachable backend (non-empty, non-localhost). */
export function isApiConfigured(url: string = getApiBaseUrl()): boolean {
  return url.length > 0 && !isLocalhostBaseUrl(url);
}

/** Human guidance shown when the API address is missing or unreachable. */
export function apiConfigNotice(url: string = getApiBaseUrl()): string | null {
  if (!url) {
    return "Chưa cấu hình địa chỉ API. Tạo file apps/mobile/.env với EXPO_PUBLIC_API_BASE_URL=http://<IP-may-tinh>:3000/api/v1 rồi khởi động lại Expo.";
  }
  if (isLocalhostBaseUrl(url)) {
    return "Địa chỉ API đang là localhost — điện thoại không kết nối được. Đổi EXPO_PUBLIC_API_BASE_URL trong apps/mobile/.env sang IP LAN của máy tính.";
  }
  return null;
}

/** `http://host:port/api/v1` -> `http://host:port` (for image-URL rewriting). */
export function getApiOrigin(): string {
  const base = getApiBaseUrl();
  if (!base) return "";
  return base.replace(/\/api\/v1\/?$/, "");
}

/** True when the configured base URL points at the phone itself (unreachable). */
export function isLocalhostBaseUrl(url: string = getApiBaseUrl()): boolean {
  return /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?/i.test(url.trim());
}

/**
 * Full URL for one evidence photo.
 *
 * The image is private, so there is no public URL to store: the client builds
 * this from the id at render time and attaches the bearer token. That is why
 * the API returns ids instead of links — a link in the payload would suggest
 * the file is readable without a session.
 */
export function evidenceFileUrl(id: number): string {
  return `${getApiBaseUrl().replace(/\/+$/, "")}/evidence/${id}/file`;
}
