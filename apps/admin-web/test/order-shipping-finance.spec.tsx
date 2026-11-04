import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./utils";
import { takeAntdWarnings } from "./setup";
import type { Order } from "@/types/api";

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/1",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { OrderShippingTab } from "@/components/orders/detail-tabs/OrderShippingTab";
import { OrderFinanceTab } from "@/components/orders/detail-tabs/OrderFinanceTab";

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    code: "ORD-TEST",
    customerId: 1,
    shippingAddressSnapshot: { recipientName: "A", phone: "0", province: "P", detail: "D" },
    subtotal: "100000",
    discountTotal: "0",
    shippingFee: "0",
    grandTotal: "100000",
    status: "DELIVERED",
    note: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    partnerOrders: [
      {
        id: 10,
        code: "PO-1",
        orderId: 1,
        partnerId: 2,
        subtotal: "64000",
        discountTotal: "0",
        commissionAmount: "3200",
        payableAmount: "60800",
        status: "DELIVERED",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        partner: { id: 2, name: "HTX Minh Châu" },
        shipments: [],
      },
    ],
    ...overrides,
  };
}

describe("Order shipping/finance tabs", () => {
  beforeEach(() => takeAntdWarnings());

  it("shows mismatch alert when order delivered but shipment in transit", () => {
    const order = baseOrder({
      partnerOrders: [
        {
          id: 10,
          code: "PO-1",
          orderId: 1,
          partnerId: 2,
          subtotal: "64000",
          discountTotal: "0",
          commissionAmount: "3200",
          payableAmount: "60800",
          status: "DELIVERED",
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
          partner: { id: 2, name: "HTX Minh Châu" },
          shipments: [
            {
              id: 100,
              code: "SH-1",
              partnerOrderId: 10,
              carrier: "GHN",
              trackingCode: "TRK1",
              status: "IN_TRANSIT",
              failureReason: null,
              shippedAt: "2026-10-01T01:00:00.000Z",
              deliveredAt: null,
              createdAt: "2026-10-01T00:00:00.000Z",
              updatedAt: "2026-10-01T00:00:00.000Z",
              events: [],
            },
            {
              id: 101,
              code: "SH-2",
              partnerOrderId: 10,
              carrier: "GHN",
              trackingCode: "TRK2",
              status: "IN_TRANSIT",
              failureReason: null,
              shippedAt: "2026-10-01T01:00:00.000Z",
              deliveredAt: null,
              createdAt: "2026-10-01T00:00:00.000Z",
              updatedAt: "2026-10-01T00:00:00.000Z",
              events: [],
            },
          ],
        },
      ],
    });
    renderWithProviders(<OrderShippingTab order={order} />);
    expect(screen.getByText(/Trạng thái đơn và vận đơn chưa khớp\./)).toBeInTheDocument();
    expect(screen.getByText(/Cần đối chiếu/)).toBeInTheDocument();
    expect(screen.getAllByText("Chưa giao").length).toBeGreaterThan(0);
  });

  it("shows missing delivery time for delivered shipment without deliveredAt", () => {
    const order = baseOrder({
      status: "DELIVERED",
      partnerOrders: [
        {
          id: 10,
          code: "PO-1",
          orderId: 1,
          partnerId: 2,
          subtotal: "64000",
          discountTotal: "0",
          commissionAmount: "3200",
          payableAmount: "60800",
          status: "DELIVERED",
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
          partner: { id: 2, name: "HTX Minh Châu" },
          shipments: [
            {
              id: 100,
              code: "SH-1",
              partnerOrderId: 10,
              carrier: "GHN",
              trackingCode: "TRK1",
              status: "DELIVERED",
              failureReason: null,
              shippedAt: "2026-10-01T01:00:00.000Z",
              deliveredAt: null,
              createdAt: "2026-10-01T00:00:00.000Z",
              updatedAt: "2026-10-01T00:00:00.000Z",
              events: [],
            },
          ],
        },
      ],
    });
    renderWithProviders(<OrderShippingTab order={order} />);
    expect(screen.getByText("Thiếu thời điểm giao")).toBeInTheDocument();
    expect(screen.queryByText(/Trạng thái đơn và vận đơn chưa khớp/)).not.toBeInTheDocument();
  });

  it("does not show mismatch alert for normal delivered order", () => {
    const order = baseOrder({
      partnerOrders: [
        {
          id: 10,
          code: "PO-1",
          orderId: 1,
          partnerId: 2,
          subtotal: "64000",
          discountTotal: "0",
          commissionAmount: "3200",
          payableAmount: "60800",
          status: "DELIVERED",
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
          partner: { id: 2, name: "HTX Minh Châu" },
          shipments: [
            {
              id: 100,
              code: "SH-1",
              partnerOrderId: 10,
              carrier: "GHN",
              trackingCode: "TRK1",
              status: "DELIVERED",
              failureReason: null,
              shippedAt: "2026-10-01T01:00:00.000Z",
              deliveredAt: "2026-10-01T02:00:00.000Z",
              createdAt: "2026-10-01T00:00:00.000Z",
              updatedAt: "2026-10-01T00:00:00.000Z",
              events: [],
            },
          ],
        },
      ],
    });
    renderWithProviders(<OrderShippingTab order={order} />);
    expect(screen.queryByText(/Trạng thái đơn và vận đơn chưa khớp/)).not.toBeInTheDocument();
  });

  it("finance tab distinguishes order amount from period payout", async () => {
    const order = baseOrder({
      partnerOrders: [
        {
          id: 10,
          code: "PO-1",
          orderId: 1,
          partnerId: 2,
          subtotal: "64000",
          discountTotal: "0",
          commissionAmount: "3200",
          payableAmount: "60800",
          status: "DELIVERED",
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
          partner: { id: 2, name: "HTX Minh Châu" },
          settlementLines: [
            {
              id: 1,
              settlementId: 9,
              partnerOrderId: 10,
              grossAmount: "64000",
              refundAmount: "0",
              commissionAmount: "3200",
              payableAmount: "60800",
              settlement: {
                id: 9,
                code: "STL-9",
                status: "CONFIRMED",
                payableAmount: "247000",
                refundAmount: "0",
                adjustmentAmount: "0",
                confirmedAt: "2026-10-02T00:00:00.000Z",
                payouts: [],
              },
            },
          ],
          settlementAdjustments: [],
        },
      ],
    });
    renderWithProviders(<OrderFinanceTab order={order} />);
    // collapsed by default; open it
    await userEvent.click(screen.getByText(/Chi tiết quyết toán/));
    expect(screen.getAllByText(/60\.800/).length).toBeGreaterThan(0);
    expect(screen.getByText(/247\.000/)).toBeInTheDocument();
    expect(screen.getByText(/Các lệnh chi trả thuộc cả kỳ quyết toán/)).toBeInTheDocument();
  });

  it("shows no settlement state compactly", () => {
    const order = baseOrder();
    renderWithProviders(<OrderFinanceTab order={order} />);
    expect(screen.getByText("Chưa có kỳ quyết toán.")).toBeInTheDocument();
  });
});
