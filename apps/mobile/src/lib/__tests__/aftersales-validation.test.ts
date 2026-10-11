import { describe, expect, it } from "vitest";
import {
  mapAfterSalesFieldErrors,
  validateComplaintForm,
  validateReturnForm,
  validateReviewForm,
} from "../aftersales-validation";

describe("validateReturnForm (mirrors POST /returns)", () => {
  it("requires a product, a positive quantity within cap, and a reason", () => {
    expect(
      validateReturnForm({ hasProduct: false, quantityText: "1", maxQuantity: 2, reason: "Hỏng" }),
    ).toEqual({ product: "Vui lòng chọn sản phẩm cần trả." });
    expect(
      validateReturnForm({ hasProduct: true, quantityText: "0", maxQuantity: 2, reason: "Hỏng" }),
    ).toEqual({ quantity: "Số lượng trả phải lớn hơn 0." });
    expect(
      validateReturnForm({ hasProduct: true, quantityText: "5", maxQuantity: 2, reason: "Hỏng" }),
    ).toEqual({ quantity: expect.stringContaining("tối đa 2") });
    expect(
      validateReturnForm({ hasProduct: true, quantityText: "1", maxQuantity: 2, reason: "   " }),
    ).toEqual({ reason: "Vui lòng nhập lý do trả hàng." });
  });

  it("passes a valid form", () => {
    expect(
      validateReturnForm({ hasProduct: true, quantityText: "1", maxQuantity: 2, reason: "Hỏng" }),
    ).toEqual({});
  });
});

describe("validateComplaintForm (mirrors POST /complaints)", () => {
  it("requires an order, a type and content", () => {
    expect(validateComplaintForm({ hasOrder: false, content: "x", hasType: true })).toEqual({
      order: "Vui lòng chọn đơn hàng cần khiếu nại.",
    });
    expect(validateComplaintForm({ hasOrder: true, content: "  ", hasType: true })).toEqual({
      content: "Vui lòng mô tả vấn đề bạn gặp phải.",
    });
    expect(validateComplaintForm({ hasOrder: true, content: "x", hasType: false })).toEqual({
      type: "Vui lòng chọn loại khiếu nại.",
    });
  });

  it("passes a valid form", () => {
    expect(validateComplaintForm({ hasOrder: true, content: "Hỏng", hasType: true })).toEqual({});
  });
});

describe("validateReviewForm (mirrors POST /reviews)", () => {
  it("requires a product and a rating 1..5", () => {
    expect(validateReviewForm({ hasProduct: false, rating: 5 })).toEqual({
      product: "Vui lòng chọn sản phẩm cần đánh giá.",
    });
    expect(validateReviewForm({ hasProduct: true, rating: 0 })).toEqual({
      rating: "Vui lòng chọn số sao từ 1 đến 5.",
    });
  });

  it("passes a valid form", () => {
    expect(validateReviewForm({ hasProduct: true, rating: 4 })).toEqual({});
  });
});

describe("mapAfterSalesFieldErrors (backend → field)", () => {
  it("maps business sentences to their field", () => {
    expect(
      mapAfterSalesFieldErrors(["Chỉ đơn hàng đã giao mới được yêu cầu trả hàng."]).fields.product,
    ).toContain("đã giao");
    expect(
      mapAfterSalesFieldErrors(["You can return at most 1 of this item"]).fields.quantity,
    ).toContain("còn có thể trả");
    expect(
      mapAfterSalesFieldErrors([
        "Ảnh đính kèm không hợp lệ hoặc đã thuộc yêu cầu khác. Vui lòng tải lại ảnh.",
      ]).fields.evidence,
    ).toContain("thuộc yêu cầu khác");
  });

  it("maps DTO property prefixes without leaking English text", () => {
    const { fields } = mapAfterSalesFieldErrors(["quantity must not be less than 0.001"]);
    expect(fields.quantity).toBe("Số lượng chưa hợp lệ.");
  });

  it("keeps unknown text as a form-level error", () => {
    const { fields, formError } = mapAfterSalesFieldErrors(["something unexpected happened"]);
    expect(fields).toEqual({});
    expect(formError).toBe("something unexpected happened");
  });

  it("handles undefined", () => {
    expect(mapAfterSalesFieldErrors(undefined)).toEqual({ fields: {}, formError: null });
  });
});
