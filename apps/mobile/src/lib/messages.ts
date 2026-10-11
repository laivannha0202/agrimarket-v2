/**
 * Vietnamese display text for backend error messages.
 * Port of `apps/customer-web/src/lib/api/messages.ts` — display only, the
 * backend decision (status code) is never altered.
 */

const MESSAGES: Record<string, string> = {
  "Cart item not found": "Không tìm thấy sản phẩm này trong giỏ hàng.",
  "No items to checkout": "Không có sản phẩm nào để đặt hàng.",
  "Order total cannot be negative": "Tổng tiền đơn hàng không hợp lệ.",
  "This idempotency key was already used with a different checkout payload":
    "Đơn hàng đã thay đổi so với lần gửi trước. Vui lòng kiểm tra lại giỏ hàng.",
  "This checkout is still being processed, please retry":
    "Đơn hàng đang được xử lý. Vui lòng thử lại sau giây lát.",
  "The order created for this idempotency key is no longer available":
    "Không tìm thấy đơn hàng vừa tạo. Vui lòng kiểm tra lại đơn hàng của bạn.",
  "Order not found": "Không tìm thấy đơn hàng.",
  "Order item not found": "Không tìm thấy sản phẩm trong đơn hàng.",
  "Address not found": "Không tìm thấy địa chỉ.",
  "Voucher not found": "Mã giảm giá không tồn tại.",
  "Voucher is not active": "Mã giảm giá đã ngừng áp dụng.",
  "Voucher is not within its valid period": "Mã giảm giá chưa đến kỳ hoặc đã hết hạn.",
  "Voucher usage limit reached": "Mã giảm giá đã hết lượt sử dụng.",
  "You have reached the per-customer limit for this voucher":
    "Bạn đã dùng hết số lần cho phép của mã giảm giá này.",
  "Only delivered orders can be returned": "Chỉ đơn hàng đã giao mới được yêu cầu trả hàng.",
  "You can only return items from your own orders":
    "Bạn chỉ có thể yêu cầu trả hàng cho đơn của mình.",
  "Return quantity cannot exceed the purchased quantity":
    "Số lượng trả không được vượt quá số lượng đã mua.",
  "Return request not found": "Không tìm thấy yêu cầu trả hàng.",
  "You can only complain about your own orders":
    "Bạn chỉ có thể khiếu nại cho đơn hàng của mình.",
  "Complaint not found": "Không tìm thấy khiếu nại.",
  "This item has already been reviewed": "Sản phẩm này đã được đánh giá.",
  "This item has already been fully claimed in another return request":
    "Sản phẩm này đã được yêu cầu trả toàn bộ trong yêu cầu khác.",
  "Sản phẩm khiếu nại không thuộc đơn hàng này.": "Sản phẩm khiếu nại không thuộc đơn hàng này.",
  "Ảnh đính kèm không hợp lệ hoặc đã thuộc yêu cầu khác. Vui lòng tải lại ảnh.":
    "Ảnh đính kèm không hợp lệ hoặc đã thuộc yêu cầu khác. Vui lòng tải lại ảnh.",
  "Tối đa 5 ảnh cho mỗi yêu cầu.": "Mỗi yêu cầu gửi tối đa 5 ảnh.",
  "Chỉ nhận ảnh JPG, PNG hoặc WebP.": "Chỉ nhận ảnh JPG, PNG hoặc WebP.",
  "Ảnh vượt quá 5 MB. Vui lòng chọn ảnh nhỏ hơn.": "Ảnh vượt quá 5 MB. Vui lòng chọn ảnh nhỏ hơn.",
  "Tệp không phải ảnh hợp lệ. Vui lòng tải lên ảnh JPG, PNG hoặc WebP thật.":
    "Tệp không phải ảnh hợp lệ. Vui lòng tải lên ảnh JPG, PNG hoặc WebP thật.",
  "You can only review items you purchased": "Bạn chỉ có thể đánh giá sản phẩm mình đã mua.",
  "You can only review delivered orders": "Chỉ đơn hàng đã giao mới được đánh giá.",
  "Review not found": "Không tìm thấy đánh giá.",
  "Product not found": "Không tìm thấy sản phẩm.",
  "Product variant not found": "Không tìm thấy loại đóng gói của sản phẩm.",
  "Trace code not found": "Không tìm thấy mã truy xuất.",
  "Farm not found": "Không tìm thấy trang trại.",
  "Partner not found": "Không tìm thấy đối tác.",
  "Category not found": "Không tìm thấy danh mục.",
  "Certificate not found": "Không tìm thấy chứng nhận.",
  "Customer profile not found": "Không tìm thấy thông tin tài khoản.",
  "User not found": "Không tìm thấy tài khoản.",
  "Invalid email or password": "Email hoặc mật khẩu chưa đúng.",
  "User no longer exists": "Tài khoản không còn tồn tại.",
  "Invalid token": "Phiên đăng nhập đã hết hiệu lực.",
  Unauthorized: "Vui lòng đăng nhập để tiếp tục.",
  Forbidden: "Bạn không có quyền thực hiện thao tác này.",

  // Account self-service (see the Customer Web copy for why these are mapped)
  "Email này đã được đăng ký": "Email này đã được đăng ký.",
  "Số điện thoại chưa hợp lệ": "Số điện thoại chưa hợp lệ.",
  "Mật khẩu hiện tại chưa đúng": "Mật khẩu hiện tại chưa đúng.",
  "Mật khẩu mới phải khác mật khẩu hiện tại": "Mật khẩu mới phải khác mật khẩu hiện tại.",
  "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn":
    "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.",
  "Bạn đã thử quá nhiều lần. Vui lòng đợi rồi thử lại.":
    "Bạn đã thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.",
  "Insufficient permissions": "Bạn không có quyền thực hiện thao tác này.",

  // Address book / checkout address (administrative catalogue)
  "Province not found": "Không tìm thấy tỉnh/thành phố.",
  "Ward not found": "Không tìm thấy xã/phường.",
  "Xã/phường không hợp lệ hoặc không thuộc tỉnh đã chọn":
    "Xã/phường không hợp lệ hoặc không thuộc tỉnh/thành phố đã chọn.",
  "Thiếu mã tỉnh/thành phố cho xã/phường đã chọn":
    "Vui lòng chọn lại tỉnh/thành phố cho xã/phường này.",
  "Vui lòng nhập tên người nhận": "Vui lòng nhập tên người nhận.",
  "Vui lòng nhập địa chỉ chi tiết": "Vui lòng nhập địa chỉ chi tiết.",
  "Vui lòng nhập tỉnh/thành phố": "Vui lòng chọn tỉnh/thành phố và xã/phường.",
  "Thiếu thông tin địa chỉ giao hàng": "Vui lòng nhập đầy đủ thông tin địa chỉ giao hàng.",
};

