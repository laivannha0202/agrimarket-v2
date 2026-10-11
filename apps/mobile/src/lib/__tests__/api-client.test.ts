import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

const { buildUrl, apiFetch, ApiError } = await import("../api-client");

describe("api-client", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = "http://192.168.1.10:3000/api/v1";
  });

  it("builds URLs with the single configured base and skips empty params", () => {
    const url = buildUrl("/products", { page: 1, limit: 20, search: "", categoryId: undefined });
    expect(url).toContain("/api/v1/products");
    expect(url).toContain("page=1");
    expect(url).not.toContain("search=");
    expect(url).not.toContain("categoryId=");
  });
});

/**
 * Multipart regression: the evidence upload MUST NOT go through `fetch`.
 *
 * Expo SDK 57 installs `expo/fetch` as the global `fetch`, and its FormData
 * converter only understands string / Blob / `{ bytes() }` parts. A React
 * Native file part (`{ uri, name, type }`) makes it throw
 * `Unsupported FormDataPart implementation` before any socket opens — which the
 * customer saw as "Không kết nối được máy chủ" on a perfectly good network.
 *
 * These tests fail if someone routes FormData back through `fetch`, or starts
 * hand-writing `Content-Type` (which would contradict the platform-generated
 * multipart boundary).
 */
describe("api-client multipart upload", () => {
  interface Recorded {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
    timeout: number;
  }

  let sent: Recorded[];
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalXhr: unknown;
  let respond: (xhr: FakeXhr) => void;

  /** Minimal XMLHttpRequest stand-in: records the call, then answers. */
  class FakeXhr {
    method = "";
    url = "";
    headers: Record<string, string> = {};
    body: unknown = undefined;
    timeout = 0;
    status = 0;
    responseText = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(key: string, value: string) {
      this.headers[key] = value;
    }
    send(body: unknown) {
      this.body = body;
      sent.push({
        method: this.method,
        url: this.url,
        headers: this.headers,
        body,
        timeout: this.timeout,
      });
      respond(this);
    }
  }

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = "http://192.168.1.10:3000/api/v1";
    sent = [];
    respond = (xhr) => {
      xhr.status = 201;
      xhr.responseText = JSON.stringify({ id: 77, mimeType: "image/jpeg" });
      xhr.onload?.();
    };
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    originalXhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalXhr !== undefined) {
      (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = originalXhr;
    }
  });

  function evidenceForm(): FormData {
    const form = new FormData();
    // The exact shape `resources.uploadEvidence` builds for a camera-roll photo.
    form.append("file", {
      uri: "file:///data/user/0/vn.agrimarket.mobile/cache/anh.jpg",
      name: "anh.jpg",
      type: "image/jpeg",
    } as unknown as Blob);
    return form;
  }

  it("sends a raw FormData body over XMLHttpRequest, never fetch", async () => {
    const result = await apiFetch<{ id: number }>("/evidence", {
      method: "POST",
      body: evidenceForm(),
      raw: true,
    });

    expect(result).toEqual({ id: 77, mimeType: "image/jpeg" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe("POST");
    expect(sent[0]!.url).toBe("http://192.168.1.10:3000/api/v1/evidence");
    // The file part survives untouched so RN can stream it from disk.
    expect(sent[0]!.body).toBeInstanceOf(FormData);
  });

  it("never sets Content-Type on a multipart body (platform owns the boundary)", async () => {
    await apiFetch("/evidence", { method: "POST", body: evidenceForm(), raw: true });

    const headerNames = Object.keys(sent[0]!.headers).map((h) => h.toLowerCase());
    expect(headerNames).not.toContain("content-type");
    // The request is still authenticated — the upload is not weakened.
    expect(headerNames).toContain("accept");
  });

  it("carries the timeout into the XHR instead of leaving it unbounded", async () => {
    await apiFetch("/evidence", { method: "POST", body: evidenceForm(), raw: true, timeoutMs: 12_345 });
    expect(sent[0]!.timeout).toBe(12_345);
  });

  it("maps an XHR network failure to the offline marker the UI shows", async () => {
    respond = (xhr) => xhr.onerror?.();

    await expect(
      apiFetch("/evidence", { method: "POST", body: evidenceForm(), raw: true }),
    ).rejects.toMatchObject({ status: 0 });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces a server rejection with its HTTP status, not as a network error", async () => {
    respond = (xhr) => {
      xhr.status = 400;
      xhr.responseText = JSON.stringify({ message: "Chỉ nhận ảnh JPG, PNG hoặc WebP." });
      xhr.onload?.();
    };

    const err = await apiFetch("/evidence", { method: "POST", body: evidenceForm(), raw: true }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(400);
    expect((err as InstanceType<typeof ApiError>).message).toBe("Chỉ nhận ảnh JPG, PNG hoặc WebP.");
  });

  it("keeps JSON requests on fetch", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });

    await apiFetch("/complaints", { method: "POST", body: { orderId: 1 } });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
  });
});
