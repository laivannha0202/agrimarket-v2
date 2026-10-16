# AgriMarket V2 — Nền tảng bán nông sản đa đối tác, truy xuất nguồn gốc

Monorepo gồm **4 ứng dụng** chạy chung trên một backend duy nhất:

| Ứng dụng          | Vai trò                                              | Công nghệ                          | Cổng mặc định |
| ----------------- | ---------------------------------------------------- | ---------------------------------- | ------------- |
| `apps/api`        | Backend REST API — **nguồn sự thật duy nhất**        | NestJS 12 · Prisma 7 · MySQL 8.4   | `3000`        |
| `apps/admin-web`  | Web quản trị (đơn, kho, lô, QC, tài chính, báo cáo…) | Next.js 16 · Ant Design 6          | `3001`        |
| `apps/customer-web` | Web khách hàng (mua hàng, tra cứu, khiếu nại…)     | Next.js 16 · Mantine 9             | `3002`        |
| `apps/mobile`     | App khách hàng cho điện thoại (**chỉ Expo Go**)      | Expo SDK 57 · Expo Router · RN     | `8081`        |

> **Quy tắc vàng:** mọi con số (giá, tồn kho, phí ship, voucher, tổng tiền, trạng thái đơn)
> đều do backend quyết định. Admin web, customer web và mobile chỉ hiển thị và gọi API —
> không tự tính toán. Khi có mâu thuẫn, `apps/api` luôn đúng.

README này hướng dẫn **từ số 0 đến khi chạy được cả 4 ứng dụng**, làm lần lượt từng bước.
Làm theo đúng thứ tự, không bỏ bước.

---

## Mục lục

