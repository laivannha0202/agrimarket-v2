import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./utils";
import { takeAntdWarnings } from "./setup";
import type { Category, Paginated } from "@/types/api";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/categories",
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

const ROW: Category = {
  id: 11,
  name: "Rau ăn lá",
  slug: "rau-an-la",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};

const resourcesMock = vi.hoisted(() => ({
  categories: vi.fn(),
  updateCategory: vi.fn(),
  createCategory: vi.fn(),
}));

vi.mock("@/lib/api/resources", () => ({ resources: resourcesMock }));

import CategoriesPage from "@/app/(admin)/categories/page";

const paginated = <T,>(data: T[]): Paginated<T> => ({
  data,
  meta: { page: 1, limit: 20, total: data.length, totalPages: 1 },
});

function editDialog(): HTMLElement {
  return screen.getByText("Chỉnh sửa danh mục").closest(".ant-modal") as HTMLElement;
}

describe("Category edit form (bug: name not hydrated)", () => {
  beforeEach(() => {
    resourcesMock.categories.mockReset().mockResolvedValue(paginated([ROW]));
    resourcesMock.updateCategory.mockReset().mockResolvedValue(ROW);
    takeAntdWarnings();
  });

  it("shows the record's name (not the placeholder) when editing", async () => {
    renderWithProviders(<CategoriesPage />);

    const editButton = await screen.findByRole("button", { name: "Sửa" });
    await userEvent.click(editButton);

    const dialog = editDialog();
    await waitFor(() =>
      expect((within(dialog).getByLabelText("Tên danh mục") as HTMLInputElement).value).toBe(
        "Rau ăn lá",
      ),
    );

    expect(takeAntdWarnings()).toEqual([]);
  });

  it("does not leak a previously edited record into the next edit", async () => {
    const rows: Category[] = [
      ROW,
      {
        ...ROW,
        id: 12,
        name: "Củ quả",
        slug: "cu-qua",
      },
    ];
    resourcesMock.categories.mockReset().mockResolvedValue(paginated(rows));
    renderWithProviders(<CategoriesPage />);

    const editButtons = await screen.findAllByRole("button", { name: "Sửa" });

    await userEvent.click(editButtons[0]);
    await waitFor(() =>
      expect(
        (within(editDialog()).getByLabelText("Tên danh mục") as HTMLInputElement).value,
      ).toBe("Rau ăn lá"),
    );
    await userEvent.click(within(editDialog()).getByRole("button", { name: "Close" }));

    await userEvent.click(editButtons[1]);
    await waitFor(() =>
      expect(
        (within(editDialog()).getByLabelText("Tên danh mục") as HTMLInputElement).value,
      ).toBe("Củ quả"),
    );

    expect(takeAntdWarnings()).toEqual([]);
  });

  it("saves the edited name and keeps the stable slug out of the payload", async () => {
    renderWithProviders(<CategoriesPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Sửa" }));
    const dialog = editDialog();
    await waitFor(() =>
      expect((within(dialog).getByLabelText("Tên danh mục") as HTMLInputElement).value).toBe(
        "Rau ăn lá",
      ),
    );

    const nameInput = within(dialog).getByLabelText("Tên danh mục");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Rau ăn lá (đổi)");
    await userEvent.click(within(dialog).getByRole("button", { name: "Lưu" }));

    await waitFor(() => expect(resourcesMock.updateCategory).toHaveBeenCalledTimes(1));
    const [id, payload] = resourcesMock.updateCategory.mock.calls[0];
    expect(id).toBe(11);
    expect(payload).toEqual({ name: "Rau ăn lá (đổi)", status: "ACTIVE" });
    expect(takeAntdWarnings()).toEqual([]);
  });
});
