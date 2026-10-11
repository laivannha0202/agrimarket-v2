import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./utils";
import { takeAntdWarnings } from "./setup";
import type { FlashSale, Paginated, Product, ProductVariant } from "@/types/api";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/flash-sales",
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string | { pathname?: string };
    [key: string]: unknown;
  }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

const VARIANT: ProductVariant = {
  id: 501,
  productId: 42,
  sku: "RMH-500G",
  name: "Gói 500 g",
  weight: "500",
  weightUnit: "g",
  saleUnit: "gói",
  basePrice: "32000",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const PRODUCT: Product = {
  id: 42,
  partnerId: 9,
  categoryId: 11,
  farmId: 9,
  name: "Rau muống hạt",
  slug: "rau-muong-hat",
  description: null,
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  variants: [VARIANT],
};

const resourcesMock = vi.hoisted(() => ({
  flashSales: vi.fn(),
  createFlashSale: vi.fn(),
  updateFlashSaleStatus: vi.fn(),
  products: vi.fn(),
}));

vi.mock("@/lib/api/resources", () => ({ resources: resourcesMock }));

import FlashSalesPage from "@/app/(admin)/flash-sales/page";

const paginated = <T,>(data: T[]): Paginated<T> => ({
  data,
  meta: { page: 1, limit: 20, total: data.length, totalPages: 1 },
});

const emptyFlashSales = (): Paginated<FlashSale> => paginated<FlashSale>([]);

async function openCreateForm() {
  renderWithProviders(<FlashSalesPage />);
  await userEvent.click(await screen.findByRole("button", { name: /Thêm flash sale/ }));
  const title = await screen.findByText("Thêm flash sale", {
    selector: ".ant-modal-title",
  });
  return title.closest(".ant-modal") as HTMLElement;
}

describe("Flash Sale create form (labels + validation)", () => {
  beforeEach(() => {
    resourcesMock.flashSales.mockReset().mockResolvedValue(emptyFlashSales());
    resourcesMock.createFlashSale.mockReset().mockResolvedValue({ id: 1 });
    resourcesMock.updateFlashSaleStatus.mockReset().mockResolvedValue({});
    resourcesMock.products.mockReset().mockResolvedValue(paginated([PRODUCT]));
    takeAntdWarnings();
  });

  it("labels the two numeric item fields unambiguously", async () => {
    const dialog = await openCreateForm();
    // Labels are rendered as form-item labels inside the dialog.
    await waitFor(() => {
      expect(within(dialog).getByText("Số lượng ưu đãi")).toBeInTheDocument();
      expect(within(dialog).getByText("Giới hạn mỗi khách")).toBeInTheDocument();
      expect(within(dialog).getByText("Giá flash (đ)")).toBeInTheDocument();
    });
    expect(takeAntdWarnings()).toEqual([]);
  });

  it("blocks submit and rejects a non-integer quota", async () => {
    const dialog = await openCreateForm();

    // Fill the required top-level fields so only the item validation can fail.
    await userEvent.type(within(dialog).getByLabelText("Tên chương trình"), "Flash Sale test");

    const quota = within(dialog).getByLabelText("Số lượng ưu đãi");
    await userEvent.clear(quota);
    await userEvent.type(quota, "1.5");
    await userEvent.tab();

    // Validator message must appear; createFlashSale must not be called.
    await waitFor(() =>
      expect(
        within(dialog).getByText("Số lượng ưu đãi là số nguyên ≥ 1."),
      ).toBeInTheDocument(),
    );
    expect(resourcesMock.createFlashSale).not.toHaveBeenCalled();
    expect(takeAntdWarnings()).toEqual([]);
  });

  it("rejects a per-customer limit greater than the quota", async () => {
    const dialog = await openCreateForm();
    await userEvent.type(within(dialog).getByLabelText("Tên chương trình"), "Flash Sale test");

    const quota = within(dialog).getByLabelText("Số lượng ưu đãi");
    await userEvent.clear(quota);
    await userEvent.type(quota, "5");

    const perCustomer = within(dialog).getByLabelText("Giới hạn mỗi khách");
    await userEvent.clear(perCustomer);
    await userEvent.type(perCustomer, "10");
    await userEvent.tab();

    await waitFor(() =>
      expect(
        within(dialog).getByText("Giới hạn mỗi khách không vượt quá số lượng ưu đãi."),
      ).toBeInTheDocument(),
    );
    expect(resourcesMock.createFlashSale).not.toHaveBeenCalled();
  });

  it("defaults quota and per-customer limit to 1 (matching the DTO min)", async () => {
    const dialog = await openCreateForm();
    await waitFor(() => {
      expect((within(dialog).getByLabelText("Số lượng ưu đãi") as HTMLInputElement).value).toBe(
        "1",
      );
      expect(
        (within(dialog).getByLabelText("Giới hạn mỗi khách") as HTMLInputElement).value,
      ).toBe("1");
    });
  });
});
