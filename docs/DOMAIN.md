# AgriMarket — Domain Blueprint (Giai đoạn 1, khóa trước khi viết Prisma schema)

> Nguyên tắc: file này là spec khóa domain. Chưa viết 50 model Prisma vội.
> Mọi thay đổi schema sau này phải quay lại cập nhật file này trước.

## 1. Mục tiêu nền tảng
- Sàn bán nông sản nhiều Partner (nông trại / HTX / doanh nghiệp).
- Tích hợp truy xuất nguồn gốc từ Farm → Season → Harvest → ProductLot → QC → Order.
- Thanh toán, hoa hồng, settlement, payout minh bạch theo từng PartnerOrder.
- Khuyến mãi: Voucher, ProductDiscount, FlashSale.

## 2. Stack đã chốt
- Node.js 24 LTS (`v24.21.0` verified)
- pnpm 12 (`v12.9.1` verified, dùng `packageManager: pnpm@12.9.1`)
- NestJS 12 (ESM, `type: module`)
- Prisma 7 (`7.10.0`) + MySQL 8.4 (`8.4.11` verified) + `@prisma/adapter-mariadb`
- Next.js App Router (chưa tạo)
- Admin: Ant Design (chưa cài)
- Customer Web: Mantine + Tabler (chưa cài)
- Mobile: Expo + React Native (chưa cài)
- TypeScript toàn bộ

## 3. Monorepo hiện tại (Giai đoạn 1)
```
agrimarket/
├── apps/
│   └── api/                  # @agrimarket/api (NestJS)
│       ├── prisma/
│       │   └── schema.prisma # datasource mysql, generator output ./generated/prisma
│       ├── prisma7.config.ts
│       ├── src/
│       └── .env              # DATABASE_URL placeholder, chưa điền thật
├── packages/                 # (trống, dùng sau cho shared types/utils)
├── docs/
│   └── DOMAIN.md             # file này
├── pnpm-workspace.yaml
└── package.json
```

## 4. Domain xương sống (chưa phải schema cuối)

### 4.1 Truy xuất nguồn gốc (core)
```
Partner
→ Farm
→ Season
→ Harvest
→ ProductLot
→ QC
→ Inventory
```
- `Partner`: người bán / đơn vị cung ứng. Sở hữu Farm, Product, tồn kho, settlement.
- `Farm`: trang trại / vùng trồng của Partner. Có vị trí, diện tích, chứng nhận.
- `Season`: vụ mùa của Farm (thời gian gieo trồng → thu hoạch dự kiến).
- `Harvest`: đợt thu hoạch thực tế thuộc Season.
- `ProductLot`: lô hàng từ Harvest, đơn vị truy xuất nhỏ nhất. Có mã QR/lot-code.
- `QC`: kiểm định chất lượng cho ProductLot (đạt / không đạt, tiêu chí, ảnh, người kiểm).
- `Inventory`: tồn kho theo ProductLot / ProductVariant, trừ kho khi Order.

### 4.2 Catalog
```
Partner
→ Product
→ ProductVariant
```
- `Product`: SP của Partner (rau, quả, gạo...). Gắn Farm/Season/Harvest nguồn gốc.
- `ProductVariant`: phân loại (kg, combo, sơ chế...), giá, SKU, Inventory riêng.

### 4.3 Order & Fulfillment
```
Customer
→ Cart
→ Order
→ PartnerOrder
→ Fulfillment
→ Shipment
```
- `Customer`: người mua lẻ.
- `Cart`: giỏ hàng (Customer × ProductVariant).
- `Order`: đơn tổng của Customer (có thể tách nhiều Partner).
- `PartnerOrder`: đơn con theo từng Partner (để tính commission/settlement/payout).
- `Fulfillment`: đóng gói / chuẩn bị hàng cho PartnerOrder.
- `Shipment`: vận chuyển (đơn vị VC, tracking, trạng thái).

### 4.4 Payment
```
Payment
→ Refund
```
- `Payment`: thanh toán cho Order (COD, chuyển khoản, ví...). Lưu amount, method, status.
- `Refund`: hoàn tiền (toàn phần / một phần, theo Order / PartnerOrder).

### 4.5 Commission / Settlement / Payout
```
Commission
→ Settlement
→ Payout
```
- `Commission`: hoa hồng sàn trên từng PartnerOrder / Product.
- `Settlement`: đối soát định kỳ Partner (tổng bán - commission - refund - voucher).
- `Payout`: chi tiền cho Partner sau settlement.

### 4.6 Trust & Traceability
- `Certificate`: chứng nhận (VietGAP, GlobalGAP, Organic...) gắn Farm / Product / ProductLot, có hạn.
- `TraceEvent`: sự kiện truy xuất (gieo trồng, bón phân, thu hoạch, đóng gói, vận chuyển...). Chuỗi tạo QR timeline.
- `Review`: đánh giá Product / PartnerOrder của Customer.
- `Complaint`: khiếu nại Order / ProductLot.
- `Return`: đổi/trả hàng liên kết Complaint + Refund + Inventory hoàn.

### 4.7 Promotion
- `Voucher`: mã sàn / mã shop (điều kiện min-order, scope Partner/Product).
- `ProductDiscount`: giảm giá trực tiếp trên Product/Variant theo thời gian.
- `FlashSale`: khung giờ sale (slot, stock giới hạn, giá flash).

## 5. Quy tắc khóa Giai đoạn 1
- [x] Môi trường: Node 24, pnpm 12, Git, MySQL 8.4 đã verify.
- [x] pnpm workspace `apps/*`, `packages/*`.
- [x] NestJS API scaffold ESM, `--skip-git --no-observe`.
- [x] Package rename `@agrimarket/api`, `private: true`.
- [x] Prisma 7 + adapter-mariadb + dotenv, `prisma init --datasource-provider mysql`.
- [x] DOMAIN.md này.
- [ ] Chưa viết Prisma models chi tiết.
- [ ] Chưa migration.
- [ ] Chưa tạo admin-web / customer-web / mobile.

## 6. Bước tiếp theo (chưa làm)
1. Thiết kế Prisma schema chi tiết từ §4 (relations, indexes, enums).
2. Cấu hình `DATABASE_URL` thật cho MySQL 8.4 local.
3. `prisma migrate dev` + seed.
4. Module API theo domain: Auth, Partner, Catalog, Trace, Cart/Order, Payment, Settlement, Promotion.
5. Test API xong mới tạo `apps/admin-web`, `apps/customer-web`, `apps/mobile`.
