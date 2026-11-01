import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./utils";
import { takeAntdWarnings } from "./setup";
import type { ReconciliationReport } from "@/types/api";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/reconciliation",
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

const resourcesMock = vi.hoisted(() => ({
  reconciliation: vi.fn(),
}));

vi.mock("@/lib/api/resources", () => ({ resources: resourcesMock }));

import ReconciliationPage from "@/app/(admin)/reconciliation/page";

const REPORT: ReconciliationReport = {
  generatedAt: "2026-11-01T10:00:00.000Z",
  range: { from: null, to: null },
  scanned: 12,
  truncated: false,
  scanLimit: 2000,
  summary: {
    ordersWithFindings: 3,
    byIssue: {
      UNDER_COLLECTED: 1,
      OVER_COLLECTED: 1,
      SETTLED_WITHOUT_FULL_COLLECTION: 1,
      REFUND_WITHOUT_COLLECTION: 0,
      REFUND_STATUS_MISMATCH: 0,
      MISSING_COLLECTION_EVIDENCE: 1,
    },
    byCollection: { NONE: 2, PARTIAL: 1, FULL: 8, OVER: 1 },
    totals: { obligation: 1200000, collected: 900000, refunded: 50000, outstanding: 300000 },
  },
  findings: [
    {
      orderId: 501,
      code: "ORD-2026-0501",
      status: "DELIVERED",
      createdAt: "2026-10-28T03:00:00.000Z",
      obligation: 200000,
      collected: 120000,
      refunded: 0,
      outstanding: 80000,
      collection: "PARTIAL",
      paymentStatuses: ["PAID"],
      refundState: "NONE",
      settled: true,
      settlements: [{ id: 77, code: "STL-2026-10", status: "CONFIRMED" }],
      issues: ["UNDER_COLLECTED", "SETTLED_WITHOUT_FULL_COLLECTION"],
    },
    {
      orderId: 502,
      code: "ORD-2026-0502",
      status: "DELIVERED",
      createdAt: "2026-10-29T03:00:00.000Z",
      obligation: 150000,
      collected: 180000,
      refunded: 0,
      outstanding: -30000,
      collection: "OVER",
      paymentStatuses: ["PAID"],
      refundState: "NONE",
      settled: false,
      settlements: [],
      issues: ["OVER_COLLECTED"],
    },
    {
      orderId: 503,
      code: "ORD-2026-0503",
      status: "SHIPPING",
      createdAt: "2026-10-30T03:00:00.000Z",
      obligation: 100000,
      collected: 0,
      refunded: 0,
      outstanding: 100000,
      collection: "NONE",
      paymentStatuses: ["PAID"],
      refundState: "NONE",
      settled: false,
      settlements: [],
      issues: ["MISSING_COLLECTION_EVIDENCE"],
    },
  ],
  meta: { page: 1, limit: 20, total: 3, totalPages: 1 },
  note: "Read-only. Nothing here rewrites payments, refunds or settlements.",
};

beforeEach(() => {
  resourcesMock.reconciliation.mockReset();
  resourcesMock.reconciliation.mockResolvedValue(REPORT);
});