1. [Yêu cầu hệ thống](#1-yêu-cầu-hệ-thống)
2. [Cài đặt từng bước](#2-cài-đặt-từng-bước)
3. [Tài khoản demo](#3-tài-khoản-demo)
4. [Kiểm tra nhanh sau khi chạy](#4-kiểm-tra-nhanh-sau-khi-chạy)
5. [Các lệnh thường dùng](#5-các-lệnh-thường-dùng)
6. [Chạy kiểm thử (tests)](#6-chạy-kiểm-thử-tests)
7. [Cấu trúc thư mục](#7-cấu-trúc-thư-mục)
8. [Xử lý sự cố thường gặp](#8-xử-lý-sự-cố-thường-gặp)
9. [Tài liệu chi tiết](#9-tài-liệu-chi-tiết)
10. [Lưu ý bảo mật](#10-lưu-ý-bảo-mật)

---

## 1. Yêu cầu hệ thống

Cài đủ các thứ sau **trước khi** bắt đầu:

| Thành phần | Phiên bản                        | Ghi chú                                              |
| ---------- | -------------------------------- | ---------------------------------------------------- |
| Node.js    | **>= 20** (khuyến nghị 24.x)     | Kiểm tra: `node -v`                                  |
| npm        | đi kèm Node.js (khuyến nghị >= 10) | Không cần cài thêm — kiểm tra: `npm -v`              |
| MySQL      | **8.4** (utf8mb4)                | Phải đang chạy, có tài khoản tạo được database       |
| Git        | bất kỳ                            | Để clone repo                                        |
| Điện thoại Android + app **Expo Go** | chỉ cần khi chạy mobile | Tải trên CH Play; điện thoại + PC **cùng một Wi-Fi** |

> Không cần Docker. Không cần Android Studio. Mobile chạy **thuần Expo Go** (không build APK).

---

## 2. Cài đặt từng bước

### Bước 1 — Cài công cụ

```bash
# Kiểm tra Node (phải >= 20)
node -v

# Kiểm tra npm (đi kèm Node.js — không cần cài thêm)
npm -v
```

MySQL 8.4: cài đặt và đảm bảo **service đang chạy**, nhớ mật khẩu `root`:

```bash
mysql --version
```

### Bước 2 — Tải mã nguồn

```bash
git clone https://github.com/laivannha0202/agrimarket-v2.git
cd agrimarket-v2
```

### Bước 3 — Cài dependencies

Chạy **từ thư mục gốc repo** (một lệnh cài cho cả 4 app):

```bash
npm install
```

> Lần đầu có thể mất vài phút. Với npm 11.20+, nếu thấy cảnh báo `install-scripts`
> cho `prisma`, `esbuild`…, chạy `npm install-scripts approve prisma @prisma/engines esbuild unrs-resolver`
> rồi `npm rebuild` để hoàn tất (repo dùng npm workspaces, khai báo trong `package.json`).

### Bước 4 — Tạo database MySQL

Repo có sẵn script tạo **2 database**: `agrimarket_v2` (chạy thật) và
`agrimarket_v2_test` (chạy test e2e — test sẽ **xoá dữ liệu** trong db này, nên tách riêng).

**Cách 1 — chạy script có sẵn** (mở `cmd.exe`, không dùng PowerShell cho lệnh này):

```cmd
mysql -u root -p < scripts\sql\create-databases.sql
```

Nếu dùng PowerShell, bọc qua cmd:

```powershell
cmd /c "mysql -u root -p < scripts\sql\create-databases.sql"
```

**Cách 2 — gõ tay** (chạy trong MySQL client):

```sql
CREATE DATABASE IF NOT EXISTS `agrimarket_v2`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS `agrimarket_v2_test`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

**Tạo user riêng cho app** (khuyến nghị — đừng dùng `root` trong `DATABASE_URL`):

```sql
CREATE USER IF NOT EXISTS 'agrimarket'@'localhost' IDENTIFIED BY 'agrimarket_local';
GRANT ALL PRIVILEGES ON agrimarket_v2.* TO 'agrimarket'@'localhost';
GRANT ALL PRIVILEGES ON agrimarket_v2_test.* TO 'agrimarket'@'localhost';
FLUSH PRIVILEGES;
```

### Bước 5 — Cấu hình file .env cho API

```cmd
:: Windows (cmd)
copy apps\api\.env.example apps\api\.env
```

```bash
# macOS / Linux
cp apps/api/.env.example apps/api/.env
```

Mở `apps/api/.env` và sửa **2 dòng quan trọng nhất**:

```env
DATABASE_URL="mysql://agrimarket:agrimarket_local@127.0.0.1:3306/agrimarket_v2"
TEST_DATABASE_URL="mysql://agrimarket:agrimarket_local@127.0.0.1:3306/agrimarket_v2_test"
JWT_SECRET="doi-thanh-mot-chuoi-ngau-nhien-that-dai-va-bi-mat"
```

Các biến còn lại **giữ nguyên mặc định là chạy được local**:

- `PORT=3000` — cổng API
- `CORS_ORIGIN` — đã có sẵn `localhost:3001/3002/8081/8082` cho admin/customer/mobile web
- `MAIL_TRANSPORT=test` — mail chỉ chụp lại trong bộ nhớ, không gửi thật
- `UPLOADS_DIR=uploads` — nơi lưu ảnh sản phẩm/minh chứng

> **Admin Web và Customer Web không cần tạo `.env`** khi chạy local: client của 2 web
> tự fallback về `http://localhost:3000/api/v1`. Chỉ tạo khi cần đổi địa chỉ API
> (xem `.env.example` trong từng app).

### Bước 6 — Khởi tạo schema + dữ liệu mẫu

Chạy lần lượt 3 lệnh từ thư mục gốc:

```bash
# 1. Sinh Prisma client từ schema
npm run db:generate

# 2. Áp migration có sẵn lên database (không hỏi gì)
npm run db:deploy

# 3. Nạp dữ liệu demo (users, farms, sản phẩm, lô, đơn, tài chính…)
npm run db:seed
```

`npm run db:seed` sẽ **xoá sạch dữ liệu cũ** trong `agrimarket_v2` rồi tạo lại từ đầu — chỉ dùng cho môi trường học/dev.

Khi thành công, màn hình in ra:

```text
Seed complete.
  Admin:     admin@agrimarket.vn / Admin@12345
  Customer:  lan.nguyen@agrimarket.vn / Agri@12345
  Trace:     GET /api/v1/trace/TRC-XXXXXXXX-XXXXXX   ← ghi lại mã này để thử tra cứu
  FlashSale: ... (2 items)
```

### Bước 7 — Chạy API (bắt buộc chạy trước tiên)

Mở **terminal 1** tại thư mục gốc repo:

```bash
npm run dev:api
```

Chờ đến khi thấy log kiểu `Nest application successfully started`. Kiểm tra:

- API: <http://localhost:3000/api/v1>
- **Swagger UI (tài liệu API tương tác):** <http://localhost:3000/docs>

> API **phải chạy trước** khi mở Admin/Customer/Mobile — không có backend thì không đăng nhập được.
> Giữ terminal này mở suốt quá trình dùng 3 app còn lại.

### Bước 8 — Chạy Admin Web

Mở **terminal 2** (giữ terminal 1 nguyên vẹn):

```bash
npm run dev:admin
```

Mở trình duyệt: <http://localhost:3001> → đăng nhập bằng tài khoản **Admin**:

```text
admin@agrimarket.vn / Admin@12345
```

Bạn sẽ thấy menu quản trị: Dashboard, Đơn hàng, Kho, Lô hàng, Kiểm định (QC),
Trả hàng – Khiếu nại, Đối tác, Trang trại, Voucher, Flash Sale, Tài chính
(Settlement/Công nợ), Báo cáo, Người dùng…

### Bước 9 — Chạy Customer Web

Mở **terminal 3**:

```bash
npm run dev:customer
```

Mở trình duyệt: <http://localhost:3002> → đăng nhập bằng tài khoản **Khách hàng**:

```text
lan.nguyen@agrimarket.vn / Agri@12345
```

Thử luồng mua hàng: chọn sản phẩm → thêm giỏ → thanh toán (COD) → xem đơn hàng.
Thử **tra cứu nguồn gốc**: dán mã `TRC-…` in ra ở Bước 6 vào trang `/truy-xuat`.

### Bước 10 — Chạy Mobile (Expo Go)

**10.1. Cấu hình địa chỉ API cho điện thoại**

```bash
cd apps/mobile
cp .env.example .env      # Windows: copy .env.example .env
```

Mở `apps/mobile/.env`, thay `YOUR_PC_LAN_IP` bằng **IP LAN thật của máy tính**:

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.10:3000/api/v1
```

Tìm IP LAN trên Windows: mở `cmd` gõ `ipconfig` → xem dòng **IPv4 Address** của
adapter Wi-Fi (dạng `192.168.x.x`).

> ⚠️ **Tuyệt đối không dùng `localhost`** trong file này: `localhost` trên điện thoại
> là chính điện thoại, không phải máy tính của bạn. Điện thoại và PC phải **cùng Wi-Fi**.

**10.2. Chạy Expo (khuyên dùng: một lệnh tự tìm IP LAN)**

Từ thư mục gốc repo, mở **terminal 4**:

```bash
npm run demo:mobile
```

Lệnh này tự tìm IP LAN hiện tại, kiểm tra API `:3000` khỏe mới chạy tiếp,
ghi đúng một biến `EXPO_PUBLIC_API_BASE_URL=http://<IP-hiện-tại>:3000/api/v1`
vào `apps/mobile/.env` (file git-ignored, không commit), rồi khởi động
Expo LAN mode (`expo start --lan`) và hiện QR. Đổi Wi-Fi/hotspot → dừng
(Ctrl+C) và chạy lại lệnh, không sửa IP tay.

- Nhiều card mạng / IP không chắc: `npm run demo:mobile -- --lan-ip=10.0.0.5`
  (hoặc `AGRIMARKET_LAN_IP=10.0.0.5 npm run demo:mobile`).
- Chỉ chẩn đoán, không khởi động: `npm run lan:diagnose`.
- Chạy cả 4 app một lệnh: `npm run demo:all` (API + Admin `:3001` +
  Customer `:3002` + Expo Go).
- Cách cũ vẫn dùng được: `npm run dev:mobile` (nhưng phải tự sửa IP trong
  `apps/mobile/.env` mỗi lần đổi mạng).

Một mã QR hiện ra trong terminal. Mở app **Expo Go** trên điện thoại → quét QR.
Nếu mạng chặn LAN, thử `npm run dev:tunnel --workspace @agrimarket/mobile`
(lưu ý: tunnel chỉ áp dụng cho Expo dev server — API URL vẫn phải là địa chỉ LAN).

> Phân biệt 2 URL: **Metro URL** (`http://<IP>:8081`, QR trỏ tới đây — nơi tải
> bundle JS) khác **Backend URL** (`http://<IP>:3000/api/v1` — nơi app lấy dữ
> liệu). Đổi Wi-Fi đổi cả hai; `demo:mobile` đồng bộ cả hai. Bundle đã build
> không tự nhận IP mới — phải khởi động lại Expo.
> Firewall: Wi-Fi ở profile **Private** là đủ (rule `node.exe Allow/Private`
> có sẵn); không tắt firewall. Nếu Wi-Fi đang **Public**, chuyển sang Private
> (Settings → Network) thay vì mở cổng Public.

**10.3. Chức năng chính của app mobile**

- Đăng nhập / đăng ký / quên mật khẩu
- Xem danh mục, sản phẩm, trang trại, flash sale
- Giỏ hàng, đặt hàng COD, theo dõi đơn
- **Quét QR trên bao bì** để mở hồ sơ truy xuất của lô hàng
- Khiếu nại / trả hàng / đánh giá kèm ảnh minh chứng


---

## 3. Tài khoản demo

Sau khi chạy `npm run db:seed`, dùng các tài khoản sau:

| Vai trò    | Email                       | Mật khẩu      | Dùng ở đâu               |
| ---------- | --------------------------- | ------------- | ------------------------ |
| Admin      | `admin@agrimarket.vn`       | `Admin@12345` | Admin Web (3001)         |
| Khách hàng | `lan.nguyen@agrimarket.vn`  | `Agri@12345`  | Customer Web (3002), Mobile |

Seed tạo **5 khách hàng** với mật khẩu giống nhau `Agri@12345`:

| Email                       | Tên            |
| --------------------------- | -------------- |
| `lan.nguyen@agrimarket.vn`  | Nguyễn Thị Lan |
| `hung.tran@agrimarket.vn`   | Trần Văn Hùng  |
| `mai.pham@agrimarket.vn`    | Phạm Thị Mai   |
| `duc.le@agrimarket.vn`      | Lê Minh Đức    |
| `hoa.vu@agrimarket.vn`      | Vũ Thanh Hoa   |

> Đây là tài khoản **demo công khai**, chỉ dùng cho môi trường học tập.
> Khi triển khai thật phải đổi toàn bộ (xem [mục 10](#10-lưu-ý-bảo-mật)).

---

## 4. Kiểm tra nhanh sau khi chạy

Checklist để chắc chắn hệ thống chạy đúng:

| # | Kiểm tra                                   | Kết quả mong đợi                                       |
| - | ------------------------------------------ | ------------------------------------------------------ |
| 1 | Mở <http://localhost:3000/api/v1>          | Trả JSON (API sống)                                    |
| 2 | Mở <http://localhost:3000/docs>            | Swagger UI hiện danh sách endpoint                     |
| 3 | Đăng nhập Admin Web (3001)                 | Vào được Dashboard, menu quản trị hiện đủ              |
| 4 | Đăng nhập Customer Web (3002)              | Vào được trang chủ, thấy sản phẩm                      |
| 5 | Dán mã `TRC-…` (in ra lúc seed) vào `/truy-xuat` | Hiện hồ sơ lô: trang trại, mùa vụ, kiểm định, hành trình |
| 6 | Mở Expo Go, quét QR (terminal 4)           | App mobile mở được, vào được trang chủ                 |

---

## 5. Các lệnh thường dùng

Tất cả lệnh chạy **từ thư mục gốc repo**:

### Chạy ứng dụng

| Lệnh               | Tác dụng                                        |
| ------------------ | ----------------------------------------------- |
| `npm run dev:api`     | Chạy backend API (cổng 3000, watch mode)        |
| `npm run dev:admin`   | Chạy Admin Web (cổng 3001)                      |
| `npm run dev:customer`| Chạy Customer Web (cổng 3002)                   |
| `npm run dev:mobile`  | Chạy Expo cho mobile (Expo Go)                  |

### Database

| Lệnh                | Tác dụng                                                     |
| ------------------- | ------------------------------------------------------------ |
| `npm run db:generate`  | Sinh Prisma client từ `schema.prisma` (chạy sau khi pull code mới) |
| `npm run db:deploy`    | Áp migration có sẵn lên DB (không hỏi, dùng khi mới clone)   |
| `npm run db:migrate`   | Tạo migration mới khi sửa schema (chỉ khi phát triển)        |
| `npm run db:seed`      | Nạp lại dữ liệu demo (**xoá sạch dữ liệu hiện có**)          |
| `npm run db:studio --workspace @agrimarket/api` | Mở Prisma Studio xem/sửa dữ liệu trực quan |

### Build & kiểm tra chất lượng

| Lệnh            | Tác dụng                                     |
| --------------- | -------------------------------------------- |
| `npm run build`    | Build cả 4 app                               |
| `npm run lint`     | Chạy lint toàn bộ                            |
| `npm run typecheck`| Kiểm tra kiểu TypeScript toàn bộ             |
| `npm run test`     | Chạy unit test toàn bộ                       |
| `npm run test:e2e` | Chạy e2e test API (cần `TEST_DATABASE_URL`)  |

---

## 6. Chạy kiểm thử (tests)

```bash
# Unit test toàn repo (không cần database)
npm run test

# E2E test của API — CẦN database test riêng (agrimarket_v2_test)
# Test sẽ xoá dữ liệu trong db test, tuyệt đối không trỏ vào db thật
npm run test:e2e
```

Nếu `TEST_DATABASE_URL` chưa cấu hình, bộ e2e **tự bỏ qua** — an toàn, không bao giờ
đụng vào database dev.

Chạy test cho từng app:

```bash
npm run test --workspace @agrimarket/api           # backend: business rules + unit
npm run test --workspace @agrimarket/admin-web     # admin: vitest + testing-library
npm run test --workspace @agrimarket/mobile        # mobile: api-client, trace-code…
```


---

## 7. Cấu trúc thư mục

```text
agrimarket-v2/
├── apps/
│   ├── api/                 # Backend NestJS — nguồn sự thật duy nhất
│   │   ├── prisma/          # schema.prisma, migrations/, seed.ts
│   │   ├── src/             # auth, orders, inventory, lots, finance, reports…
│   │   ├── test/            # unit (business-rules/) + e2e
│   │   └── uploads/         # ảnh sản phẩm & minh chứng (không commit)
│   ├── admin-web/           # Web quản trị (Next.js + Ant Design)
│   │   └── src/app/(admin)/ # dashboard, orders, inventory, lots, reports…
│   ├── customer-web/        # Web khách hàng (Next.js + Mantine)
│   │   └── src/app/         # trang chủ, sản phẩm, giỏ hàng, đơn, truy xuất…
│   └── mobile/              # App Expo Go (Expo Router)
│       └── app/             # (tabs), product, order, trace, complaint…
├── docs/                    # Tài liệu kỹ thuật chi tiết (xem mục 9)
├── scripts/                 # sql tạo database + script smoke test
├── package.json             # lệnh chạy chung (npm run dev:api, dev:admin…)
└── package-lock.json        # lockfile npm (workspaces khai báo trong package.json)
```

---

## 8. Xử lý sự cố thường gặp

### Không kết nối được database

```text
Error: P1001: Can't reach database server at 127.0.0.1:3306
```

- Kiểm tra MySQL service đang chạy.
- Kiểm tra lại user/mật khẩu trong `DATABASE_URL` (`apps/api/.env`).
- Thử đăng nhập tay: `mysql -u agrimarket -p -h 127.0.0.1 agrimarket_v2`.

### Lỗi `P1010: User was denied access` hoặc `Access denied`

User MySQL chưa được cấp quyền cho database. Chạy lại phần `GRANT ALL PRIVILEGES` ở Bước 4.

### API báo `EADDRINUSE: address already in use :::3000`

Cổng 3000 đang bị chiếm. Tìm và tắt tiến trình cũ:

```cmd
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

Hoặc đổi `PORT` trong `apps/api/.env` (nhớ đổi cả URL trong `.env` của mobile).

### Admin/Customer Web mở lên trắng trang hoặc login lỗi

- Chắc chắn API (terminal 1) đang chạy và mở được <http://localhost:3000/docs>.
- Mở DevTools (F12) → tab Network: nếu request tới `localhost:3000` bị lỗi CORS,
  kiểm tra `CORS_ORIGIN` trong `apps/api/.env` có `http://localhost:3001,http://localhost:3002`.

### Mobile: app báo "Không kết nối được máy chủ"

- `EXPO_PUBLIC_API_BASE_URL` trong `apps/mobile/.env` phải là **IP LAN của PC**,
  không phải `localhost`.
- Điện thoại và PC phải **cùng một Wi-Fi**.
- Windows Firewall có thể chặn cổng 3000/8081 — cho phép Node.js qua firewall
  (hoặc tạm tắt firewall để kiểm tra).
- Sau khi sửa `.env`, phải **khởi động lại Expo** (`Ctrl+C` rồi chạy lại `npm run dev:mobile`).
- Trên API, nếu ảnh upload không hiển thị trên điện thoại: đặt `PUBLIC_API_BASE_URL`
  trong `apps/api/.env` thành `http://<PC-LAN-IP>:3000`.

### Mobile: QR quét không mở đúng trang

App chấp nhận 3 dạng: mã trần `TRC-…`, URL trang truy xuất, hoặc URL có tham số
`?code=TRC-…`. Dạng khác sẽ báo mã không hợp lệ — đúng thiết kế.

### `npm install` lỗi hoặc treo

- Đảm bảo Node >= 20 và npm hoạt động: `npm -v`.
- Xoá `node_modules` rồi cài lại: xoá thư mục `node_modules` ở gốc và trong các app,
  sau đó chạy lại `npm install`.

### Seed lỗi giữa chừng

`npm run db:seed` cần database đã có schema. Chạy lại đúng thứ tự:
`npm run db:generate` → `npm run db:deploy` → `npm run db:seed`.

---

## 9. Tài liệu chi tiết

Repo có bộ tài liệu đầy đủ trong `docs/` — đọc khi cần hiểu sâu:

| File                              | Nội dung                                                    |
| --------------------------------- | ----------------------------------------------------------- |
| `docs/API.md`                     | Toàn bộ endpoint API, quyền truy cập, ví dụ request/response |
| `docs/BUSINESS-RULES.md`          | Quy tắc nghiệp vụ (tồn kho, FEFO, COD, hoàn tiền, settlement…) |
| `docs/DATABASE.md`                | Thiết kế database, mã code, quy ước dữ liệu                  |
| `docs/DOMAIN.md`                  | Mô hình miền: farm, season, harvest, lot, partner order…     |
| `docs/CONCURRENCY-AUDIT.md`       | Kiểm toán xử lý đồng thời (chống oversell, race condition)   |
| `docs/AGRIMARKET-V2-FINAL-BUSINESS-AUDIT.md` | Kiểm toán nghiệp vụ tổng thể lần cuối             |
| `apps/api/README.md`              | Hướng dẫn riêng backend                                     |
| `apps/mobile/README.md`           | Hướng dẫn riêng app mobile                                  |

Vài quy tắc nghiệp vụ quan trọng nhất (chi tiết trong `BUSINESS-RULES.md`):

- **Tồn kho theo FEFO**: lô hết hạn gần nhất xuất trước; đặt hàng giữ chỗ (`reserved`),
  giao thành công mới trừ thật (`on_hand` và `reserved` cùng giảm).
- **COD chỉ PAID khi admin xác nhận thu tiền** — giao hàng thành công *không* tự động
  đánh dấu đã thu tiền.
- **Lô hàng phải qua QC** mới được bán: `PENDING_QC` → kiểm định đạt → `SELLABLE`.
- **Truy xuất nguồn gốc**: mỗi lô có mã `TRC-…`; khách quét QR xem được trang trại,
  mùa vụ, ngày thu hoạch, kiểm định, hành trình.
- **Settlement đối tác**: chỉ gồm đơn đã `DELIVERED`, một đơn không bao giờ được
  trả tiền 2 lần qua các kỳ.

---

## 10. Lưu ý bảo mật

Các điểm **bắt buộc** làm trước khi triển khai thật:

- [ ] Đổi `JWT_SECRET` thành chuỗi ngẫu nhiên dài (>= 32 ký tự).
- [ ] Đổi mật khẩu toàn bộ tài khoản demo trong seed (`admin@agrimarket.vn`, các khách).
- [ ] Không dùng user `root` MySQL cho app — tạo user riêng có quyền hạn chế.
- [ ] Đặt `CORS_ORIGIN` đúng domain thật, **không** để `*`.
- [ ] Bật SMTP thật (`MAIL_TRANSPORT=smtp` + `SMTP_*`) để gửi mail khôi phục mật khẩu.
- [ ] Đặt `NEXT_PUBLIC_TRACE_BASE_URL` (admin-web) thành domain HTTPS công khai để
  QR in trên tem mở được bằng camera thường.
- [ ] **Không bao giờ commit** file `.env` — repo đã `.gitignore` sẵn, chỉ commit `.env.example`.

---

## Giấy phép & liên hệ

Dự án học tập/demo AgriMarket V2 — nền tảng bán nông sản đa đối tác tích hợp
truy xuất nguồn gốc. Mọi thắc mắc mở issue trên GitHub:
<https://github.com/laivannha0202/agrimarket-v2>

> tự fallback về `http://localhost:3000/api/v1`. Chỉ tạo khi cần đổi địa chỉ API
> (xem `.env.example` trong từng app).


