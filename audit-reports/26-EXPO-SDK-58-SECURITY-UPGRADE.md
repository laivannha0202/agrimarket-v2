# 26 — Expo SDK 58 Security Upgrade

> Báo cáo này đóng blocker bảo mật còn lại của báo cáo 25 (mục K.6 và NO-GO).
> Mọi con số dưới đây là kết quả chạy lại trong phiên này trên máy local.

## A. Lý do

Báo cáo 25 ghi nhận gate `production-dependency-audit:mobile` FAIL với 3 mục high:

```
expo-router@57.0.27 → query-string@7.1.3 → decode-uri-component@0.2.2
GHSA-qr28-fpjm-wq7f — DoS khi decode chuỗi percent-encoded dị dạng
```

Bản vá `decode-uri-component@0.5.1` là ESM-only, không override được vào
`query-string@7` (CJS); `expo-router` chỉ hết phụ thuộc chuỗi này từ SDK 58. Vì vậy
cách sửa đúng là nâng SDK, không phải thêm override.

## B. Thay đổi phiên bản

`apps/mobile/package.json`:

| Gói | Trước | Sau |
|---|---|---|
| `expo` | `~57.0.28` | `~58.0.22` |
| `expo-router` | `~57.0.26` | `~58.0.29` |
| `react-native` | `0.86.3` | `0.88.1` |
| `react` / `react-dom` | `19.2.3` | `19.3.0` |
| `react-native-screens` | `~4.26.0` | `~4.30.1` |
| `react-native-safe-area-context` | `5.7.0` | `~5.10.1` |
| `expo-camera` | `~57.0.6` | `~58.0.14` |
| `expo-constants` | `~57.0.21` | `~58.0.14` |
| `expo-file-system` | `~57.0.7` | `~58.0.13` |
| `expo-font` | `~57.0.4` | `~58.0.11` |
| `expo-image-manipulator` | `~57.0.21` | `~58.0.16` |
| `expo-image-picker` | `~57.0.20` | `~58.0.10` |
| `expo-linking` | `~57.0.12` | `~58.0.15` |
| `expo-secure-store` | `~57.0.4` | `~58.0.2` |
| `expo-sharing` | `~57.0.24` | `~58.0.21` |
| `expo-status-bar` | `~57.0.1` | `~58.0.4` |
| `@expo/vector-icons` | `^15.1.1` | `^15.0.2` (bản SDK 58 bundle) |
| `@types/react` | `~19.2.18` | `~19.3.0` |
| `eslint-config-expo` | `57.0.2` | `~58.0.4` |

Phiên bản lấy từ `bundledNativeModules.json` của chính `expo@58.0.22`, không đoán.
`npm install` ở root: **added 18, removed 45, changed 104** package; `package-lock.json`
đổi 2.100 dòng. Không thêm migration, không đổi API/DB.

## C. Breaking change của RN 0.88 / SDK 58 đã sửa

Chỉ sửa kiểu, không đổi hành vi:

| File | Lỗi | Sửa |
|---|---|---|
| `apps/mobile/app/(tabs)/_layout.tsx` | `ColorValue` nay gồm cả `null` và `number` (màu đã xử lý), trong khi `Ionicons.color` chỉ nhận `string \| OpaqueColorValue` | `TabIcon`/`CartTabIcon` vẫn nhận `ColorValue`, nhưng thu hẹp khi truyền: `typeof color === "string" ? color : colors.muted` |
| `apps/mobile/app/(tabs)/catalog.tsx` | `ListEmptyComponent` không còn nhận `null` | nhánh cuối đổi `null` → `undefined` |
| `apps/mobile/app/register.tsx` | RN 0.88 export `TextInput` dưới dạng function component (`TextInputType`), nên `useRef<TextInput>` mất `.focus()` và không khớp `ref` của JSX | dùng `TextInputInstance` (type được export chính thức) cho 5 ref và prop `inputRef` của `Field` |

`OrderPdfCard` (File/Paths, `downloadFileAsync`, `Sharing`) không phải sửa — API
`expo-file-system` mới vẫn giữ nguyên trong SDK 58.

## D. Kiểm chứng

| Hạng mục | Lệnh | Kết quả |
|---|---|---|
| Cài đặt | `npm install` | PASS — 18 added / 45 removed / 104 changed |
| Đồng bộ SDK | `npx expo install --check` | **Dependencies are up to date** |
| Expo config | `npx expo config --type public` | PASS — parse được `app.json` |
| Mobile typecheck | `npm run typecheck --workspace @agrimarket/mobile` | **PASS** (trước khi sửa: 11 lỗi) |
| Mobile lint | `npm run lint --workspace @agrimarket/mobile` | **PASS** |
| Mobile unit | `npm test --workspace @agrimarket/mobile` | **175 passed / 3 skipped** (3 skip là `describe.skipIf(!up)` của test gọi API live, có sẵn) |
| Android bundle | `npx expo export --platform android` | **PASS** — 3.6 MB Hermes (SDK 57: 3.8 MB), có chuỗi `agrimarket-order` của card PDF |
| Security scan | `node scripts/security-scan.mjs` | **PASS toàn bộ** — `production-dependency-audit:mobile` **0 high/critical** (trước: 3 high) |
| Cây phụ thuộc | `npm ls decode-uri-component query-string` | **rỗng** — chuỗi advisory không còn trong cây |
| API unit (hồi quy hoisting) | `npm test --workspace @agrimarket/api` | **592/592 PASS (44 file)** |
| Admin typecheck | `npm run typecheck --workspace @agrimarket/admin-web` | **PASS** |
| Customer typecheck | `npm run typecheck --workspace @agrimarket/customer-web` | **PASS** |

`grep decode-uri-component package-lock.json` còn 3 dòng, tất cả là gói khác tên
`fast-decode-uri-component` — không phải advisory.

## E. Chưa kiểm chứng

- Chưa chạy Expo Go trên máy thật/emulator sau khi nâng SDK (môi trường không có thiết bị).
  Đã có: typecheck, lint, bundle Android, config parse, cây phụ thuộc sạch.
- Chưa chạy iOS. Cùng code path, chưa có thiết bị.
- Không chạy lại browser E2E: thay đổi chỉ nằm trong `apps/mobile`; API/Admin/Customer
  chỉ được kiểm tra hồi quy bằng typecheck + unit test ở mục D.

## F. Kết luận

Blocker bảo mật của báo cáo 25 (mục K.6) **đã đóng**: mobile 0 high/critical, security
scan PASS toàn bộ. Điều kiện còn lại để production GO vẫn là những điểm không thể làm
trong repo: chạy trên thiết bị thật, staging/UAT, tải thật và cổng thanh toán thật.