describe("Admin — đối chiếu dòng tiền", () => {
  it("renders the period summary and every finding from the API", async () => {
    renderWithProviders(<ReconciliationPage />);

    await screen.findByText("ORD-2026-0501");

    // KPI values come from the report, not from adding rows in the browser.
    expect(screen.getByText("Đơn đã quét").parentElement).toHaveTextContent("12");
    expect(screen.getByText("Đơn có chênh lệch").parentElement).toHaveTextContent("3");
    expect(screen.getByText("Không phát hiện chênh lệch").parentElement).toHaveTextContent("9");
    expect(screen.getByText("Còn phải thu").parentElement).toHaveTextContent("300.000 ₫");

    // Each row shows the money states the API classified.
    const under = screen.getByText("ORD-2026-0501").closest("tr") as HTMLElement;
    expect(within(under).getByText("Thu một phần")).toBeInTheDocument();
    expect(within(under).getByText("Thu thiếu")).toBeInTheDocument();
    expect(within(under).getByText("Đã quyết toán khi chưa thu đủ")).toBeInTheDocument();
    expect(within(under).getByText("STL-2026-10")).toBeInTheDocument();

    const over = screen.getByText("ORD-2026-0502").closest("tr") as HTMLElement;
    // Both the money state and the issue label say "Thu vượt" on this row.
    expect(within(over).getAllByText("Thu vượt")).toHaveLength(2);
    expect(within(over).getByText("Chưa quyết toán")).toBeInTheDocument();

    const evidence = screen.getByText("ORD-2026-0503").closest("tr") as HTMLElement;
    expect(within(evidence).getByText("Thiếu bằng chứng thu tiền")).toBeInTheDocument();

    // The code opens the order; the settlement code opens the settlement.
    expect(screen.getByRole("link", { name: "ORD-2026-0501" })).toHaveAttribute(
      "href",
      "/orders/501",
    );
    expect(screen.getByRole("link", { name: "STL-2026-10" })).toHaveAttribute(
      "href",
      "/settlements/77",
    );

    expect(takeAntdWarnings()).toEqual([]);
  });

  it("explains the reason for each finding when the row is expanded", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReconciliationPage />);

    await screen.findByText("ORD-2026-0501");
    const row = screen.getByText("ORD-2026-0501").closest("tr") as HTMLElement;
    const expand = row.querySelector(".ant-table-row-expand-icon") as HTMLElement;
    await user.click(expand);

    expect(await screen.findByText("Nguyên nhân")).toBeInTheDocument();
    expect(
      screen.getByText(/Số tiền đã thu nhỏ hơn tổng phải thu/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Đơn đã có dòng quyết toán nhưng chưa thu đủ tiền/)).toBeInTheDocument();
    expect(screen.getByText("Mở chi tiết đơn")).toHaveAttribute("href", "/orders/501");
    expect(screen.getByText("Mở tab thanh toán")).toHaveAttribute(
      "href",
      "/orders/501?tab=payment",
    );
  });

  it("asks the API for fully collected orders, including rows without findings", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReconciliationPage />);

    await screen.findByText("ORD-2026-0501");
    await user.click(screen.getByText("Đã thu đủ (8)"));

    await waitFor(() => {
      expect(resourcesMock.reconciliation).toHaveBeenLastCalledWith(
        expect.objectContaining({ collection: "FULL", includeMatched: "true", page: 1 }),
      );
    });
  });

  it("sends the selected issue and order status as filters", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReconciliationPage />);

    await screen.findByText("ORD-2026-0501");
    await user.click(screen.getByText("Thu thiếu (1)"));

    await waitFor(() => {
      expect(resourcesMock.reconciliation).toHaveBeenLastCalledWith(
        expect.objectContaining({ issue: "UNDER_COLLECTED", page: 1 }),
      );
    });
  });

  it("shows an empty state when nothing matches", async () => {
    resourcesMock.reconciliation.mockResolvedValue({
      ...REPORT,
      findings: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      summary: { ...REPORT.summary, ordersWithFindings: 0 },
    });

    renderWithProviders(<ReconciliationPage />);

    expect(
      await screen.findByText("Không có đơn nào khớp bộ lọc đối chiếu"),
    ).toBeInTheDocument();
  });

  it("shows the API error and retries on demand", async () => {
    const user = userEvent.setup();
    resourcesMock.reconciliation.mockRejectedValue(new Error("Mất kết nối"));

    renderWithProviders(<ReconciliationPage />);

    expect(await screen.findByText("Không tải được dữ liệu")).toBeInTheDocument();
    expect(screen.getByText("Không tải được báo cáo đối chiếu.")).toBeInTheDocument();

    resourcesMock.reconciliation.mockResolvedValue(REPORT);
    await user.click(screen.getByRole("button", { name: "Thử lại" }));

    expect(await screen.findByText("ORD-2026-0501")).toBeInTheDocument();
  });

  it("states that the screen never adjusts money", async () => {
    renderWithProviders(<ReconciliationPage />);

    expect(
      await screen.findByText("Chỉ đọc — không điều chỉnh tiền tại đây"),
    ).toBeInTheDocument();
    // No button on this page writes money.
    expect(screen.queryByRole("button", { name: /điều chỉnh|sửa|tạo/i })).toBeNull();
  });
});
