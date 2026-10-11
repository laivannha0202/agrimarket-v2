import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InfoDescriptions, formatAddress } from "@/components/common/InfoDescriptions";
import { takeAntdWarnings } from "./setup";

/**
 * The admin detail blocks must lay out without antd complaining.
 *
 * WHY
 *
 * `apps/admin-web/src/app/(admin)/orders/[id]` rendered "Thông tin chung" with
 * SEVEN items at `column={2}` and two of them marked `span: 2` — 9 units over 4
 * rows, so the last row held a single cell. antd renders that as a broken grid:
 * every label and value wrapped to one character per line (the screenshot showed
 * "M ã đ ơ n" running vertically down the page) and it logged
 *
 *   Warning: [antd: Descriptions] Sum of column `span` in a line not match
 *   `column` of Descriptions.
 *
 * The values were all correct, so this was purely a layout defect an admin would
 * read as a broken page. `InfoDescriptions` now pads the final row itself, and
 * these tests pin that: the warning must not come back, and the real call shapes
 * must render their values readably.
 *
 * `setup.ts` captures antd warnings and fails a test that lets one through, so
 * `takeAntdWarnings()` is the assertion mechanism here.
 */
describe("InfoDescriptions", () => {
  it("pads a row whose spans do not fill the column count", () => {
    // The exact shape from the order page: 7 items, spans [2,2] at column 2.
    render(
      <InfoDescriptions
        items={[
          { key: "code", label: "Mã đơn", children: "ORD-20261011-0007" },
          { key: "customer", label: "Khách hàng", children: "Nguyễn Thị Lan" },
          { key: "phone", label: "Số điện thoại", children: "0912345601" },
          { key: "created", label: "Ngày tạo", children: "11/10/2026 07:31" },
          { key: "shipTo", label: "Người nhận", children: "Nguyễn Thị Lan — 0912345601" },
          { key: "shipAddr", label: "Địa chỉ giao", span: 2, children: "Số 88, đường Nguyễn Văn Linh" },
          { key: "note", label: "Ghi chú", span: 2, children: "—" },
        ]}
      />,
    );

    expect(takeAntdWarnings()).toEqual([]);
    expect(screen.getByText("ORD-20261011-0007")).toBeInTheDocument();
    expect(screen.getByText("Số 88, đường Nguyễn Văn Linh")).toBeInTheDocument();
  });

  it("pads a three-item block at column 2 (partners page shape)", () => {
    render(
      <InfoDescriptions
        items={[
          { key: "a", label: "Một", children: "1" },
          { key: "b", label: "Hai", children: "2" },
          { key: "c", label: "Ba", children: "3" },
        ]}
      />,
    );

    expect(takeAntdWarnings()).toEqual([]);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("leaves an already-complete grid untouched", () => {
    render(
      <InfoDescriptions
        items={[
          { key: "subtotal", label: "Tạm tính", children: "360.000 ₫" },
          { key: "discount", label: "Giảm giá", children: "50.000 ₫" },
          { key: "shipping", label: "Phí giao hàng", children: "20.000 ₫" },
          { key: "grand", label: "Tổng thanh toán", children: "330.000 ₫" },
        ]}
      />,
    );

    expect(takeAntdWarnings()).toEqual([]);
    expect(screen.getByText("330.000 ₫")).toBeInTheDocument();
  });

  it("handles column={3} (the partner-order block)", () => {
    render(
      <InfoDescriptions
        column={3}
        items={[
          { key: "code", label: "Mã đơn đối tác", children: "ORD-20261011-0007-P01" },
          { key: "subtotal", label: "Tạm tính", children: "360.000 ₫" },
          { key: "commission", label: "Hoa hồng", children: "18.000 ₫" },
          { key: "payable", label: "Phải trả đối tác", children: "342.000 ₫" },
        ]}
      />,
    );

    expect(takeAntdWarnings()).toEqual([]);
    expect(screen.getByText("342.000 ₫")).toBeInTheDocument();
  });

  it("renders a single item without a filler cell", () => {
    render(<InfoDescriptions items={[{ key: "only", label: "Chỉ một", children: "giá trị" }]} />);
    expect(takeAntdWarnings()).toEqual([]);
    expect(screen.getByText("giá trị")).toBeInTheDocument();
  });

  it("renders nothing for an empty list", () => {
    render(<InfoDescriptions items={[]} />);
    expect(takeAntdWarnings()).toEqual([]);
  });
});

describe("formatAddress", () => {
  it("prefers the catalogue ward name and omits a stale district", () => {
    // A code-verified address: `wardName` comes from the backend catalogue, and
    // the 2025 model has no district, so an old `district` text must not appear.
    expect(
      formatAddress({
        detail: "Số 88",
        wardName: "Xã Tân Quang",
        district: "Huyện Văn Lâm",
        province: "Hưng Yên",
      }),
    ).toBe("Số 88, Xã Tân Quang, Hưng Yên");
  });

  it("keeps the legacy free text when there is no catalogue ward", () => {
    expect(
      formatAddress({
        detail: "Số 88",
        ward: "Tân Quang",
        district: "Văn Lâm",
        province: "Hưng Yên",
      }),
    ).toBe("Số 88, Tân Quang, Văn Lâm, Hưng Yên");
  });

  it("skips empty parts", () => {
    expect(formatAddress({ detail: "Số 88", province: "Hưng Yên", district: null })).toBe("Số 88, Hưng Yên");
    expect(formatAddress({})).toBe("");
  });
});
