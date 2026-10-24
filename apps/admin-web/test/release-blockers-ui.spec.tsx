import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./utils";
import { takeAntdWarnings } from "./setup";
import type {
  Complaint,
  Paginated,
  ReturnRequest,
  SettlementAdjustment,
} from "@/types/api";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/returns-complaints",
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
  returns: vi.fn(),
  eligibleRefunds: vi.fn(),
  updateReturn: vi.fn(),
  complaints: vi.fn(),
  updateComplaint: vi.fn(),
  settlements: vi.fn(),
  partners: vi.fn(),
  settlementAdjustments: vi.fn(),
  reviewSettlementAdjustment: vi.fn(),
}));

vi.mock("@/lib/api/resources", () => ({ resources: resourcesMock }));

import ReturnsComplaintsPage from "@/app/(admin)/returns-complaints/page";
import SettlementsPage from "@/app/(admin)/settlements/page";

const paginated = <T,>(data: T[]): Paginated<T> => ({
  data,
  meta: { page: 1, limit: 20, total: data.length, totalPages: 1 },
});

const RETURN_ROW: ReturnRequest = {
  id: 31,
  orderId: 101,
  orderItemId: 201,
  customerId: 7,
  quantity: "2",
  reason: "Hàng bị dập",
  status: "QC_PENDING",
  refundId: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-02T09:00:00.000Z",
  order: { id: 101, code: "ORD-0101" },
  refund: null,
  evidence: [],
};

const COMPLAINT_ROW: Complaint = {
  id: 41,
  customerId: 7,
  orderId: 101,
  orderItemId: 201,
  type: "PRODUCT_QUALITY",
  content: "Rau bị héo khi nhận",
  status: "OPEN",
  resolution: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-02T09:00:00.000Z",
  resolvedAt: null,
  order: { id: 101, code: "ORD-0101" },
  customer: { id: 7, fullName: "Nguyễn Văn A", email: "a@example.test" },
  evidence: [],
};

const ADJUSTMENT_ROW: SettlementAdjustment = {
  id: 51,
  partnerId: 9,
  settlementId: 61,
  partnerOrderId: 71,
  refundId: 81,
  amount: "-80000",
  type: "REFUND_AFTER_SETTLEMENT",
  status: "OPEN",
  resolution: null,
  reason: "Hoàn tiền sau khi kỳ đối soát đã chốt",
  resolutionNote: null,
  createdByUserId: 1,
  reviewedByUserId: null,
  reviewedAt: null,
  createdAt: "2026-10-03T09:00:00.000Z",
  updatedAt: "2026-10-03T09:00:00.000Z",
  partner: { id: 9, code: "PT-0001", name: "HTX Minh Châu" },
  settlement: { id: 61, code: "STL-0061", status: "CONFIRMED" },
  partnerOrder: { id: 71, code: "PO-0071" },
  refund: {
    id: 81,
    amount: "80000",
    status: "COMPLETED",
    completedAt: "2026-10-02T09:00:00.000Z",
  },
};

function modalByTitle(title: string): HTMLElement {
  return screen.getByText(title, { selector: ".ant-modal-title" }).closest(".ant-modal") as HTMLElement;
}

async function chooseSelectOption(
  dialog: HTMLElement,
  label: string,
  option: string | RegExp,
): Promise<void> {
  const select = within(dialog).getByLabelText(label);
  await userEvent.click(select);
  const item = await screen.findByText(option, {
    selector: ".ant-select-item-option-content",
  });
  await userEvent.click(item);
}

beforeEach(() => {
  resourcesMock.returns.mockReset().mockResolvedValue(paginated<ReturnRequest>([]));
  resourcesMock.eligibleRefunds.mockReset().mockResolvedValue({
    returnRequestId: 31,
    returnValue: "100000",
    data: [
      {
        id: 77,
        paymentId: 55,
        amount: "80000",
        reference: "REF-77",
        completedAt: "2026-10-02T09:00:00.000Z",
        payment: { method: "COD", status: "PARTIALLY_REFUNDED" },
        returnRequest: null,
        linkedToThisReturn: false,
      },
    ],
  });
  resourcesMock.updateReturn.mockReset().mockResolvedValue(RETURN_ROW);
  resourcesMock.complaints.mockReset().mockResolvedValue(paginated<Complaint>([]));
  resourcesMock.updateComplaint.mockReset().mockResolvedValue(COMPLAINT_ROW);
  resourcesMock.settlements.mockReset().mockResolvedValue(paginated([]));
  resourcesMock.partners.mockReset().mockResolvedValue(paginated([]));
  resourcesMock.settlementAdjustments
    .mockReset()
    .mockResolvedValue(paginated([ADJUSTMENT_ROW]));
  resourcesMock.reviewSettlementAdjustment.mockReset().mockResolvedValue({});
  takeAntdWarnings();
});

