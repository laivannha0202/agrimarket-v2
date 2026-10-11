import { describe, expect, it } from "vitest";
import {
  firstInvalidField,
  isValidVietnamesePhone,
  mapRegisterFieldErrors,
  normalizeVietnamesePhone,
  validateConfirmPassword,
  validateEmail,
  validateFullName,
  validatePassword,
  validatePhone,
  validateRegisterForm,
} from "../validation";

/**
 * These lock the client rules to the backend `RegisterDto` / `phone.util.ts`.
 *
 * The regression this guards against is the reported bug: the old mobile form
 * only checked a field was non-empty, so a one-character name was SENT and the
 * server answered with a generic "dữ liệu chưa hợp lệ". The client must now
 * catch it with its own field message BEFORE any request, and the backend's own
 * validation message must still map back onto the right field when it arrives.
 */

const VALID = {
  fullName: "Trần Văn An",
  email: "khach@example.com",
  phone: "0912345678",
  password: "MatKhau@12345",
  confirmPassword: "MatKhau@12345",
};

describe("fullName", () => {
  it("rejects a one-character name (the reported bug)", () => {
    expect(validateFullName("A")).toBe("Vui lòng nhập họ tên từ 2 ký tự.");
  });

  it("rejects an empty / whitespace-only name", () => {
    expect(validateFullName("")).toBe("Vui lòng nhập họ tên từ 2 ký tự.");
    expect(validateFullName("   ")).toBe("Vui lòng nhập họ tên từ 2 ký tự.");
  });

  it("accepts a name of exactly 2 characters after trim", () => {
    expect(validateFullName("  An  ")).toBeNull();
  });

  it("rejects a name longer than the backend max", () => {
    expect(validateFullName("a".repeat(121))).toContain("tối đa");
  });
});

describe("email", () => {
  it("rejects a malformed address", () => {
    expect(validateEmail("khach")).toBe("Email chưa hợp lệ.");
    expect(validateEmail("khach@")).toBe("Email chưa hợp lệ.");
    expect(validateEmail("khach@example")).toBe("Email chưa hợp lệ.");
    expect(validateEmail("a b@example.com")).toBe("Email chưa hợp lệ.");
  });

  it("accepts a normal address (case preserved for display)", () => {
    expect(validateEmail("Khach@Example.com")).toBeNull();
  });
});

describe("phone (Vietnamese mobile, mirrors the backend)", () => {
  it("accepts every form the backend normalises", () => {
    expect(normalizeVietnamesePhone("0912345678")).toBe("0912345678");
    expect(normalizeVietnamesePhone("091 234 5678")).toBe("0912345678");
    expect(normalizeVietnamesePhone("+84912345678")).toBe("0912345678");
    expect(normalizeVietnamesePhone("84912345678")).toBe("0912345678");
    expect(validatePhone("0912345678")).toBeNull();
  });

  it("rejects wrong length, bad prefix and stray characters", () => {
    expect(validatePhone("123")).toBe("Số điện thoại chưa hợp lệ.");
    expect(validatePhone("0123456789")).toBe("Số điện thoại chưa hợp lệ."); // prefix 1
    expect(validatePhone("09123456789")).toBe("Số điện thoại chưa hợp lệ."); // 11 digits
    expect(isValidVietnamesePhone("")).toBe(false);
  });
});

describe("password", () => {
  it("rejects a password shorter than 10 characters", () => {
    expect(validatePassword("Ab@1")).toContain("ít nhất 10 ký tự");
  });

  it("rejects a password with no digit", () => {
    expect(validatePassword("MatKhauKhongSo")).toContain("gồm chữ và số");
  });

  it("rejects a password with no letter", () => {
    expect(validatePassword("1234567890")).toContain("gồm chữ và số");
  });

  it("rejects a password longer than 72 characters", () => {
    expect(validatePassword(`Aa1${"x".repeat(80)}`)).toContain("tối đa");
  });

  it("accepts a compliant password", () => {
    expect(validatePassword("MatKhau@12345")).toBeNull();
  });
});

describe("confirmPassword", () => {
  it("rejects a mismatch", () => {
    expect(validateConfirmPassword("MatKhau@12345", "MatKhau@1234")).toBe("Mật khẩu nhập lại không khớp.");
  });

  it("rejects an empty confirmation", () => {
    expect(validateConfirmPassword("MatKhau@12345", "")).toBe("Vui lòng nhập lại mật khẩu.");
  });

  it("accepts a match", () => {
    expect(validateConfirmPassword("MatKhau@12345", "MatKhau@12345")).toBeNull();
  });
});

describe("validateRegisterForm", () => {
  it("passes a fully valid form", () => {
    expect(validateRegisterForm(VALID)).toEqual({});
  });

  it("reports every bad field at once", () => {
    const errors = validateRegisterForm({
      fullName: "A",
      email: "nope",
      phone: "123",
      password: "short",
      confirmPassword: "different",
    });
    expect(Object.keys(errors).sort()).toEqual(
      ["confirmPassword", "email", "fullName", "password", "phone"].sort(),
    );
  });
});

describe("firstInvalidField", () => {
  it("returns the first field in visual order", () => {
    expect(firstInvalidField({ phone: "x", fullName: "y" })).toBe("fullName");
  });

  it("returns null when there is no error", () => {
    expect(firstInvalidField({})).toBeNull();
  });
});

describe("mapRegisterFieldErrors (backend → field)", () => {
  it("maps the backend one-character-name message onto fullName", () => {
    const { fields, formError } = mapRegisterFieldErrors(["Vui lòng nhập họ và tên"]);
    expect(fields.fullName).toBe("Vui lòng nhập họ và tên");
    expect(formError).toBeNull();
  });

  it("maps a duplicate e-mail (409) onto the email field", () => {
    const { fields, formError } = mapRegisterFieldErrors(["Email này đã được đăng ký"]);
    expect(fields.email).toBe("Email này đã được đăng ký");
    expect(formError).toBeNull();
  });

  it("maps the backend phone and password messages", () => {
    expect(mapRegisterFieldErrors(["Số điện thoại chưa hợp lệ"]).fields.phone).toBe("Số điện thoại chưa hợp lệ");
    expect(mapRegisterFieldErrors(["Mật khẩu phải có ít nhất 10 ký tự"]).fields.password).toContain("10 ký tự");
  });

  it("maps English class-validator property prefixes without leaking the English text", () => {
    const { fields } = mapRegisterFieldErrors(["email must be an email"]);
    expect(fields.email).toBe("Email chưa hợp lệ.");
    const pw = mapRegisterFieldErrors(["password must be longer than or equal to 10 characters"]);
    expect(pw.fields.password).toContain("10 ký tự");
  });

  it("keeps a forged-role / unknown rejection as a form-level error, not a field", () => {
    const { fields, formError } = mapRegisterFieldErrors(["property role should not exist"]);
    expect(fields).toEqual({});
    expect(formError).toBe("property role should not exist");
  });

  it("handles a single string message and an undefined body", () => {
    expect(mapRegisterFieldErrors("Email chưa hợp lệ").fields.email).toBe("Email chưa hợp lệ");
    expect(mapRegisterFieldErrors(undefined)).toEqual({ fields: {}, formError: null });
  });
});