const PREFIXES: { pattern: RegExp; text: string }[] = [
  { pattern: /^Product variant \d+ not found$/, text: "Không tìm thấy loại đóng gói của sản phẩm." },
  {
    pattern: /^You can return at most [\d.]+ of this item$/,
    text: "Số lượng trả vượt quá số lượng còn có thể trả của sản phẩm này.",
  },
  {
    pattern: /^Flash sale quota exceeded for variant \d+$/,
    text: "Sản phẩm này đã hết suất trong chương trình giảm giá nhanh.",
  },
  {
    pattern: /^Per-customer flash sale limit reached for variant \d+$/,
    text: "Bạn đã đạt giới hạn số lượng mua cho sản phẩm đang giảm giá nhanh.",
  },
  {
    pattern: /^Insufficient sellable stock for variant \d+/,
    text: "Sản phẩm này không còn đủ hàng để đặt. Vui lòng giảm số lượng hoặc chọn sản phẩm khác.",
  },
  {
    pattern: /^Cannot change order status from (\w+) to (\w+)$/,
    text: "Đơn hàng không thể chuyển sang trạng thái này.",
  },
  {
    pattern: /^The order total changed from .+ to .+\./,
    text: "Giá hoặc khuyến mãi vừa thay đổi. Vui lòng xem lại tổng tiền mới và xác nhận lại.",
  },
];

function isValidationMessage(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]* (must|should|is|needs to)\b/.test(value);
}

export function translateApiMessage(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const exact = MESSAGES[trimmed];
  if (exact) return exact;
  for (const { pattern, text } of PREFIXES) {
    if (pattern.test(trimmed)) return text;
  }
  if (isValidationMessage(trimmed)) return null;
  return null;
}

export const TRANSLATED_MESSAGES = Object.keys(MESSAGES);
export const TRANSLATED_MESSAGE_PREFIXES = PREFIXES.map((entry) => entry.pattern.source);
