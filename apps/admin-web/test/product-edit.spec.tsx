import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./utils";
import { takeAntdWarnings } from "./setup";
import type { Paginated, Product } from "@/types/api";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "42" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/products/42",
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

const PRODUCT: Product = {
  id: 42,
  partnerId: 9,
  categoryId: 11,
  farmId: 9,
  name: "Rau muống hạt",
  slug: "rau-muong-hat",
  description: "Rau muống hạt non, thân giòn, xào tỏi rất ngon.",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  category: { id: 11, name: "Rau ăn lá", slug: "rau-an-la" },
  partner: { id: 9, code: "PT-0001", name: "HTX Minh Châu" },
  images: [],
  variants: [],
};

const paginated = <T,>(data: T[]): Paginated<T> => ({
  data,
  meta: { page: 1, limit: 20, total: data.length, totalPages: 1 },
});

const resourcesMock = vi.hoisted(() => ({
  product: vi.fn(),
  updateProduct: vi.fn(),
  farms: vi.fn(),
  categories: vi.fn(),
  partners: vi.fn(),
  uploadProductImage: vi.fn(),
  replaceProductImage: vi.fn(),
  setPrimaryImage: vi.fn(),
  reorderProductImages: vi.fn(),
  deleteProductImage: vi.fn(),
  addVariant: vi.fn(),
}));

vi.mock("@/lib/api/resources", () => ({
  resources: resourcesMock,
}));

import ProductDetailPage from "@/app/(admin)/products/[id]/page";

function editDialog(): HTMLElement {
  // Both the edit and the "add variant" dialogs are mounted (forceRender), so
  // scope every query to the edit dialog by its title to avoid ambiguity.
  return screen.getByText("Chỉnh sửa sản phẩm").closest(".ant-modal") as HTMLElement;
}

function selectText(dialog: HTMLElement, label: string): string | null {
  const item = within(dialog).getByText(label).closest(".ant-form-item");
  const content = item?.querySelector(".ant-select-content");
  return content?.textContent ?? null;
}

describe("Product edit form (bug: empty edit fields)", () => {
  beforeEach(() => {
    resourcesMock.product.mockReset().mockResolvedValue(PRODUCT);
    resourcesMock.updateProduct.mockReset().mockResolvedValue(PRODUCT);
    resourcesMock.farms
      .mockReset()
      .mockResolvedValue(
        paginated([
          {
            id: 9,
            code: "FARM-0001",
            partnerId: 9,
            name: "Trang trại Minh Châu 1",
            address: "Hưng Yên",
            latitude: null,
            longitude: null,
            areaHa: null,
            description: null,
            status: "ACTIVE",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
      );
    resourcesMock.categories.mockReset().mockResolvedValue(paginated([PRODUCT.category! as never]));
    resourcesMock.partners
      .mockReset()
      .mockResolvedValue(
        paginated([
          {
            id: 9,
            code: "PT-0001",
            name: "HTX Minh Châu",
            representativeName: "A",
            phone: "0",
            email: "a@b.c",
            address: "HN",
            taxCode: null,
            bankAccountName: null,
            bankAccountNumber: null,
            bankName: null,
            status: "ACTIVE",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
      );
    takeAntdWarnings();
  });

  it("does not render the Edit action until the product has loaded", async () => {
    // Never resolves → still loading.
    resourcesMock.product.mockReset().mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ProductDetailPage />);
    expect(screen.queryByRole("button", { name: /Chỉnh sửa/ })).toBeNull();
  });

  it("populates every editable field from the loaded product", async () => {
    renderWithProviders(<ProductDetailPage />);

    const editButton = await screen.findByRole("button", { name: /Chỉnh sửa/ });
    await userEvent.click(editButton);

    const dialog = editDialog();
    await waitFor(() => {
      expect((within(dialog).getByLabelText("Tên sản phẩm") as HTMLInputElement).value).toBe(
        "Rau muống hạt",
      );
    });

    expect((within(dialog).getByLabelText("Đường dẫn sản phẩm") as HTMLInputElement).value).toBe(
      "rau-muong-hat",
    );
    expect((within(dialog).getByLabelText("Mô tả") as HTMLTextAreaElement).value).toBe(
      "Rau muống hạt non, thân giòn, xào tỏi rất ngon.",
    );
    expect(selectText(dialog, "Nhóm sản phẩm")).toContain("Rau ăn lá");
    expect(selectText(dialog, "Trạng thái")).toContain("Đang hoạt động");

    expect(takeAntdWarnings()).toEqual([]);
  });

  it("keeps the slug read-only on edit", async () => {
    renderWithProviders(<ProductDetailPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Chỉnh sửa/ }));
    const dialog = editDialog();
    await within(dialog).findByLabelText("Đường dẫn sản phẩm");
    expect(
      (within(dialog).getByLabelText("Đường dẫn sản phẩm") as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("re-populates the same data after close and reopen (no lost/blank state)", async () => {
    renderWithProviders(<ProductDetailPage />);
    const editButton = await screen.findByRole("button", { name: /Chỉnh sửa/ });

    await userEvent.click(editButton);
    await waitFor(() =>
      expect(
        (within(editDialog()).getByLabelText("Tên sản phẩm") as HTMLInputElement).value,
      ).toBe("Rau muống hạt"),
    );

    // Close via the edit dialog's own close button, then reopen.
    const closeBtn = within(editDialog()).getByRole("button", { name: "Close" });
    await userEvent.click(closeBtn);

    await userEvent.click(editButton);
    const dialog = editDialog();
    await waitFor(() =>
      expect((within(dialog).getByLabelText("Tên sản phẩm") as HTMLInputElement).value).toBe(
        "Rau muống hạt",
      ),
    );
    expect((within(dialog).getByLabelText("Mô tả") as HTMLTextAreaElement).value).toBe(
      "Rau muống hạt non, thân giòn, xào tỏi rất ngon.",
    );
    expect(takeAntdWarnings()).toEqual([]);
  });

  it("submits the full field set so a PATCH never wipes description/category/status/farm", async () => {
    renderWithProviders(<ProductDetailPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Chỉnh sửa/ }));
    const dialog = editDialog();
    await waitFor(() =>
      expect((within(dialog).getByLabelText("Tên sản phẩm") as HTMLInputElement).value).toBe(
        "Rau muống hạt",
      ),
    );

    // Edit only the name, leave the rest untouched.
    const nameInput = within(dialog).getByLabelText("Tên sản phẩm");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Rau muống hạt (đổi tên)");

    await userEvent.click(within(dialog).getByRole("button", { name: "Lưu" }));

    await waitFor(() => expect(resourcesMock.updateProduct).toHaveBeenCalledTimes(1));
    const [id, payload] = resourcesMock.updateProduct.mock.calls[0];
    expect(id).toBe("42");
    expect(payload).toMatchObject({
      name: "Rau muống hạt (đổi tên)",
      slug: "rau-muong-hat",
      categoryId: 11,
      farmId: 9,
      description: "Rau muống hạt non, thân giòn, xào tỏi rất ngon.",
      status: "ACTIVE",
    });
    expect(takeAntdWarnings()).toEqual([]);
  });
});