describe("C-06 return dialog (eligible refund dropdown)", () => {
  it("loads refunds for the return and submits the selected id", async () => {
    resourcesMock.returns.mockResolvedValue(paginated([RETURN_ROW]));

    renderWithProviders(<ReturnsComplaintsPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Xử lý" }));
    const dialog = modalByTitle("Xử lý yêu cầu trả hàng");

    await chooseSelectOption(dialog, "Trạng thái mới", "Hoàn tiền");

    await waitFor(() => expect(resourcesMock.eligibleRefunds).toHaveBeenCalledWith(31));
    await waitFor(() =>
      expect(within(dialog).getByText(/Chỉ hiện giao dịch COMPLETED/)).toBeInTheDocument(),
    );

    await chooseSelectOption(dialog, "Giao dịch hoàn tiền", /80\.000/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Xác nhận" }));

    await waitFor(() =>
      expect(resourcesMock.updateReturn).toHaveBeenCalledWith(31, {
        status: "REFUNDED",
        refundId: 77,
      }),
    );
    expect(takeAntdWarnings()).toEqual([]);
  });

  it("tells the operator to complete a refund when no eligible transaction exists", async () => {
    resourcesMock.returns.mockResolvedValue(paginated([RETURN_ROW]));
    resourcesMock.eligibleRefunds.mockResolvedValue({
      returnRequestId: 31,
      returnValue: "100000",
      data: [],
    });

    renderWithProviders(<ReturnsComplaintsPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Xử lý" }));
    const dialog = modalByTitle("Xử lý yêu cầu trả hàng");
    await chooseSelectOption(dialog, "Trạng thái mới", "Hoàn tiền");

    await waitFor(() =>
      expect(
        within(dialog).getByText(/Chưa có giao dịch hoàn tiền COMPLETED hợp lệ/),
      ).toBeInTheDocument(),
    );
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(takeAntdWarnings()).toEqual([]);
  });
});

describe("C-15 complaint dialog (resolution required for terminal states)", () => {
  it("blocks REJECTED without a resolution, then submits it", async () => {
    resourcesMock.complaints.mockResolvedValue(paginated([COMPLAINT_ROW]));

    renderWithProviders(<ReturnsComplaintsPage />);
    await userEvent.click(screen.getByRole("tab", { name: "Khiếu nại" }));
    await userEvent.click(await screen.findByRole("button", { name: "Xử lý" }));
    const dialog = modalByTitle("Xử lý khiếu nại");

    await chooseSelectOption(dialog, "Trạng thái mới", "Từ chối");

    await waitFor(() =>
      expect(within(dialog).getByLabelText("Hướng giải quyết")).toBeInTheDocument(),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Xác nhận" }));

    await waitFor(() =>
      expect(within(dialog).getByText("Nhập hướng giải quyết.")).toBeInTheDocument(),
    );
    expect(resourcesMock.updateComplaint).not.toHaveBeenCalled();

    await userEvent.type(
      within(dialog).getByLabelText("Hướng giải quyết"),
      "Đã xác minh với khách, từ chối hoàn tiền.",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Xác nhận" }));

    await waitFor(() =>
      expect(resourcesMock.updateComplaint).toHaveBeenCalledWith(41, {
        status: "REJECTED",
        resolution: "Đã xác minh với khách, từ chối hoàn tiền.",
      }),
    );
    expect(takeAntdWarnings()).toEqual([]);
  });
});

describe("C-08 settlement adjustment review", () => {
  it("records a resolution and note without editing the original settlement", async () => {
    renderWithProviders(<SettlementsPage />);
    await userEvent.click(screen.getByRole("tab", { name: "Điều chỉnh đối soát" }));

    await waitFor(() =>
      expect(resourcesMock.settlementAdjustments).toHaveBeenCalled(),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Xử lý" }));
    const dialog = modalByTitle("Xử lý điều chỉnh đối soát");

    expect(within(dialog).getByText("HTX Minh Châu")).toBeInTheDocument();
    expect(within(dialog).getByText(/Kỳ đối soát gốc không bị sửa/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Ghi nhận" }));
    await waitFor(() =>
      expect(within(dialog).getByText("Chọn hướng xử lý.")).toBeInTheDocument(),
    );
    expect(within(dialog).getByText("Nhập căn cứ xử lý.")).toBeInTheDocument();
    expect(resourcesMock.reviewSettlementAdjustment).not.toHaveBeenCalled();

    await chooseSelectOption(dialog, "Hướng xử lý", "Trừ vào kỳ sau");
    await userEvent.type(
      within(dialog).getByLabelText("Căn cứ / ghi chú"),
      "Trừ vào kỳ kế tiếp theo xác nhận của kế toán.",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Ghi nhận" }));

    await waitFor(() =>
      expect(resourcesMock.reviewSettlementAdjustment).toHaveBeenCalledWith(51, {
        resolution: "DEDUCT_NEXT",
        note: "Trừ vào kỳ kế tiếp theo xác nhận của kế toán.",
      }),
    );
    expect(takeAntdWarnings()).toEqual([]);
  });
});
