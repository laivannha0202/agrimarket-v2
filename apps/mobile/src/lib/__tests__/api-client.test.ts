import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

const { buildUrl } = await import("../api-client");

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
