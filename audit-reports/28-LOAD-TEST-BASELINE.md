# 27 — Load Test Baseline (Read Paths)

> Báo cáo này thêm harness kiểm thử tải và ghi baseline local cho các đường đọc.
> Nó **không** đóng dòng NO-GO "chưa có kiểm thử tải" của báo cáo 25: số dưới đây
> là một tiến trình API, một máy, DB nằm cùng máy. Staging vẫn phải chạy lại.

## A. Phạm vi

Chỉ đo đường đọc. Đường ghi (checkout, giữ tồn kho, settlement/payout) đã có 53
stress test và 15 test đồng thời thật ở báo cáo 19/25; đo tải ghi sẽ tạo dữ liệu
rác và không lặp lại được giữa các lần chạy.

Kịch bản là hỗn hợp có trọng số của 5 endpoint mà mọi phiên đều gọi:

| Kịch bản | Endpoint | Trọng số | Auth |
|---|---|---|---|
| `products-list` | `GET /products?page=1&limit=12` | 35 | không |
| `product-detail` | `GET /products/:id` | 35 | không |
| `trace-public` | `GET /trace/:traceCode` | 15 | không |
| `orders-me` | `GET /orders/me?page=1&limit=10` | 20 | customer |
| `carts-me` | `GET /carts/me` | 10 | customer |

`trace-public` tự bị bỏ khi chạy `--base-url` (không có DB để lấy `trace_code`);
trọng số còn lại được chuẩn hoá lại.

## B. Harness

`scripts/load-test.mjs`, gọi qua `npm run verify:load`.

- Hai chế độ: `--url <mysql-url>` (tự dựng API đã build trên schema cô lập
  `*_test`/`*_restore`/`*_drill`, cùng quy tắc an toàn như các script C-19 khác) và
  `--base-url <url>` (bắn vào API đang chạy; host ngoài loopback bắt buộc
  `--allow-external` vì đó là hành động ảnh hưởng môi trường chia sẻ).
- Generator closed-loop, keep-alive, đo từ lúc gửi đến khi đọc hết body.
- Mọi request là `GET`; script không ghi dữ liệu.
- Ngưỡng mặc định: p99 ≤ 2000 ms, error rate ≤ 1 %, tối thiểu 100 request.
  Vi phạm → exit 1.
- Có pha warmup (mặc định 5 s) không tính vào thống kê.
- Không nằm trong `npm run verify:local`: ngưỡng thời gian không tất định trên máy
  dev dùng chung.

## C. Baseline

Máy chạy: Intel i9-8950HK (12 logical CPU), Windows 11, MySQL 8.0.46 cùng máy,
Node v26.12.0, API một tiến trình từ `apps/api/dist/src/main.js`, schema
`agrimarket_v2_test` đã seed (14 product, 6 user, 18 lot SELLABLE có `trace_code`).

| Concurrency | Thời gian đo | Request | RPS | p50 | p95 | p99 | max | Lỗi |
|---|---|---|---|---|---|---|---|---|
| 10 | 8 s | 1.890 | 235,4 | 41,3 | 58,0 | 68,5 | 92,6 | 0 |
| 20 | 30 s | 7.863 | 261,7 | 76,5 | 91,8 | 106,0 | 121,6 | 0 |
| 40 | 30 s | 7.563 | 251,4 | 160,5 | 186,0 | 201,2 | 213,1 | 0 |
| 2 client × 20 | 20 s | 4.958 | 246,6 | 163,5 | 194,4 | 209,8 | 228,6 | 0 |

Đơn vị latency là ms. Không có request lỗi ở mọi mức tải (0/7.863, 0/7.563).

## D. Điểm nghẽn quan sát được

1. **Throughput phẳng, latency tăng tuyến tính.** 235 → 262 → 251 rps khi
   concurrency 10 → 20 → 40, trong khi p50 tăng 41 → 77 → 161 ms. Đây là hàng đợi
   phía server, không phải client chậm.
2. **Thêm client không tăng tổng.** Hai tiến trình client × 20 kết nối cho 246,6
   rps cộng lại — bằng đúng mức một client. Generator không phải giới hạn.
3. **MySQL còn dư.** 500 `SELECT` chạy song song trên 25 kết nối hết 465 ms
   (~1.075 query/s) — cao hơn khoảng 4 lần mức API đang chuyển hoá.
4. **API dùng ~1,14 core** trong lúc phục vụ ~252 rps, tức ~4,5 ms CPU mỗi
   request. Một tiến trình Node chỉ có một event loop, nên đây là giới hạn thực tế
   của cấu hình một instance.
5. **`connectionLimit` trong URL không thay đổi kết quả** (2 → 227,9 rps,
   25 → 250,4 rps). Chưa kết luận được gì về pool: cần xem `PrismaMariaDb` có
   nhận tham số này từ URL hay không trước khi tinh chỉnh.

Kết luận có thể bảo vệ: trên máy này, một tiến trình API bão hoà quanh
**250 rps** cho hỗn hợp đọc ở trên, với p99 ~100–200 ms và không lỗi.

## E. Điều chưa được chứng minh

- Không phải staging: API và DB cùng máy, không có mạng thật, không có reverse
  proxy, không có nhiều instance.
- Không đo đường ghi, không đo endpoint PDF/packing-slip hay báo cáo.
- Không có nhiều người dùng đồng thời với dữ liệu lớn dần; schema test nhỏ.
- Không kết luận được về pool/connection tuning.

## F. Việc cần làm khi có staging

1. Chạy lại đúng mix này bằng `--base-url <staging> --allow-external` ở
   concurrency 20/50/100, ghi kèm số instance API, cấu hình pool và tài nguyên DB.
2. Đặt ngưỡng UAT: p99 ≤ 2000 ms và error ≤ 1 % (mặc định của harness) là mức tối
   thiểu, không phải mục tiêu.
3. Nếu cần hơn ~250 rps: scale số instance trước, chỉ tinh chỉnh pool sau khi xác
   nhận được tham số nào thực sự có tác dụng.
4. Đo thêm đường ghi ở staging (checkout COD) vì đó là nơi có khoá tồn kho.

## G. Git

- Thêm `scripts/load-test.mjs`, thêm script `verify:load` trong `package.json`.
- Không sửa mã sản phẩm, không thêm dependency.
- Số liệu thô nằm ở `.tmp-verify/c19/load-test/*.json` (không commit).
