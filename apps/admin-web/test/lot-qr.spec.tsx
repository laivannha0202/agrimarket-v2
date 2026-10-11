import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./utils";
import { takeAntdWarnings } from "./setup";
import type { Paginated, Product, ProductLot } from "@/types/api";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/lots",
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

// Keep every real helper (payload resolution, label HTML) but stub the actual
// print call: jsdom cannot open a print dialog.
const printHtmlDocument = vi.hoisted(() => vi.fn());
vi.mock("@/lib/qr-label", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/qr-label")>();
  return { ...actual, printHtmlDocument };
});

const resourcesMock = vi.hoisted(() => ({
  lots: vi.fn(),
  products: vi.fn(),
  harvests: vi.fn(),
}));

vi.mock("@/lib/api/resources", () => ({ resources: resourcesMock }));

import LotsPage from "@/app/(admin)/lots/page";

const paginated = <T,>(data: T[]): Paginated<T> => ({
  data,
  meta: { page: 1, limit: 20, total: data.length, totalPages: 1 },
});

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
};

const LOT_RAUMU: ProductLot = {
  id: 53,
  code: "LOT-20260930-0015",
  productId: 42,
  harvestId: 15,
  quantity: "260",
  unit: "kg",
  remainingQuantity: "260",
  grade: "Loại 1",
  packedAt: "2026-09-30T01:00:00.000Z",
  // Clearly in the future: the QR guard refuses expired lots, so a fixture
  // pinned to "today" would flip the assertions at midnight.
  expiresAt: "2027-10-11T17:00:00.000Z",
  status: "SELLABLE",
  traceCode: "TRC-000015-RAUMU",
  createdAt: "2026-09-30T01:00:00.000Z",
  updatedAt: "2026-09-30T01:00:00.000Z",
  product: PRODUCT,
};

/** A malformed trace code must not offer a QR action. */
const LOT_NO_CODE: ProductLot = {
  ...LOT_RAUMU,
  id: 99,
  code: "LOT-20260920-0000",
  traceCode: "",
};

/** A rejected lot has a valid code but must not offer a sales label. */
const LOT_REJECTED: ProductLot = {
  ...LOT_RAUMU,
  id: 98,
  code: "LOT-20260920-0001",
  traceCode: "TRC-000098-REJECT",
  status: "REJECTED",
};

/** An expired lot must not offer a sales label either. */
const LOT_EXPIRED: ProductLot = {
  ...LOT_RAUMU,
  id: 97,
  code: "LOT-20260920-0002",
  traceCode: "TRC-000097-EXPIRED",
  expiresAt: "2020-01-01T00:00:00.000Z",
};

async function openQrModal(): Promise<HTMLElement> {
  renderWithProviders(<LotsPage />);
  const buttons = await screen.findAllByRole("button", { name: /Xem QR/ });
  await userEvent.click(buttons[0]);
  const dialog = await screen.findByRole("dialog");
  return dialog;
}

describe("Admin Lô & QR — xem/tải/in QR theo mã truy xuất thật của lô", () => {
  beforeEach(() => {
    resourcesMock.lots
      .mockReset()
      .mockResolvedValue(paginated([LOT_RAUMU, LOT_NO_CODE, LOT_REJECTED, LOT_EXPIRED]));
    resourcesMock.products.mockReset().mockResolvedValue(paginated<Product>([]));
    resourcesMock.harvests.mockReset().mockResolvedValue(paginated([]));
    printHtmlDocument.mockReset();
    takeAntdWarnings();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("shows the QR action only for sellable lots with a valid trace code", async () => {
    renderWithProviders(<LotsPage />);
    // Exactly one actionable lot: the malformed code, the rejected lot and the
    // expired lot never get a sales label.
    const buttons = await screen.findAllByRole("button", { name: /Xem QR/ });
    expect(buttons).toHaveLength(1);
    expect(takeAntdWarnings()).toEqual([]);
  });

  it("renders the QR dialog from the real lot data (code, product, payload)", async () => {
    const dialog = await openQrModal();
    await waitFor(() => {
      expect(within(dialog).getByText("Rau muống hạt")).toBeInTheDocument();
      expect(within(dialog).getByText("LOT-20260930-0015")).toBeInTheDocument();
      // Trace code appears twice: under the QR image and in the details table.
      expect(within(dialog).getAllByText("TRC-000015-RAUMU").length).toBeGreaterThan(0);
    });
    // Without NEXT_PUBLIC_TRACE_BASE_URL the payload is the bare code, so the
    // payload line reads exactly "Nội dung mã QR: TRC-000015-RAUMU".
    expect(dialog.textContent).toContain("Nội dung mã QR: TRC-000015-RAUMU");
    expect(within(dialog).getByRole("button", { name: /Tải ảnh QR/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /In tem QR/ })).toBeInTheDocument();
    expect(takeAntdWarnings()).toEqual([]);
  });

  it("encodes a public HTTPS trace URL when NEXT_PUBLIC_TRACE_BASE_URL is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_TRACE_BASE_URL", "https://shop.agrimarket.vn");
    const dialog = await openQrModal();
    await waitFor(() => {
      expect(dialog.textContent).toContain(
        "https://shop.agrimarket.vn/truy-xuat/TRC-000015-RAUMU",
      );
    });
    const link = within(dialog).getByRole("link", { name: "Mở trang truy xuất" });
    expect(link).toHaveAttribute("href", "https://shop.agrimarket.vn/truy-xuat/TRC-000015-RAUMU");
    expect(takeAntdWarnings()).toEqual([]);
  });

  it("downloads the QR as a PNG named after the trace code", async () => {
    const dialog = await openQrModal();
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
    const created: HTMLAnchorElement[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => {
      const el = origCreate(tagName, options);
      if (tagName === "a") created.push(el as HTMLAnchorElement);
      return el;
    }) as typeof document.createElement);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await userEvent.click(within(dialog).getByRole("button", { name: /Tải ảnh QR/ }));

    expect(created).toHaveLength(1);
    expect(created[0].download).toBe("QR-TRC-000015-RAUMU.png");
    expect(created[0].getAttribute("href")).toBe("data:image/png;base64,AAAA");
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("prints a label carrying product name, lot code, trace code and the QR image", async () => {
    const dialog = await openQrModal();
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");

    await userEvent.click(within(dialog).getByRole("button", { name: /In tem QR/ }));

    expect(printHtmlDocument).toHaveBeenCalledTimes(1);
    const html = printHtmlDocument.mock.calls[0][0] as string;
    expect(html).toContain("Rau muống hạt");
    expect(html).toContain("LOT-20260930-0015");
    expect(html).toContain("TRC-000015-RAUMU");
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });
});
