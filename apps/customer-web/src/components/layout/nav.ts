/**
 * Route metadata for the app-like shell (bottom tab bar + mobile app bar).
 *
 * Mirrors the Mobile app's navigation so the web feels identical:
 * 5 tabs (Trang chủ / Sản phẩm / Truy xuất / Giỏ hàng / Tài khoản) and a
 * native-style header whose title matches the screen the customer is on.
 */

export type TabKey = "home" | "catalog" | "trace" | "cart" | "account";

export const TABS: Array<{ key: TabKey; href: string; label: string }> = [
  { key: "home", href: "/", label: "Trang chủ" },
  { key: "catalog", href: "/san-pham", label: "Sản phẩm" },
  { key: "trace", href: "/truy-xuat", label: "Truy xuất" },
  { key: "cart", href: "/gio-hang", label: "Giỏ hàng" },
  { key: "account", href: "/tai-khoan", label: "Tài khoản" },
];

/**
 * The active tab for a pathname, or null on stack screens (checkout, order
 * detail, auth, address book…). Stack screens show a back button instead and
 * hide the tab bar — exactly like the Mobile navigator.
 */
export function activeTab(pathname: string): TabKey | null {
  if (pathname === "/") return "home";
  if (pathname === "/san-pham" || pathname.startsWith("/danh-muc")) return "catalog";
  if (pathname === "/truy-xuat") return "trace";
  if (pathname === "/gio-hang") return "cart";
  if (pathname === "/tai-khoan") return "account";
  return null;
}

const SCREEN_TITLES: Array<{ match: (path: string) => boolean; title: string }> = [
  { match: (p) => p === "/", title: "AgriMarket" },
  { match: (p) => p.startsWith("/danh-muc"), title: "Sản phẩm" },
  { match: (p) => p.startsWith("/san-pham"), title: "Sản phẩm" },
  { match: (p) => p.startsWith("/truy-xuat"), title: "Truy xuất" },
  { match: (p) => p === "/gio-hang", title: "Giỏ hàng" },
  { match: (p) => p === "/tai-khoan", title: "Tài khoản" },
  { match: (p) => p.startsWith("/tai-khoan/dia-chi"), title: "Sổ địa chỉ" },
  { match: (p) => p.startsWith("/tai-khoan/doi-mat-khau"), title: "Đổi mật khẩu" },
  { match: (p) => p.startsWith("/dang-nhap"), title: "Đăng nhập" },
  { match: (p) => p.startsWith("/dang-ky"), title: "Đăng ký tài khoản" },
  { match: (p) => p.startsWith("/quen-mat-khau"), title: "Quên mật khẩu" },
  { match: (p) => p.startsWith("/dat-lai-mat-khau"), title: "Đặt lại mật khẩu" },
  { match: (p) => p.startsWith("/thanh-toan"), title: "Đặt hàng" },
  { match: (p) => p.startsWith("/dat-hang-thanh-cong"), title: "Đặt hàng thành công" },
  { match: (p) => p === "/don-hang", title: "Đơn hàng" },
  { match: (p) => p.startsWith("/don-hang/"), title: "Chi tiết đơn" },
  { match: (p) => p === "/tra-hang", title: "Trả hàng" },
  { match: (p) => p.startsWith("/tra-hang/"), title: "Chi tiết trả hàng" },
  { match: (p) => p === "/khieu-nai", title: "Khiếu nại" },
  { match: (p) => p.startsWith("/khieu-nai/"), title: "Chi tiết khiếu nại" },
  { match: (p) => p.startsWith("/danh-gia"), title: "Đánh giá của tôi" },
  { match: (p) => p.startsWith("/ma-giam-gia"), title: "Mã giảm giá" },
  { match: (p) => p.startsWith("/trang-trai"), title: "Trang trại" },
  { match: (p) => p.startsWith("/doi-tac"), title: "Đối tác" },
];

/** Native-header title for a pathname (mobile app bar). */
export function screenTitle(pathname: string): string {
  const hit = SCREEN_TITLES.find((entry) => entry.match(pathname));
  return hit?.title ?? "AgriMarket";
}
